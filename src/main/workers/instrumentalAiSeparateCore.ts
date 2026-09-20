/**
 * Shared Instrumental AI separation runner (MDX / HTDemucs via onnxruntime-web).
 *
 * Used by:
 * - `instrumentalAiWorker.ts` (utilityProcess / Node fork — WASM CPU path)
 * - `instrumentalAiGpuRenderer.ts` (hidden BrowserWindow — real WebGPU when available)
 *
 * Transport (`post`) is injected so the same logic works over parentPort or IPC.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { pathToFileURL } from 'url';
// Bare `onnxruntime-web` → ort.node.min.js (no WebGPU). `/all` registers WebGPU + WASM.
import * as ort from 'onnxruntime-web/all';
import {
  isAiVocalRemoverMethod,
  methodToModelId,
  type AiVocalRemoverMethod
} from '../../shared/vocalRemover';
import { coerceMdxAdvancedSettings } from '../../shared/mdxAdvancedSettings';
import { coerceDemucsAdvancedSettings } from '../../shared/demucsAdvancedSettings';
import { resolveAiCpuThreads } from '../../shared/aiCpuThreads';
import { resolveAiOrtExecutionProviders } from '../../shared/aiOrtProviders';
import {
  formatOrtInitError,
  probeWorkerWebGpu,
  resolveWorkerOrtProviders,
  type AiOrtBackend
} from '../../shared/aiWorkerWebGpu';
import {
  GpuFallbackRequestedError,
  isGpuFallbackRequestedError,
  raceWithTimeout,
  WEBGPU_SESSION_TIMEOUT_MS
} from '../../shared/aiGpuFallback';
import { ORT_WASM_CPU_FILES } from '../../shared/ortWasm';
import { MdxNetSeparator, MDX_SAMPLE_RATE } from '../ai/MdxNetSeparator';
import { separateDemucsWithAdvancedOptions } from '../ai/demucsSeparateWithOptions';
import { readPcmWavFile, writePcmWavFile } from '../ai/wavPcm';

/** JSEP pair required by ORT WebGPU — never embed CPU wasmBinary with these. */
const ORT_WASM_JSEP_FILES = {
  wasm: 'ort-wasm-simd-threaded.jsep.wasm',
  mjs: 'ort-wasm-simd-threaded.jsep.mjs'
} as const;

export type InstrumentalAiSeparateRequest = {
  type: 'separate';
  requestId: number;
  method: string;
  modelPath: string;
  ortDir: string;
  inputWav: string;
  outputWav: string;
  aiCpuThreads?: number | null;
  aiEnableGpu?: boolean;
  aiGpuSupported?: boolean;
  /**
   * Hidden Renderer only: forbid in-process WASM after WebGPU failure so main
   * can re-route to utilityProcess (avoids SharedArrayBuffer multithread deadlock).
   */
  allowInProcessWasmFallback?: boolean;
  mdxSegmentSize?: number;
  mdxOverlap?: number;
  mdxEnableOrt?: boolean;
  demucsShifts?: number;
  demucsSegmentSize?: number;
  demucsOverlap?: number;
};

export type InstrumentalAiOutMessage =
  | {
      type: 'progress';
      requestId: number;
      phase: 'model' | 'decode' | 'separate' | 'ready' | 'error';
      progress: number;
      message: string;
      ortBackend?: AiOrtBackend;
      ortFallbackReason?: string;
      ortNumThreads?: number;
    }
  | { type: 'done'; requestId: number; outputWav: string }
  | { type: 'error'; requestId: number; message: string }
  /** Hidden Renderer → main: re-route this job to utilityProcess WASM. */
  | { type: 'gpu-fallback-requested'; requestId: number; reason: string };

export type InstrumentalAiPost = (msg: InstrumentalAiOutMessage) => void;

/** Copy Node Buffer / Uint8Array into a standalone ArrayBuffer (avoids pool `.buffer` traps). */
function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return copy.buffer;
}

