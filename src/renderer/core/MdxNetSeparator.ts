/**
 * UVR-MDX-NET Karaoke 2 (ONNX) instrumental separator.
 *
 * Why this model:
 * - ~53 MB — lightest of the offline AI options; recommended default among AI methods
 * - Primary stem is "other" (instrumental) so we get karaoke backing directly
 * - Runs entirely in-process via onnxruntime-web WASM (no cloud, no native rebuild)
 *
 * Pipeline: decode → resample 44.1 kHz → chunked STFT → ORT → iSTFT → AudioBuffer
 * Config matches UVR_MDXNET_KARA_2.yaml (dim_f=2048, dim_t=256, n_fft=5120, hop=1024).
 */
import * as ort from 'onnxruntime-web';
import { hannWindow, realFftFrame, realIfftFrame } from './audioFft';
import { configureOrtWasmFromUserData } from './ortWasmConfig';

export type MdxProgress = {
  phase: 'model' | 'decode' | 'separate' | 'ready' | 'error';
  progress: number;
  message: string;
};

type ProgressListener = (info: MdxProgress) => void;

const SAMPLE_RATE = 44100;
const DIM_F = 2048;
const DIM_T = 256;
const N_FFT = 5120;
const HOP = 1024;
const COMPENSATION = 1.065;
const CHUNK_SIZE = HOP * (DIM_T - 1);
const N_BINS = (N_FFT >> 1) + 1;

export class MdxNetSeparator {
  private session: ort.InferenceSession | null = null;
  private inputName = 'input';
  private modelReady = false;
  private loadPromise: Promise<void> | null = null;
  private readonly listeners = new Set<ProgressListener>();
  private readonly window = hannWindow(N_FFT);

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

  /** Configure ORT WASM from durable userData/ort (karaoke://ort/), not Temp. */
  private async configureOrt(): Promise<void> {
    await configureOrtWasmFromUserData();
  }

