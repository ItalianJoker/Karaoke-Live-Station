/**
 * UVR-MDX-NET Karaoke 2 (ONNX) instrumental separator.
 *
 * Why this model:
 * - ~53 MB — lightest of the offline AI options; recommended default among AI methods
 * - UVR primary_stem is "Instrumental" (is_karaoke) — ONNX output is karaoke backing directly
 * - Runs entirely in-process via onnxruntime-web WASM (no cloud, no native rebuild)
 *
 * Pipeline: decode → resample 44.1 kHz → chunked STFT → ORT → iSTFT → PCM
 * Config matches UVR model_data.json entry MD5 1d64a6d2… (dim_f=2048, dim_t=2^8=256,
 * n_fft=5120, hop=1024, compensate=1.065).
 *
 * Chunking / overlap follow Anjok07/ultimatevocalremovergui `SeperateMDX.demix`
 * (AGPL-3.0 inspiration only — math reimplemented here, GUI not vendored):
 * zero-pad + trim, Default overlap step = chunk_size - n_fft, Hann OLA, crop trim.
 * Prior KLS 50% triangular OLA roughly doubled ORT windows vs UVR Default and made
 * CPU WASM runs look stuck until idle/hard timeout.
 *
 * Heavy work yields to the event loop between frames/chunks; a keep-alive timer
 * posts progress during long `session.run` so the parent idle watchdog stays armed.
 */
import * as ort from 'onnxruntime-web';
import { hannWindow, realFftFrame, realIfftFrame, warmAudioFftForMdx } from './audioFft';
import {
  MDX_KARA2,
  mdxChunkSize,
  mdxGenSize,
  mdxStepSamples,
  mdxTailPadSamples,
  mdxTrim
} from './mdxUvrGeometry';
import { yieldToMainThread } from './yieldToMain';

export type MdxProgress = {
  phase: 'model' | 'decode' | 'separate' | 'ready' | 'error';
  progress: number;
  message: string;
};

export type OrtWasmPathConfig =
  | string
  | {
      wasm?: string;
      mjs?: string;
      /** Prefer embedding the .wasm bytes — avoids file:// fetch hangs in utilityProcess. */
      wasmBinary?: ArrayBuffer | Uint8Array;
    };

type ProgressListener = (info: MdxProgress) => void;

const SAMPLE_RATE = MDX_KARA2.sampleRate;
const DIM_F = MDX_KARA2.dimF;
const DIM_T = MDX_KARA2.dimT;
const N_FFT = MDX_KARA2.nFft;
const HOP = MDX_KARA2.hop;
const COMPENSATION = MDX_KARA2.compensation;
const CHUNK_SIZE = mdxChunkSize(HOP, DIM_T);
const TRIM = mdxTrim(N_FFT);
const GEN_SIZE = mdxGenSize(CHUNK_SIZE, TRIM);
/** UVR UI "Default" MDX overlap — not 50%. */
const STEP = mdxStepSamples('default', CHUNK_SIZE, N_FFT);
const N_BINS = (N_FFT >> 1) + 1;
/** How often to yield/IPC during STFT/iSTFT (frames). */
const FRAME_HEARTBEAT = 64;
/** Keep parent idle watchdog alive during blocking ORT WASM `session.run`. */
const ORT_KEEPALIVE_MS = 15_000;

export class MdxNetSeparator {
  private session: ort.InferenceSession | null = null;
  private inputName = 'input';
  private modelReady = false;
  private loadPromise: Promise<void> | null = null;
  private readonly listeners = new Set<ProgressListener>();
  /** Periodic Hann — matches UVR/torch `hann_window(..., periodic=True)`. */
  private readonly window = hannWindow(N_FFT, true);
  private readonly frameL = new Float32Array(N_FFT);
  private readonly frameR = new Float32Array(N_FFT);
  private readonly olaWindow = new Float32Array(CHUNK_SIZE);
  private readonly chunkL = new Float32Array(CHUNK_SIZE);
  private readonly chunkR = new Float32Array(CHUNK_SIZE);

