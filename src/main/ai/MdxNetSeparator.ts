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
 * n_fft=5120, hop=1024, compensate=1.065). Advanced Settings can override dim_t
 * (segment size) and fractional overlap; Karaoke 2 ONNX is catalogued at dim_t=256.
 *
 * Chunking / overlap follow Anjok07/ultimatevocalremovergui `SeperateMDX.demix`
 * (AGPL-3.0 inspiration only — math reimplemented here, GUI not vendored):
 * zero-pad + trim, hop = mdxStepSamples(overlap), Hann OLA, crop trim.
 *
 * Overlap mapping (EN):
 * - UVR UI "Default" → step = chunk_size - n_fft (≈2%); not used when UI sends a fraction
 * - UI fraction o ∈ [0.10, 0.99] → step = floor((1 - o) * chunk_size)
 * - Default UI overlap 0.25 → ~25% window overlap (more ORT runs than UVR Default)
 *
 * Heavy work yields to the event loop between frames/chunks; a keep-alive timer
 * posts progress during long `session.run` so the parent idle watchdog stays armed.
 */
// `onnxruntime-web` (bare) resolves to ort.node.min.js under Electron nodeIntegration
// and never registers the WebGPU EP. `/all` loads ort.all.min.js (WASM + WebGPU).
import * as ort from 'onnxruntime-web/all';
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
import {
  coerceMdxAdvancedSettings,
  type MdxAdvancedSettingsInput
} from '../../shared/mdxAdvancedSettings';
import { resolveAiCpuThreads } from '../../shared/aiCpuThreads';
import { resolveAiOrtExecutionProviders } from '../../shared/aiOrtProviders';
import {
  formatOrtInitError,
  resolveWorkerOrtProviders,
  type AiOrtBackend
} from '../../shared/aiWorkerWebGpu';
import {
  GpuFallbackRequestedError,
  raceWithTimeout,
  WEBGPU_SESSION_TIMEOUT_MS
} from '../../shared/aiGpuFallback';
import os from 'os';

export type MdxProgress = {
  phase: 'model' | 'decode' | 'separate' | 'ready' | 'error';
  progress: number;
  message: string;
  /** Actual ORT EP after session create (not the Settings preference). */
  ortBackend?: AiOrtBackend;
  /** Why WebGPU was skipped or fell back to WASM. */
  ortFallbackReason?: string;
  ortNumThreads?: number;
};

export type OrtWasmPathConfig =
  | string
  | {
      wasm?: string;
      mjs?: string;
      /** Prefer embedding the .wasm bytes — avoids file:// fetch hangs in utilityProcess. */
      wasmBinary?: ArrayBuffer | Uint8Array;
      /** JSEP URLs for WebGPU — used instead of wasm/mjs when preferWebGpu. */
      jsepWasm?: string;
      jsepMjs?: string;
    };

/** Runtime knobs from Settings → worker (MDX path only). */
export type MdxRuntimeOptions = MdxAdvancedSettingsInput & {
  /** Resolved or raw thread preference; null/omit → all cores. */
  aiCpuThreads?: number | null;
  /** User GPU toggle (default true). */
  aiEnableGpu?: boolean;
  /** Main-process GPU probe snapshot. */
  aiGpuSupported?: boolean;
  /**
   * When false (Hidden Renderer), WebGPU failure must NOT create a WASM session
   * in-process — throw {@link GpuFallbackRequestedError} so main re-routes to
   * utilityProcess. Default true (utilityProcess / Node fork).
   */
  allowInProcessWasmFallback?: boolean;
};

type ProgressListener = (info: MdxProgress) => void;

const SAMPLE_RATE = MDX_KARA2.sampleRate;
const DIM_F = MDX_KARA2.dimF;
const N_FFT = MDX_KARA2.nFft;
const HOP = MDX_KARA2.hop;
const COMPENSATION = MDX_KARA2.compensation;
const N_BINS = (N_FFT >> 1) + 1;
/** How often to yield/IPC during STFT/iSTFT (frames). */
const FRAME_HEARTBEAT = 64;
/** Keep parent idle watchdog alive during blocking ORT WASM `session.run`. */
const ORT_KEEPALIVE_MS = 15_000;

