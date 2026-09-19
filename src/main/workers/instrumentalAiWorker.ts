/**
 * Utility-process / Node worker entry for Download Instrumental AI separation.
 * Runs ORT + MDX/HTDemucs off the Electron main process so Control UI stays responsive.
 *
 * Protocol (parent ↔ child via Electron utilityProcess parentPort, or process IPC):
 *   in:  { type:'separate', requestId, method, modelPath, ortDir, inputWav, outputWav,
 *          aiCpuThreads?, mdxSegmentSize?, mdxOverlap?, mdxEnableOrt? }
 *   out: { type:'progress', requestId, phase, progress, message, ortNumThreads? }
 *        { type:'done', requestId, outputWav }
 *        { type:'error', requestId, message }
 *
 * Note: Electron parentPort delivers MessageEvent { data, ports } — unwrap via
 * {@link unwrapAiWorkerInboundMessage}. Fork IPC delivers the bare payload.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { pathToFileURL } from 'url';
import * as ort from 'onnxruntime-web';
import {
  isAiVocalRemoverMethod,
  methodToModelId,
  type AiVocalRemoverMethod
} from '../../shared/vocalRemover';
import {
  coerceMdxAdvancedSettings
} from '../../shared/mdxAdvancedSettings';
import { resolveAiCpuThreads } from '../../shared/aiCpuThreads';
import { MdxNetSeparator, MDX_SAMPLE_RATE } from '../ai/MdxNetSeparator';
import { readPcmWavFile, writePcmWavFile } from '../ai/wavPcm';
import { unwrapAiWorkerInboundMessage } from './aiWorkerMessage';

type SeparateRequest = {
  type: 'separate';
  requestId: number;
  method: string;
  modelPath: string;
  ortDir: string;
  inputWav: string;
  outputWav: string;
  /** Resolved or raw thread preference; null/omit → all cores. */
  aiCpuThreads?: number | null;
  /** MDX-only — ignored for Demucs / Roformer. */
  mdxSegmentSize?: number;
  mdxOverlap?: number;
  mdxEnableOrt?: boolean;
};

type OutMessage =
  | {
      type: 'progress';
      requestId: number;
      phase: 'model' | 'decode' | 'separate' | 'ready' | 'error';
      progress: number;
      message: string;
      ortBackend?: string;
      ortNumThreads?: number;
    }
  | { type: 'done'; requestId: number; outputWav: string }
  | { type: 'error'; requestId: number; message: string };

function post(msg: OutMessage): void {
  const port = (process as NodeJS.Process & { parentPort?: { postMessage: (m: unknown) => void } })
    .parentPort;
  if (port?.postMessage) {
    port.postMessage(msg);
    return;
  }
  if (typeof process.send === 'function') {
    process.send(msg);
  }
}

/** Copy Node Buffer / Uint8Array into a standalone ArrayBuffer (avoids pool `.buffer` traps). */
function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return copy.buffer;
}

function ortWasmConfigFromDir(ortDir: string): {
  wasm: string;
  mjs: string;
  wasmBinary: Uint8Array;
} {
  const wasm = path.join(ortDir, 'ort-wasm-simd-threaded.wasm');
  const mjs = path.join(ortDir, 'ort-wasm-simd-threaded.mjs');
  if (!fs.existsSync(wasm) || !fs.existsSync(mjs)) {
    throw new Error(`ORT WASM assets missing under ${ortDir}`);
  }
  // Load .wasm bytes from disk — utilityProcess file:// fetch of large WASM can hang.
  const wasmBinary = new Uint8Array(toArrayBuffer(new Uint8Array(fs.readFileSync(wasm))));
  return {
    wasm: pathToFileURL(wasm).href,
    mjs: pathToFileURL(mjs).href,
    wasmBinary
  };
}