  public onProgress(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(info: MdxProgress): void {
    for (const listener of this.listeners) {
      try {
        listener(info);
      } catch {
        /* ignore */
      }
    }
  }

  /** Apply ORT WASM paths (file:// or karaoke://). Required in main/utility workers. */
  private async configureOrt(wasmPaths?: OrtWasmPathConfig): Promise<void> {
    if (!wasmPaths) {
      throw new Error('ORT WASM paths required for instrumental AI separation');
    }
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;
    ort.env.wasm.proxy = false;
    if (typeof wasmPaths === 'string') {
      ort.env.wasm.wasmPaths = wasmPaths.endsWith('/') ? wasmPaths : `${wasmPaths}/`;
      return;
    }
    if (wasmPaths.wasmBinary) {
      const bin = wasmPaths.wasmBinary;
      ort.env.wasm.wasmBinary =
        bin instanceof ArrayBuffer
          ? bin
          : bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
      if (wasmPaths.mjs || wasmPaths.wasm) {
        ort.env.wasm.wasmPaths = { mjs: wasmPaths.mjs, wasm: wasmPaths.wasm };
      }
      return;
    }
    ort.env.wasm.wasmPaths = {
      wasm: wasmPaths.wasm,
      mjs: wasmPaths.mjs
    };
  }

  public async loadModel(
    modelBuffer: ArrayBuffer,
    wasmPaths?: OrtWasmPathConfig
  ): Promise<void> {
    if (this.modelReady && this.session) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      this.emit({ phase: 'model', progress: 0.05, message: 'Loading UVR-MDX-NET Karaoke 2…' });
      await this.configureOrt(wasmPaths);
      // Warm Bluestein plans before session create so first STFT is not a cold start.
      warmAudioFftForMdx(N_FFT);
      // Yield so Control UI can paint before the heavy session create.
      await yieldToMainThread();
      this.emit({ phase: 'model', progress: 0.15, message: 'Creating ORT WASM session…' });
      // `all` matches typical ORT desktop defaults (UVR native ORT); WASM still single-thread.
      this.session = await ort.InferenceSession.create(modelBuffer.slice(0), {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      });
      this.inputName = this.session.inputNames[0] || 'input';
      this.modelReady = true;
      this.emit({ phase: 'model', progress: 1, message: 'UVR-MDX-NET Karaoke 2 ready' });
    })();