function ortWasmConfigFromDir(ortDir: string): {
  /** CPU WASM pair (utilityProcess / in-process WASM fallback). */
  wasm: string;
  mjs: string;
  wasmBinary: Uint8Array;
  /** JSEP pair for WebGPU — never embed as wasmBinary. */
  jsepWasm: string;
  jsepMjs: string;
} {
  const cpuWasm = path.join(ortDir, ORT_WASM_CPU_FILES.wasm);
  const cpuMjs = path.join(ortDir, ORT_WASM_CPU_FILES.mjs);
  const jsepWasm = path.join(ortDir, ORT_WASM_JSEP_FILES.wasm);
  const jsepMjs = path.join(ortDir, ORT_WASM_JSEP_FILES.mjs);
  if (!fs.existsSync(cpuWasm) || !fs.existsSync(cpuMjs)) {
    throw new Error(
      `ORT WASM assets missing under ${ortDir} (${ORT_WASM_CPU_FILES.wasm} / ${ORT_WASM_CPU_FILES.mjs})`
    );
  }
  if (!fs.existsSync(jsepWasm) || !fs.existsSync(jsepMjs)) {
    throw new Error(
      `ORT JSEP assets missing under ${ortDir} (${ORT_WASM_JSEP_FILES.wasm} / ${ORT_WASM_JSEP_FILES.mjs})`
    );
  }
  // Embed CPU .wasm bytes for utilityProcess WASM — avoids file:// fetch hangs.
  const wasmBinary = new Uint8Array(toArrayBuffer(new Uint8Array(fs.readFileSync(cpuWasm))));
  return {
    wasm: pathToFileURL(cpuWasm).href,
    mjs: pathToFileURL(cpuMjs).href,
    wasmBinary,
    jsepWasm: pathToFileURL(jsepWasm).href,
    jsepMjs: pathToFileURL(jsepMjs).href
  };
}

async function separateMdx(
  modelPath: string,
  ortDir: string,
  inputWav: string,
  outputWav: string,
  requestId: number,
  post: InstrumentalAiPost,
  mdxOpts?: {
    mdxSegmentSize?: number;
    mdxOverlap?: number;
    mdxEnableOrt?: boolean;
    aiCpuThreads?: number | null;
    aiEnableGpu?: boolean;
    aiGpuSupported?: boolean;
    allowInProcessWasmFallback?: boolean;
  }
): Promise<void> {
  const wav = readPcmWavFile(inputWav);
  post({
    type: 'progress',
    requestId,
    phase: 'decode',
    progress: 0.1,
    message: 'Audio decoded for MDX…'
  });

  let left = wav.left;
  let right = wav.right;
  if (Math.abs(wav.sampleRate - MDX_SAMPLE_RATE) > 1) {
    throw new Error(
      `MDX requires ${MDX_SAMPLE_RATE} Hz WAV (got ${wav.sampleRate}). Re-extract audio at 44.1 kHz.`
    );
  }

  const advanced = coerceMdxAdvancedSettings(mdxOpts);
  const modelBuffer = toArrayBuffer(new Uint8Array(fs.readFileSync(modelPath)));
  const separator = new MdxNetSeparator({
    ...advanced,
    aiCpuThreads: mdxOpts?.aiCpuThreads,
    aiEnableGpu: mdxOpts?.aiEnableGpu,
    aiGpuSupported: mdxOpts?.aiGpuSupported,
    allowInProcessWasmFallback: mdxOpts?.allowInProcessWasmFallback
  });
  separator.onProgress((info) => {
    post({
      type: 'progress',
      requestId,
      phase: info.phase,
      progress: info.progress,
      message: info.message,
      ortBackend: info.ortBackend,
      ortFallbackReason: info.ortFallbackReason,
      ortNumThreads: info.ortNumThreads ?? separator.getOrtNumThreads()
    });
  });
  // Match separator EP preference: full config carries CPU + JSEP; configureOrt picks.
  await separator.loadModel(modelBuffer, ortWasmConfigFromDir(ortDir));
  post({
    type: 'progress',
    requestId,
    phase: 'model',
    progress: 1,
    message: `MDX ORT backend=${separator.getOrtBackend()}`,
    ortBackend: separator.getOrtBackend(),
    ortFallbackReason: separator.getOrtFallbackReason(),
    ortNumThreads: separator.getOrtNumThreads()
  });
  const { left: outL, right: outR } = await separator.separateInstrumental(left, right, (ratio) => {
    post({
      type: 'progress',
      requestId,
      phase: 'separate',
      progress: ratio,
      message: `MDX separating… ${Math.round(ratio * 100)}%`,
      ortBackend: separator.getOrtBackend(),
      ortFallbackReason: separator.getOrtFallbackReason(),
      ortNumThreads: separator.getOrtNumThreads()
    });
  });
  writePcmWavFile(outputWav, outL, outR, MDX_SAMPLE_RATE);
}

