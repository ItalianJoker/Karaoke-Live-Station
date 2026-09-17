/**
 * Utility-process / Node worker entry for Download Instrumental AI separation.
 * Runs ORT + MDX/HTDemucs off the Electron main process so Control UI stays responsive.
 *
 * Protocol (parent ↔ child via Electron utilityProcess parentPort, or process IPC):
 *   in:  { type:'separate', requestId, method, modelPath, ortDir, inputWav, outputWav }
 *   out: { type:'progress', requestId, phase, progress, message }
 *        { type:'done', requestId, outputWav }
 *        { type:'error', requestId, message }
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import * as ort from 'onnxruntime-web';
import { DemucsProcessor, CONSTANTS } from 'demucs-web';
import {
  isAiVocalRemoverMethod,
  methodToModelId,
  type AiVocalRemoverMethod
} from '../../shared/vocalRemover';
import { MdxNetSeparator, MDX_SAMPLE_RATE } from '../ai/MdxNetSeparator';
import { readPcmWavFile, writePcmWavFile } from '../ai/wavPcm';

type SeparateRequest = {
  type: 'separate';
  requestId: number;
  method: string;
  modelPath: string;
  ortDir: string;
  inputWav: string;
  outputWav: string;
};

type OutMessage =
  | {
      type: 'progress';
      requestId: number;
      phase: 'model' | 'decode' | 'separate' | 'ready' | 'error';
      progress: number;
      message: string;
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
  const wasmBinary = new Uint8Array(fs.readFileSync(wasm));
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
  requestId: number
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

  const modelBuffer = fs.readFileSync(modelPath).buffer.slice(0) as ArrayBuffer;
  const separator = new MdxNetSeparator();
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
  requestId: number
): Promise<void> {
  const wasmPaths = ortWasmConfigFromDir(ortDir);
  ort.env.wasm.numThreads = 1;
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
    message: 'Loading HTDemucs…'
  });

  const modelBuffer = fs.readFileSync(modelPath).buffer.slice(0) as ArrayBuffer;
  const demucs = new DemucsProcessor({
    ort,
    sessionOptions: {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'basic'
    },
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
  await demucs.loadModel(modelBuffer);
  post({
    type: 'progress',
    requestId,
    phase: 'separate',
    progress: 0.1,
    message: 'Running HTDemucs inference…'
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

  const aiMethod = method as AiVocalRemoverMethod;
  const expectedId = methodToModelId(aiMethod);
  post({
    type: 'progress',
    requestId,
    phase: 'model',
    progress: 0,
    message: `Preparing ${expectedId}…`
  });

  switch (aiMethod) {
    case 'aiMdxKaraoke2':
      await separateMdx(modelPath, ortDir, inputWav, outputWav, requestId);
      break;
    case 'aiHtDemucs':
      await separateDemucs(modelPath, ortDir, inputWav, outputWav, requestId);
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
  const data = raw as SeparateRequest;
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