    try {
      await this.loadPromise;
    } finally {
      this.loadPromise = null;
    }
  }

  public async separateInstrumental(
    left: Float32Array,
    right: Float32Array,
    onChunk?: (ratio: number) => void
  ): Promise<{ left: Float32Array; right: Float32Array }> {
    if (!this.session) throw new Error('MDX model not loaded');

    const length = left.length;
    // UVR demix: zeros(trim) + mix + zeros(pad)
    const pad = mdxTailPadSamples(length, GEN_SIZE, TRIM);
    const mixtureLen = TRIM + length + pad;
    const mixtureL = new Float32Array(mixtureLen);
    const mixtureR = new Float32Array(mixtureLen);
    mixtureL.set(left, TRIM);
    mixtureR.set(right, TRIM);

    const resultL = new Float32Array(mixtureLen);
    const resultR = new Float32Array(mixtureLen);
    const divider = new Float32Array(mixtureLen);

    // Pre-count windows (same loop as UVR: for i in range(0, mixture.shape[-1], step))
    let totalChunks = 0;
    for (let i = 0; i < mixtureLen; i += STEP) totalChunks++;
    totalChunks = Math.max(1, totalChunks);

    const reportSeparate = (ratio: number, message: string) => {
      const clamped = Math.max(0, Math.min(1, ratio));
      onChunk?.(clamped);
      this.emit({ phase: 'separate', progress: clamped, message });
    };

    reportSeparate(
      1 / (totalChunks * 1000),
      `MDX separating… 0% (${totalChunks} chunks, UVR Default overlap)`
    );
    await yieldToMainThread();

    let chunkIndex = 0;
    for (let i = 0; i < mixtureLen; i += STEP) {
      const end = Math.min(i + CHUNK_SIZE, mixtureLen);
      const chunkActual = end - i;

      const chunkL = this.chunkL;
      const chunkR = this.chunkR;
      chunkL.fill(0);
      chunkR.fill(0);
      chunkL.set(mixtureL.subarray(i, end));
      chunkR.set(mixtureR.subarray(i, end));

      const { left: sepL, right: sepR } = await this.separateChunk(chunkL, chunkR, (intra) => {
        reportSeparate(
          (chunkIndex + Math.max(0, Math.min(1, intra))) / totalChunks,
          `MDX separating… ${Math.round(((chunkIndex + intra) / totalChunks) * 100)}%`
        );
      });

      // UVR: np.hanning(chunk_size_actual) when overlap != 0 (Default still windows).
      this.fillHann(this.olaWindow, chunkActual);
      for (let s = 0; s < chunkActual; s++) {
        const w = this.olaWindow[s];
        resultL[i + s] += sepL[s] * w;
        resultR[i + s] += sepR[s] * w;
        divider[i + s] += w;
      }

      chunkIndex++;
      reportSeparate(
        chunkIndex / totalChunks,
        `MDX separating… ${Math.round((chunkIndex / totalChunks) * 100)}%`
      );
      await yieldToMainThread();
    }

    // UVR: tar_waves[:, :, trim:-trim] then [:mix.shape[-1]], * compensate
    const outL = new Float32Array(length);
    const outR = new Float32Array(length);
    for (let s = 0; s < length; s++) {
      const src = TRIM + s;
      const d = divider[src] > 1e-8 ? divider[src] : 1;
      outL[s] = (resultL[src] / d) * COMPENSATION;
      outR[s] = (resultR[src] / d) * COMPENSATION;
    }

    this.emit({ phase: 'ready', progress: 1, message: 'MDX instrumental ready' });
    return { left: outL, right: outR };
  }

  private fillHann(dest: Float32Array, n: number): void {
    if (n <= 1) {
      if (n === 1) dest[0] = 1;
      return;
    }
    // numpy.hanning(n) is symmetric (n-1); UVR uses this for OLA of prediction windows.
    for (let i = 0; i < n; i++) {
      dest[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    }
  }

  private async separateChunk(
    left: Float32Array,
    right: Float32Array,
    onIntra?: (ratio: number) => void
  ): Promise<{ left: Float32Array; right: Float32Array }> {
    if (!this.session) throw new Error('MDX model not loaded');

    // Build spectrogram [1, 4, dim_f, dim_t] = L_re, L_im, R_re, R_im
    // STFT ≈ 0–0.45 of chunk work; ORT ≈ 0.45–0.55; iSTFT ≈ 0.55–1.
    const input = new Float32Array(1 * 4 * DIM_F * DIM_T);
    for (let t = 0; t < DIM_T; t++) {
      const offset = t * HOP;
      const frameL = this.frameL;
      const frameR = this.frameR;
      frameL.fill(0);
      frameR.fill(0);
      for (let i = 0; i < N_FFT; i++) {
        const idx = offset + i;
        const sampleL = idx < left.length ? left[idx] : 0;
        const sampleR = idx < right.length ? right[idx] : 0;
        frameL[i] = sampleL * this.window[i];
        frameR[i] = sampleR * this.window[i];
      }
      // Distinct lanes so L spectrum is not clobbered by R FFT scratch.
      const specL = realFftFrame(frameL, N_FFT, 0);
      const specR = realFftFrame(frameR, N_FFT, 1);
      for (let f = 0; f < DIM_F; f++) {
        const base = (c: number) => c * DIM_F * DIM_T + f * DIM_T + t;
        input[base(0)] = specL.re[f];
        input[base(1)] = specL.im[f];
        input[base(2)] = specR.re[f];
        input[base(3)] = specR.im[f];
      }
      if ((t & (FRAME_HEARTBEAT - 1)) === FRAME_HEARTBEAT - 1) {
        onIntra?.((t / DIM_T) * 0.45);
        await yieldToMainThread();
      }
    }

    // UVR separate.py run_model: spek[:, :, :3, :] *= 0 — mute the lowest 3 bins
    // before ONNX (matches Anjok07/ultimatevocalremovergui MDX path).
    for (let t = 0; t < DIM_T; t++) {
      for (let f = 0; f < MDX_KARA2.muteLowBins; f++) {
        for (let c = 0; c < 4; c++) {
          input[c * DIM_F * DIM_T + f * DIM_T + t] = 0;
        }
      }
    }

    onIntra?.(0.45);
    await yieldToMainThread();
    const tensor = new ort.Tensor('float32', input, [1, 4, DIM_F, DIM_T]);
    const feeds: Record<string, ort.Tensor> = { [this.inputName]: tensor };

    // ORT WASM `session.run` can block for minutes with no await points — pulse
    // progress so InstrumentalAiSeparator idle watchdog does not false-timeout.
    let ortPulse = 0.45;
    const keepAlive = setInterval(() => {
      ortPulse = Math.min(0.54, ortPulse + 0.01);
      onIntra?.(ortPulse);
    }, ORT_KEEPALIVE_MS);
    let results: ort.InferenceSession.OnnxValueMapType;
    try {
      results = await this.session.run(feeds);
    } finally {
      clearInterval(keepAlive);
    }
    onIntra?.(0.55);
    await yieldToMainThread();
    const outName = this.session.outputNames[0];
    const outTensor = results[outName];
    const outData = outTensor.data as Float32Array;

    // Inverse STFT from predicted instrumental spectrogram (UVR Karaoke 2 primary)
    const outL = new Float32Array(CHUNK_SIZE);
    const outR = new Float32Array(CHUNK_SIZE);
    const accL = new Float32Array(CHUNK_SIZE + N_FFT);
    const accR = new Float32Array(CHUNK_SIZE + N_FFT);
    const winAcc = new Float32Array(CHUNK_SIZE + N_FFT);

    const reL = new Float32Array(N_BINS);
    const imL = new Float32Array(N_BINS);
    const reR = new Float32Array(N_BINS);
    const imR = new Float32Array(N_BINS);

    for (let t = 0; t < DIM_T; t++) {
      reL.fill(0);
      imL.fill(0);
      reR.fill(0);
      imR.fill(0);
      for (let f = 0; f < DIM_F; f++) {
        const base = (c: number) => c * DIM_F * DIM_T + f * DIM_T + t;
        reL[f] = outData[base(0)];
        imL[f] = outData[base(1)];
        reR[f] = outData[base(2)];
        imR[f] = outData[base(3)];
      }
      // High bins above dim_f stay zero (freq_pad)
      const frameL = realIfftFrame(reL, imL, N_FFT, 0);
      const frameR = realIfftFrame(reR, imR, N_FFT, 1);
      const offset = t * HOP;
      for (let i = 0; i < N_FFT; i++) {
        const idx = offset + i;
        if (idx >= accL.length) break;
        accL[idx] += frameL[i] * this.window[i];
        accR[idx] += frameR[i] * this.window[i];
        winAcc[idx] += this.window[i] * this.window[i];
      }
      if ((t & (FRAME_HEARTBEAT - 1)) === FRAME_HEARTBEAT - 1) {
        onIntra?.(0.55 + (t / DIM_T) * 0.45);
        await yieldToMainThread();
      }
    }

    for (let i = 0; i < CHUNK_SIZE; i++) {
      const w = winAcc[i] > 1e-8 ? winAcc[i] : 1;
      outL[i] = accL[i] / w;
      outR[i] = accR[i] / w;
    }
    onIntra?.(1);
    return { left: outL, right: outR };
  }
}

export { SAMPLE_RATE as MDX_SAMPLE_RATE, CHUNK_SIZE as MDX_CHUNK_SIZE, STEP as MDX_STEP };