async function separateDemucs(
  modelPath: string,
  ortDir: string,
  inputWav: string,
  outputWav: string,
  requestId: number,
  post: InstrumentalAiPost,
  demucsOpts?: {
    aiCpuThreads?: number | null;
    aiEnableGpu?: boolean;
    aiGpuSupported?: boolean;
    allowInProcessWasmFallback?: boolean;
    demucsShifts?: number;
    demucsSegmentSize?: number;
    demucsOverlap?: number;
  }
): Promise<void> {
  const demucsMod = await import('demucs-web');
  const { DemucsProcessor, CONSTANTS, prepareModelInput, standaloneMask, standaloneIspec } =
    demucsMod;
  const demucsWeb: {
    CONSTANTS: typeof CONSTANTS;
    prepareModelInput: typeof prepareModelInput;
    standaloneMask: typeof standaloneMask;
    standaloneIspec: typeof standaloneIspec;
  } = { CONSTANTS, prepareModelInput, standaloneMask, standaloneIspec };
  const ortAssets = ortWasmConfigFromDir(ortDir);
  const totalCpus = Math.max(1, os.cpus()?.length || 1);
  const threads = resolveAiCpuThreads(demucsOpts?.aiCpuThreads, totalCpus);
  ort.env.wasm.numThreads = threads;
  ort.env.wasm.simd = true;
  ort.env.wasm.proxy = false;

  const applyOrtWasmCpu = () => {
    ort.env.wasm.wasmBinary = ortAssets.wasmBinary.buffer.slice(
      ortAssets.wasmBinary.byteOffset,
      ortAssets.wasmBinary.byteOffset + ortAssets.wasmBinary.byteLength
    );
    ort.env.wasm.wasmPaths = { mjs: ortAssets.mjs, wasm: ortAssets.wasm };
  };
  const applyOrtWasmJsep = () => {
    try {
      delete (ort.env.wasm as { wasmBinary?: ArrayBuffer }).wasmBinary;
    } catch {
      /* ignore */
    }
    ort.env.wasm.wasmPaths = { mjs: ortAssets.jsepMjs, wasm: ortAssets.jsepWasm };
  };

  const wav = readPcmWavFile(inputWav);
  if (Math.abs(wav.sampleRate - CONSTANTS.SAMPLE_RATE) > 1) {
    throw new Error(
      `HTDemucs requires ${CONSTANTS.SAMPLE_RATE} Hz WAV (got ${wav.sampleRate}).`
    );
  }

  post({
    type: 'progress',
    requestId,
    phase: 'model',
    progress: 0.05,
    message: 'Loading HTDemucs…',
    ortNumThreads: threads
  });

  const advanced = coerceDemucsAdvancedSettings(demucsOpts);
  const resolved = resolveWorkerOrtProviders({
    aiEnableGpu: demucsOpts?.aiEnableGpu,
    aiGpuSupported: demucsOpts?.aiGpuSupported,
    resolveProviders: resolveAiOrtExecutionProviders
  });
  // WebGPU → JSEP paths only (no CPU wasmBinary). WASM → embed CPU binary.
  if (resolved.preferWebGpu) {
    applyOrtWasmJsep();
  } else {
    applyOrtWasmCpu();
  }

  let ortBackend: AiOrtBackend = 'wasm';
  let ortFallbackReason: string | undefined = resolved.skipWebGpuReason;
  const modelBuffer = toArrayBuffer(new Uint8Array(fs.readFileSync(modelPath)));
  const sessionOptionsBase = {
    graphOptimizationLevel: 'all' as const
  };

  const createAndRun = async (executionProviders: AiOrtBackend[]) => {
    const sessionOptions = {
      ...sessionOptionsBase,
      executionProviders
    };
    const demucs = new DemucsProcessor({
      ort,
      sessionOptions,
      demucsShifts: advanced.demucsShifts,
      demucsSegmentSize: advanced.demucsSegmentSize,
      demucsOverlap: advanced.demucsOverlap,
      onProgress: (info: { progress: number }) => {
        const progress = Math.max(0, Math.min(1, info.progress));
        post({
          type: 'progress',
          requestId,
          phase: 'separate',
          progress,
          message: `HTDemucs separating… ${Math.round(progress * 100)}%`,
          ortBackend,
          ortFallbackReason,
          ortNumThreads: threads
        });
      }
    });
    const loadPromise = demucs.loadModel(modelBuffer);
    // Watchdog only WebGPU session create — WASM may legitimately take longer.
    if (executionProviders[0] === 'webgpu') {
      await raceWithTimeout(
        loadPromise,
        WEBGPU_SESSION_TIMEOUT_MS,
        'HTDemucs ORT InferenceSession.create(WebGPU)'
      );
    } else {
      await loadPromise;
    }
    post({
      type: 'progress',
      requestId,
      phase: 'separate',
      progress: 0.1,
      message: 'Running HTDemucs inference…',
      ortBackend,
      ortFallbackReason,
      ortNumThreads: threads
    });
    const stems = await separateDemucsWithAdvancedOptions(
      demucsWeb,
      demucs,
      wav.left,
      wav.right,
      advanced
    );
    const length = wav.left.length;
    const outL = new Float32Array(length);
    const outR = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      outL[i] = stems.drums.left[i] + stems.bass.left[i] + stems.other.left[i];
      outR[i] = stems.drums.right[i] + stems.bass.right[i] + stems.other.right[i];
    }
    writePcmWavFile(outputWav, outL, outR, CONSTANTS.SAMPLE_RATE);
  };

  if (resolved.preferWebGpu) {
    post({
      type: 'progress',
      requestId,
      phase: 'model',
      progress: 0.08,
      message: 'Creating HTDemucs ORT session (WebGPU)…',
      ortBackend: 'webgpu',
      ortNumThreads: threads
    });
    try {
      ortBackend = 'webgpu';
      ortFallbackReason = undefined;
      await createAndRun(['webgpu']);
    } catch (err) {
      const detail = formatOrtInitError(err);
      ortFallbackReason = `WebGPU session.create failed: ${detail}`;
      console.warn(`[instrumentalAiSeparateCore] HTDemucs ${ortFallbackReason}`);
      if (demucsOpts?.allowInProcessWasmFallback === false) {
        throw new GpuFallbackRequestedError(ortFallbackReason);
      }
      ortBackend = 'wasm';
      applyOrtWasmCpu();
      post({
        type: 'progress',
        requestId,
        phase: 'model',
        progress: 0.09,
        message: `WebGPU unavailable — falling back to WASM (${detail})`,
        ortBackend: 'wasm',
        ortFallbackReason,
        ortNumThreads: threads
      });
      await createAndRun(['wasm']);
    }
  } else {
    if (demucsOpts?.allowInProcessWasmFallback === false) {
      throw new GpuFallbackRequestedError(
        ortFallbackReason ||
          'WebGPU not preferred in Hidden Renderer — re-route to utilityProcess WASM'
      );
    }
    if (ortFallbackReason) {
      console.warn(
        `[instrumentalAiSeparateCore] HTDemucs skipping WebGPU: ${ortFallbackReason}`
      );
    }
    ortBackend = 'wasm';
    post({
      type: 'progress',
      requestId,
      phase: 'model',
      progress: 0.08,
      message: ortFallbackReason
        ? `Creating HTDemucs ORT session (WASM — ${ortFallbackReason})…`
        : 'Creating HTDemucs ORT session (WASM)…',
      ortBackend: 'wasm',
      ortFallbackReason,
      ortNumThreads: threads
    });
    await createAndRun(['wasm']);
  }

  post({
    type: 'progress',
    requestId,
    phase: 'model',
    progress: 1,
    message: `HTDemucs ORT backend=${ortBackend}`,
    ortBackend,
    ortFallbackReason,
    ortNumThreads: threads
  });
}