  public async loadModel(modelBuffer: ArrayBuffer): Promise<void> {
    if (this.modelReady && this.session) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      this.emit({ phase: 'model', progress: 0.05, message: 'Loading UVR-MDX-NET Karaoke 2…' });
      await this.configureOrt();
      this.session = await ort.InferenceSession.create(modelBuffer.slice(0), {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'basic'
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
    const outL = new Float32Array(length);
    const outR = new Float32Array(length);
    const norm = new Float32Array(length);

    // Reflect-pad like UVR (center=True STFT)
    const pad = N_FFT >> 1;
    const paddedL = this.reflectPad(left, pad);
    const paddedR = this.reflectPad(right, pad);

    const step = Math.floor(CHUNK_SIZE / 2); // num_overlap ≈ 2
    const totalChunks = Math.max(1, Math.ceil((paddedL.length - CHUNK_SIZE) / step) + 1);
    let chunkIndex = 0;

    for (let start = 0; start + CHUNK_SIZE <= paddedL.length; start += step) {
      const chunkL = paddedL.subarray(start, start + CHUNK_SIZE);
      const chunkR = paddedR.subarray(start, start + CHUNK_SIZE);
      const { left: sepL, right: sepR } = await this.separateChunk(chunkL, chunkR);

      for (let i = 0; i < CHUNK_SIZE; i++) {
        const dst = start + i - pad;
        if (dst < 0 || dst >= length) continue;
        // Triangular overlap-add weight
        const w = 1 - Math.abs((i - CHUNK_SIZE / 2) / (CHUNK_SIZE / 2));
        const weight = Math.max(0.05, w);
        outL[dst] += sepL[i] * weight * COMPENSATION;
        outR[dst] += sepR[i] * weight * COMPENSATION;
        norm[dst] += weight;
      }

      chunkIndex++;
      onChunk?.(chunkIndex / totalChunks);
      this.emit({
        phase: 'separate',
        progress: chunkIndex / totalChunks,
        message: `MDX separating… ${Math.round((chunkIndex / totalChunks) * 100)}%`
      });
    }

    // Tail if last partial chunk
    if (paddedL.length > CHUNK_SIZE) {
      const start = Math.max(0, paddedL.length - CHUNK_SIZE);
      if (start % step !== 0) {
        const chunkL = paddedL.subarray(start, start + CHUNK_SIZE);
        const chunkR = paddedR.subarray(start, start + CHUNK_SIZE);
        const { left: sepL, right: sepR } = await this.separateChunk(chunkL, chunkR);
        for (let i = 0; i < CHUNK_SIZE; i++) {
          const dst = start + i - pad;
          if (dst < 0 || dst >= length) continue;
          const w = 1 - Math.abs((i - CHUNK_SIZE / 2) / (CHUNK_SIZE / 2));
          const weight = Math.max(0.05, w);
          outL[dst] += sepL[i] * weight * COMPENSATION;
          outR[dst] += sepR[i] * weight * COMPENSATION;
          norm[dst] += weight;
        }
      }
    }

    for (let i = 0; i < length; i++) {
      if (norm[i] > 1e-6) {
        outL[i] /= norm[i];
        outR[i] /= norm[i];
      }
    }

    this.emit({ phase: 'ready', progress: 1, message: 'MDX instrumental ready' });
    return { left: outL, right: outR };
  }

  private async separateChunk(
    left: Float32Array,
    right: Float32Array
  ): Promise<{ left: Float32Array; right: Float32Array }> {
    if (!this.session) throw new Error('MDX model not loaded');

    // Build spectrogram [1, 4, dim_f, dim_t] = L_re, L_im, R_re, R_im
    const input = new Float32Array(1 * 4 * DIM_F * DIM_T);
    for (let t = 0; t < DIM_T; t++) {
      const offset = t * HOP;
      const frameL = new Float32Array(N_FFT);
      const frameR = new Float32Array(N_FFT);
      for (let i = 0; i < N_FFT; i++) {
        const idx = offset + i;
        const sampleL = idx < left.length ? left[idx] : 0;
        const sampleR = idx < right.length ? right[idx] : 0;
        frameL[i] = sampleL * this.window[i];
        frameR[i] = sampleR * this.window[i];
      }
      const specL = realFftFrame(frameL, N_FFT);
      const specR = realFftFrame(frameR, N_FFT);
      for (let f = 0; f < DIM_F; f++) {
        // layout: [batch, channel, freq, time]
        const base = (c: number) => c * DIM_F * DIM_T + f * DIM_T + t;
        input[base(0)] = specL.re[f];
        input[base(1)] = specL.im[f];
        input[base(2)] = specR.re[f];
        input[base(3)] = specR.im[f];
      }
    }

    const tensor = new ort.Tensor('float32', input, [1, 4, DIM_F, DIM_T]);
    const feeds: Record<string, ort.Tensor> = { [this.inputName]: tensor };
    const results = await this.session.run(feeds);
    const outName = this.session.outputNames[0];
    const outTensor = results[outName];
    const outData = outTensor.data as Float32Array;

    // Inverse STFT from predicted "other" (instrumental) spectrogram
    const outL = new Float32Array(CHUNK_SIZE);
    const outR = new Float32Array(CHUNK_SIZE);
    const accL = new Float32Array(CHUNK_SIZE + N_FFT);
    const accR = new Float32Array(CHUNK_SIZE + N_FFT);
    const winAcc = new Float32Array(CHUNK_SIZE + N_FFT);

    for (let t = 0; t < DIM_T; t++) {
      const reL = new Float32Array(N_BINS);
      const imL = new Float32Array(N_BINS);
      const reR = new Float32Array(N_BINS);
      const imR = new Float32Array(N_BINS);
      for (let f = 0; f < DIM_F; f++) {
        const base = (c: number) => c * DIM_F * DIM_T + f * DIM_T + t;
        reL[f] = outData[base(0)];
        imL[f] = outData[base(1)];
        reR[f] = outData[base(2)];
        imR[f] = outData[base(3)];
      }
      // High bins above dim_f stay zero (freq_pad)
      const frameL = realIfftFrame(reL, imL, N_FFT);
      const frameR = realIfftFrame(reR, imR, N_FFT);
      const offset = t * HOP;
      for (let i = 0; i < N_FFT; i++) {
        const idx = offset + i;
        if (idx >= accL.length) break;
        accL[idx] += frameL[i] * this.window[i];
        accR[idx] += frameR[i] * this.window[i];
        winAcc[idx] += this.window[i] * this.window[i];
      }
    }

    for (let i = 0; i < CHUNK_SIZE; i++) {
      const w = winAcc[i] > 1e-8 ? winAcc[i] : 1;
      outL[i] = accL[i] / w;
      outR[i] = accR[i] / w;
    }
    return { left: outL, right: outR };
  }

  private reflectPad(input: Float32Array, pad: number): Float32Array {
    const out = new Float32Array(input.length + pad * 2);
    for (let i = 0; i < pad; i++) {
      out[i] = input[Math.min(input.length - 1, pad - i)];
    }
    out.set(input, pad);
    for (let i = 0; i < pad; i++) {
      out[pad + input.length + i] =
        input[Math.max(0, input.length - 2 - i)];
    }
    return out;
  }
}

export { SAMPLE_RATE as MDX_SAMPLE_RATE };