async function separateMdx(
  modelPath: string,
  ortDir: string,
  inputWav: string,
  outputWav: string,
  requestId: number,
  mdxOpts?: {
    mdxSegmentSize?: number;
    mdxOverlap?: number;
    mdxEnableOrt?: boolean;
    aiCpuThreads?: number | null;
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
  // MDX expects 44.1 kHz — InstrumentalProcessor already demuxes at 44.1k
  if (Math.abs(wav.sampleRate - MDX_SAMPLE_RATE) > 1) {
    throw new Error(
      `MDX requires ${MDX_SAMPLE_RATE} Hz WAV (got ${wav.sampleRate}). Re-extract audio at 44.1 kHz.`
    );
  }

  const advanced = coerceMdxAdvancedSettings(mdxOpts);
  const modelBuffer = toArrayBuffer(new Uint8Array(fs.readFileSync(modelPath)));
  const separator = new MdxNetSeparator({
    ...advanced,
    aiCpuThreads: mdxOpts?.aiCpuThreads
  });
  separator.onProgress((info) => {
    post({
      type: 'progress',
      requestId,
      phase: info.phase,
      progress: info.progress,
      message: info.message
    });
  });
  await separator.loadModel(modelBuffer, ortWasmConfigFromDir(ortDir));
  const { left: outL, right: outR } = await separator.separateInstrumental(left, right, (ratio) => {
    post({
      type: 'progress',
      requestId,
      phase: 'separate',
      progress: ratio,
      message: `MDX separating… ${Math.round(ratio * 100)}%`
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
  aiCpuThreads?: number | null
): Promise<void> {
  // Lazy-load demucs-web only on HTDemucs path so MDX boot does not require() ESM.
  const { DemucsProcessor, CONSTANTS } = await import('demucs-web');
  const wasmPaths = ortWasmConfigFromDir(ortDir);
  const totalCpus = Math.max(1, os.cpus()?.length || 1);
  const threads = resolveAiCpuThreads(aiCpuThreads, totalCpus);
  ort.env.wasm.numThreads = threads;
  ort.env.wasm.simd = true;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmBinary = wasmPaths.wasmBinary.buffer.slice(
    wasmPaths.wasmBinary.byteOffset,
    wasmPaths.wasmBinary.byteOffset + wasmPaths.wasmBinary.byteLength
  );
  ort.env.wasm.wasmPaths = { mjs: wasmPaths.mjs, wasm: wasmPaths.wasm };

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

  const modelBuffer = toArrayBuffer(new Uint8Array(fs.readFileSync(modelPath)));
  const sessionOptionsBase = {
    graphOptimizationLevel: 'all' as const
  };
  let sessionOptions: {
    executionProviders: string[];
    graphOptimizationLevel: 'all';
  } = {
    ...sessionOptionsBase,
    executionProviders: ['webgpu', 'wasm']
  };
  const demucs = new DemucsProcessor({
    ort,
    sessionOptions,
    onProgress: (info: { progress: number }) => {
      const progress = Math.max(0, Math.min(1, info.progress));
      post({
        type: 'progress',
        requestId,
        phase: 'separate',
        progress,
        message: `HTDemucs separating… ${Math.round(progress * 100)}%`
      });
    }
  });
  try {
    await demucs.loadModel(modelBuffer);
  } catch {
    // WebGPU EP may be unavailable in utilityProcess — retry WASM-only.
    sessionOptions = { ...sessionOptionsBase, executionProviders: ['wasm'] };
    const demucsWasm = new DemucsProcessor({
      ort,
      sessionOptions,
      onProgress: (info: { progress: number }) => {
        const progress = Math.max(0, Math.min(1, info.progress));
        post({
          type: 'progress',
          requestId,
          phase: 'separate',
          progress,
          message: `HTDemucs separating… ${Math.round(progress * 100)}%`
        });
      }
    });
    await demucsWasm.loadModel(modelBuffer);
    post({
      type: 'progress',
      requestId,
      phase: 'separate',
      progress: 0.1,
      message: 'Running HTDemucs inference…',
      ortNumThreads: threads
    });
    const stems = await demucsWasm.separate(wav.left, wav.right);
    const length = wav.left.length;
    const outL = new Float32Array(length);
    const outR = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      outL[i] = stems.drums.left[i] + stems.bass.left[i] + stems.other.left[i];
      outR[i] = stems.drums.right[i] + stems.bass.right[i] + stems.other.right[i];
    }
    writePcmWavFile(outputWav, outL, outR, CONSTANTS.SAMPLE_RATE);
    return;
  }
  post({
    type: 'progress',
    requestId,
    phase: 'separate',
    progress: 0.1,
    message: 'Running HTDemucs inference…',
    ortNumThreads: threads
  });
  const stems = await demucs.separate(wav.left, wav.right);
  const length = wav.left.length;
  const outL = new Float32Array(length);
  const outR = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    outL[i] = stems.drums.left[i] + stems.bass.left[i] + stems.other.left[i];
    outR[i] = stems.drums.right[i] + stems.bass.right[i] + stems.other.right[i];
  }
  writePcmWavFile(outputWav, outL, outR, CONSTANTS.SAMPLE_RATE);
}

async function handleSeparate(req: SeparateRequest): Promise<void> {
  const { requestId, method, modelPath, ortDir, inputWav, outputWav } = req;
  if (!isAiVocalRemoverMethod(method)) {
    throw new Error(`Not an AI vocal remover method: ${method}`);
  }
  if (!fs.existsSync(modelPath)) throw new Error(`Model not found: ${modelPath}`);
  if (!fs.existsSync(inputWav)) throw new Error(`Input WAV not found: ${inputWav}`);
  if (!fs.existsSync(ortDir)) throw new Error(`ORT dir not found: ${ortDir}`);

  // Parent must pass demux extract (`{stem}.extract.wav`), never source MP4 /
  // never AI output (`{stem}.instrumental.extract.wav`).
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
  post({
    type: 'progress',
    requestId,
    phase: 'model',
    progress: 0,
    message: `Preparing ${expectedId}…`,
    ortBackend: 'wasm',
    ortNumThreads: threads
  });

  switch (aiMethod) {
    case 'aiMdxKaraoke2':
      await separateMdx(modelPath, ortDir, inputWav, outputWav, requestId, {
        mdxSegmentSize: req.mdxSegmentSize,
        mdxOverlap: req.mdxOverlap,
        mdxEnableOrt: req.mdxEnableOrt,
        aiCpuThreads: req.aiCpuThreads
      });
      break;
    case 'aiHtDemucs':
      // Demucs path ignores MDX segment/overlap/ORT knobs even if present on the wire.
      await separateDemucs(modelPath, ortDir, inputWav, outputWav, requestId, req.aiCpuThreads);
      break;
    case 'aiBsRoformer':
      throw new Error(
        'BS-Roformer (ViperX) needs band-split STFT preprocessing not yet reliable in Electron WASM. Model can still be cached under userData/models. Choose UVR-MDX-NET Karaoke 2 (recommended) or HTDemucs for Download Instrumental.'
      );
    default:
      throw new Error(`Unsupported AI method: ${method}`);
  }

  if (!fs.existsSync(outputWav) || fs.statSync(outputWav).size < 1024) {
    throw new Error('AI separation produced an empty instrumental WAV');
  }
  post({ type: 'done', requestId, outputWav });
}

function onMessage(raw: unknown): void {
  // utilityProcess parentPort → MessageEvent { data, ports }; fork IPC → bare payload.
  const data = unwrapAiWorkerInboundMessage(raw) as SeparateRequest | null;
  if (!data || data.type !== 'separate') return;
  void handleSeparate(data).catch((err) => {
    post({
      type: 'error',
      requestId: data.requestId,
      message: err instanceof Error ? err.message : String(err)
    });
  });
}

const parentPort = (process as NodeJS.Process & { parentPort?: { on: (e: string, cb: (m: unknown) => void) => void } })
  .parentPort;
if (parentPort?.on) {
  parentPort.on('message', onMessage);
} else {
  process.on('message', onMessage);
}

post({
  type: 'progress',
  requestId: 0,
  phase: 'ready',
  progress: 0,
  message: 'Instrumental AI worker ready'
});