/**
 * Run one AI separation job, posting progress/done/error via `post`.
 */
export async function runInstrumentalAiSeparate(
  req: InstrumentalAiSeparateRequest,
  post: InstrumentalAiPost
): Promise<void> {
  const { requestId, method, modelPath, ortDir, inputWav, outputWav } = req;
  if (!isAiVocalRemoverMethod(method)) {
    throw new Error(`Not an AI vocal remover method: ${method}`);
  }
  if (!fs.existsSync(modelPath)) throw new Error(`Model not found: ${modelPath}`);
  if (!fs.existsSync(inputWav)) throw new Error(`Input WAV not found: ${inputWav}`);
  if (!fs.existsSync(ortDir)) throw new Error(`ORT dir not found: ${ortDir}`);

  const inputBase = path.basename(inputWav).toLowerCase();
  if (!inputBase.endsWith('.extract.wav') || inputBase.endsWith('.instrumental.extract.wav')) {
    throw new Error(
      `AI worker refused non-demux input (expected {stem}.extract.wav): ${inputWav}`
    );
  }
  if (path.extname(inputWav).toLowerCase() !== '.wav') {
    throw new Error(`AI worker input must be .wav: ${inputWav}`);
  }

  const aiMethod = method as AiVocalRemoverMethod;
  const expectedId = methodToModelId(aiMethod);
  const totalCpus = Math.max(1, os.cpus()?.length || 1);
  const threads = resolveAiCpuThreads(req.aiCpuThreads, totalCpus);
  const allowInProcessWasmFallback = req.allowInProcessWasmFallback !== false;
  const workerGpu = probeWorkerWebGpu();
  post({
    type: 'progress',
    requestId,
    phase: 'model',
    progress: 0,
    message: `Preparing ${expectedId}… (navigator=${workerGpu.navigatorType}, gpu=${workerGpu.available ? 'yes' : 'no'})`,
    ortBackend: 'wasm',
    ortFallbackReason: workerGpu.available
      ? undefined
      : workerGpu.reason || 'WebGPU unavailable in worker',
    ortNumThreads: threads
  });
  if (!workerGpu.available) {
    console.warn(
      `[instrumentalAiSeparateCore] WebGPU probe: ${workerGpu.reason || 'unavailable'} ` +
        `(aiEnableGpu=${String(req.aiEnableGpu)}, aiGpuSupported=${String(req.aiGpuSupported)})`
    );
  }

  try {
    switch (aiMethod) {
      case 'aiMdxKaraoke2':
        await separateMdx(modelPath, ortDir, inputWav, outputWav, requestId, post, {
          mdxSegmentSize: req.mdxSegmentSize,
          mdxOverlap: req.mdxOverlap,
          mdxEnableOrt: req.mdxEnableOrt,
          aiCpuThreads: req.aiCpuThreads,
          aiEnableGpu: req.aiEnableGpu,
          aiGpuSupported: req.aiGpuSupported,
          allowInProcessWasmFallback
        });
        break;
      case 'aiHtDemucs':
        await separateDemucs(modelPath, ortDir, inputWav, outputWav, requestId, post, {
          aiCpuThreads: req.aiCpuThreads,
          aiEnableGpu: req.aiEnableGpu,
          aiGpuSupported: req.aiGpuSupported,
          allowInProcessWasmFallback,
          demucsShifts: req.demucsShifts,
          demucsSegmentSize: req.demucsSegmentSize,
          demucsOverlap: req.demucsOverlap
        });
        break;
      case 'aiBsRoformer':
        throw new Error(
          'BS-Roformer (ViperX) needs band-split STFT preprocessing not yet reliable in Electron WASM. Model can still be cached under userData/models. Choose UVR-MDX-NET Karaoke 2 (recommended) or HTDemucs for Download Instrumental.'
        );
      default:
        throw new Error(`Unsupported AI method: ${method}`);
    }
  } catch (err) {
    if (isGpuFallbackRequestedError(err)) {
      post({
        type: 'gpu-fallback-requested',
        requestId,
        reason: err.reason || err.message || 'WebGPU unavailable'
      });
      return;
    }
    throw err;
  }

  if (!fs.existsSync(outputWav) || fs.statSync(outputWav).size < 1024) {
    throw new Error('AI separation produced an empty instrumental WAV');
  }
  post({ type: 'done', requestId, outputWav });
}