/** Default geometry exports (Karaoke 2 catalog dim_t=256 + UVR Default step). */
const DEFAULT_DIM_T = MDX_KARA2.dimT;
const DEFAULT_CHUNK_SIZE = mdxChunkSize(HOP, DEFAULT_DIM_T);
const DEFAULT_STEP = mdxStepSamples('default', DEFAULT_CHUNK_SIZE, N_FFT);

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

  /** UVR dim_t — from Settings segment size (default 256). */
  private readonly dimT: number;
  private readonly chunkSize: number;
  private readonly trim: number;
  private readonly genSize: number;
  /**
   * Hop between ORT prediction windows.
   * Derived from fractional overlap via {@link mdxStepSamples} (not UVR Default
   * unless overlap is omitted and we fall back — UI always sends a fraction).
   */
  private readonly step: number;
  /**
   * When true: graphOptimizationLevel `all` + WASM SIMD (faster CPU path).
   * When false: `disabled` + SIMD off. ORT WASM is still mandatory for inference.
   */
  private readonly enableOrtAcceleration: boolean;
  private readonly overlapLabel: string;
  /** ORT WASM worker threads — clamped to [1, detectedCores]. */
  private readonly numThreads: number;
  /**
   * Prefer WebGPU when Settings GPU toggle + main probe allow it AND
   * `navigator.gpu` exists in this process (usually false in utilityProcess).
   */
  private readonly preferWebGpu: boolean;
  /** Set when WebGPU was requested by Settings but skipped before session.create. */
  private readonly skipWebGpuReason?: string;
  /**
   * When false, never create WASM in this process after WebGPU failure
   * (Hidden Renderer → main must re-route to utilityProcess).
   */
  private readonly allowInProcessWasmFallback: boolean;
  /** Actual EP after loadModel (defaults wasm until create succeeds). */
  private ortBackend: AiOrtBackend = 'wasm';
  private ortFallbackReason?: string;

  private olaWindow: Float32Array;
  private chunkL: Float32Array;
  private chunkR: Float32Array;

  constructor(options?: MdxRuntimeOptions) {
    const cfg = coerceMdxAdvancedSettings(options);
    this.dimT = cfg.mdxSegmentSize;
    this.chunkSize = mdxChunkSize(HOP, this.dimT);
    this.trim = mdxTrim(N_FFT);
    this.genSize = mdxGenSize(this.chunkSize, this.trim);
    // Fractional overlap → hop. Example: 0.25 → floor(0.75 * chunk_size).
    this.step = mdxStepSamples(cfg.mdxOverlap, this.chunkSize, N_FFT);
    this.enableOrtAcceleration = cfg.mdxEnableOrt;
    this.overlapLabel = cfg.mdxOverlap.toFixed(2);
    const totalCpus = Math.max(1, os.cpus()?.length || 1);
    this.numThreads = resolveAiCpuThreads(options?.aiCpuThreads, totalCpus);
    const resolved = resolveWorkerOrtProviders({
      aiEnableGpu: options?.aiEnableGpu,
      aiGpuSupported: options?.aiGpuSupported,
      resolveProviders: resolveAiOrtExecutionProviders
    });
    this.preferWebGpu = resolved.preferWebGpu;
    this.skipWebGpuReason = resolved.skipWebGpuReason;
    this.allowInProcessWasmFallback = options?.allowInProcessWasmFallback !== false;
    if (resolved.skipWebGpuReason) {
      this.ortFallbackReason = resolved.skipWebGpuReason;
    }
    this.olaWindow = new Float32Array(this.chunkSize);
    this.chunkL = new Float32Array(this.chunkSize);
    this.chunkR = new Float32Array(this.chunkSize);
  }

  /** Actual ORT backend after {@link loadModel} (webgpu only if session create succeeded). */
  public getOrtBackend(): AiOrtBackend {
    return this.ortBackend;
  }

  public getOrtFallbackReason(): string | undefined {
    return this.ortFallbackReason;
  }

  public getOrtNumThreads(): number {
    return this.numThreads;
  }

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
  private async configureOrt(
    wasmPaths?: OrtWasmPathConfig,
    opts?: { forWebGpu?: boolean }
  ): Promise<void> {
    if (!wasmPaths) {
      throw new Error('ORT WASM paths required for instrumental AI separation');
    }
    // Manual/core-count threads — capped to avoid OOM; never ≤0 / NaN.
    ort.env.wasm.numThreads = this.numThreads;
    // Spec: SIMD on for multi-thread AI path. mdxEnableOrt still gates graph opts below.
    ort.env.wasm.simd = true;
    ort.env.wasm.proxy = false;
    if (typeof wasmPaths === 'string') {
      ort.env.wasm.wasmPaths = wasmPaths.endsWith('/') ? wasmPaths : `${wasmPaths}/`;
      return;
    }
    const forWebGpu = opts?.forWebGpu ?? this.preferWebGpu;
    // WebGPU/JSEP must load jsep assets via wasmPaths — never embed the CPU
    // ort-wasm-simd-threaded.wasm bytes (breaks JSEP and can deadlock file:// SAB).
    if (forWebGpu) {
      const jsepWasm = wasmPaths.jsepWasm || wasmPaths.wasm;
      const jsepMjs = wasmPaths.jsepMjs || wasmPaths.mjs;
      ort.env.wasm.wasmPaths = {
        wasm: jsepWasm,
        mjs: jsepMjs
      };
      try {
        // Clear any prior utilityProcess embedding if this env was reused.
        delete (ort.env.wasm as { wasmBinary?: ArrayBuffer }).wasmBinary;
      } catch {
        /* ignore */
      }
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
      this.emit({
        phase: 'model',
        progress: 0.15,
        message: this.preferWebGpu
          ? 'Creating ORT session (WebGPU)…'
          : this.skipWebGpuReason
            ? `Creating ORT session (WASM — ${this.skipWebGpuReason})…`
            : 'Creating ORT session (WASM)…',
        ortBackend: this.preferWebGpu ? 'webgpu' : 'wasm',
        ortFallbackReason: this.ortFallbackReason,
        ortNumThreads: this.numThreads
      });
      const graphOptimizationLevel = this.enableOrtAcceleration ? 'all' : 'disabled';
      const sessionOptionsBase = {
        graphOptimizationLevel: graphOptimizationLevel as 'all' | 'disabled'
      };
      // Prefer WebGPU-only first so a silent WASM pick inside ['webgpu','wasm'] cannot
      // look like a GPU hit. On failure / 15s hang: utilityProcess may create WASM here;
      // Hidden Renderer must throw GpuFallbackRequestedError (no in-window WASM / SAB deadlock).
      if (this.preferWebGpu) {
        try {
          this.session = await raceWithTimeout(
            ort.InferenceSession.create(modelBuffer.slice(0), {
              ...sessionOptionsBase,
              executionProviders: ['webgpu']
            }),
            WEBGPU_SESSION_TIMEOUT_MS,
            'ORT InferenceSession.create(WebGPU)'
          );
          this.ortBackend = 'webgpu';
          this.ortFallbackReason = undefined;
        } catch (err) {
          const detail = formatOrtInitError(err);
          this.ortFallbackReason = `WebGPU session.create failed: ${detail}`;
          // Surface exact WebGPU init failure via stderr (piped to main Logger).
          console.warn(`[MdxNetSeparator] ${this.ortFallbackReason}`);
          if (!this.allowInProcessWasmFallback) {
            throw new GpuFallbackRequestedError(this.ortFallbackReason);
          }
          this.emit({
            phase: 'model',
            progress: 0.2,
            message: `WebGPU unavailable — falling back to WASM (${detail})`,
            ortBackend: 'wasm',
            ortFallbackReason: this.ortFallbackReason,
            ortNumThreads: this.numThreads
          });
          // Switch from JSEP paths to CPU wasmBinary before WASM session.create.
          await this.configureOrt(wasmPaths, { forWebGpu: false });
          this.session = await ort.InferenceSession.create(modelBuffer.slice(0), {
            ...sessionOptionsBase,
            executionProviders: ['wasm']
          });
          this.ortBackend = 'wasm';
        }
      } else {
        if (!this.allowInProcessWasmFallback) {
          throw new GpuFallbackRequestedError(
            this.skipWebGpuReason ||
              this.ortFallbackReason ||
              'WebGPU not preferred in Hidden Renderer — re-route to utilityProcess WASM'
          );
        }
        this.session = await ort.InferenceSession.create(modelBuffer.slice(0), {
          ...sessionOptionsBase,
          executionProviders: ['wasm']
        });
        this.ortBackend = 'wasm';
      }
      this.inputName = this.session.inputNames[0] || 'input';
      this.modelReady = true;
      const backendLabel =
        this.ortBackend === 'webgpu'
          ? 'WebGPU'
          : `WASM ${this.numThreads} threads` +
            (this.ortFallbackReason ? `; fallback: ${this.ortFallbackReason}` : '');
      this.emit({
        phase: 'model',
        progress: 1,
        message: `UVR-MDX-NET Karaoke 2 ready (${backendLabel})`,
        ortBackend: this.ortBackend,
        ortFallbackReason: this.ortFallbackReason,
        ortNumThreads: this.numThreads
      });
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
    const { chunkSize, trim, genSize, step, dimT } = this;
    // UVR demix: zeros(trim) + mix + zeros(pad)
    const pad = mdxTailPadSamples(length, genSize, trim);
    const mixtureLen = trim + length + pad;
    const mixtureL = new Float32Array(mixtureLen);
    const mixtureR = new Float32Array(mixtureLen);
    mixtureL.set(left, trim);
    mixtureR.set(right, trim);

    const resultL = new Float32Array(mixtureLen);
    const resultR = new Float32Array(mixtureLen);
    const divider = new Float32Array(mixtureLen);

    // Pre-count windows (same loop as UVR: for i in range(0, mixture.shape[-1], step))
    let totalChunks = 0;
    for (let i = 0; i < mixtureLen; i += step) totalChunks++;
    totalChunks = Math.max(1, totalChunks);

    const reportSeparate = (ratio: number, message: string) => {
      const clamped = Math.max(0, Math.min(1, ratio));
      onChunk?.(clamped);
      this.emit({ phase: 'separate', progress: clamped, message });
    };

    reportSeparate(
      1 / (totalChunks * 1000),
      `MDX separating… 0% (${totalChunks} chunks, dim_t=${dimT}, overlap=${this.overlapLabel})`
    );
    await yieldToMainThread();

    let chunkIndex = 0;
    for (let i = 0; i < mixtureLen; i += step) {
      const end = Math.min(i + chunkSize, mixtureLen);
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
      const src = trim + s;
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

    const dimT = this.dimT;
    const chunkSize = this.chunkSize;

    // Build spectrogram [1, 4, dim_f, dim_t] = L_re, L_im, R_re, R_im
    // STFT ≈ 0–0.45 of chunk work; ORT ≈ 0.45–0.55; iSTFT ≈ 0.55–1.
    const input = new Float32Array(1 * 4 * DIM_F * dimT);
    for (let t = 0; t < dimT; t++) {
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
        const base = (c: number) => c * DIM_F * dimT + f * dimT + t;
        input[base(0)] = specL.re[f];
        input[base(1)] = specL.im[f];
        input[base(2)] = specR.re[f];
        input[base(3)] = specR.im[f];
      }
      if ((t & (FRAME_HEARTBEAT - 1)) === FRAME_HEARTBEAT - 1) {
        onIntra?.((t / dimT) * 0.45);
        await yieldToMainThread();
      }
    }

    // UVR separate.py run_model: spek[:, :, :3, :] *= 0 — mute the lowest 3 bins
    // before ONNX (matches Anjok07/ultimatevocalremovergui MDX path).
    for (let t = 0; t < dimT; t++) {
      for (let f = 0; f < MDX_KARA2.muteLowBins; f++) {
        for (let c = 0; c < 4; c++) {
          input[c * DIM_F * dimT + f * dimT + t] = 0;
        }
      }
    }

    onIntra?.(0.45);
    await yieldToMainThread();
    const tensor = new ort.Tensor('float32', input, [1, 4, DIM_F, dimT]);
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
    const outL = new Float32Array(chunkSize);
    const outR = new Float32Array(chunkSize);
    const accL = new Float32Array(chunkSize + N_FFT);
    const accR = new Float32Array(chunkSize + N_FFT);
    const winAcc = new Float32Array(chunkSize + N_FFT);

    const reL = new Float32Array(N_BINS);
    const imL = new Float32Array(N_BINS);
    const reR = new Float32Array(N_BINS);
    const imR = new Float32Array(N_BINS);

    for (let t = 0; t < dimT; t++) {
      reL.fill(0);
      imL.fill(0);
      reR.fill(0);
      imR.fill(0);
      for (let f = 0; f < DIM_F; f++) {
        const base = (c: number) => c * DIM_F * dimT + f * dimT + t;
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
        onIntra?.(0.55 + (t / dimT) * 0.45);
        await yieldToMainThread();
      }
    }

    for (let i = 0; i < chunkSize; i++) {
      const w = winAcc[i] > 1e-8 ? winAcc[i] : 1;
      outL[i] = accL[i] / w;
      outR[i] = accR[i] / w;
    }
    onIntra?.(1);
    return { left: outL, right: outR };
  }
}

export {
  SAMPLE_RATE as MDX_SAMPLE_RATE,
  DEFAULT_CHUNK_SIZE as MDX_CHUNK_SIZE,
  DEFAULT_STEP as MDX_STEP
};
