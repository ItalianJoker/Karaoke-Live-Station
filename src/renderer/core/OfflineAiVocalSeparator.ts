/**
 * Offline AI vocal separator — unified entry for MDX / HTDemucs / BS-Roformer.
 *
 * Lifecycle:
 * 1. ensureModel via main-process IPC (download+cache under userData/models)
 * 2. Fetch ONNX via karaoke://models/ (streaming; avoids giant sync IPC buffers)
 * 3. Ensure ORT WASM under userData/ort (karaoke://ort/) then load ONNX
 * 4. MDX runs in a Web Worker (STFT+ORT off the UI thread); other methods yield
 * 5. Separate media URL → instrumental AudioBuffer (cached LRU)
 * 6. AudioGraphManager crossfades dry→wet when ready (never choppy no-op)
 *
 * BS-Roformer: quantized ViperX ONNX is cached offline; full band-split STFT
 * preprocessor is heavy for Electron WASM — we run a best-effort ORT path and
 * surface a clear toast if inference cannot complete (algorithmic still works).
 */
import * as ort from 'onnxruntime-web';
import { DemucsProcessor, CONSTANTS } from 'demucs-web';
import {
  isAiVocalRemoverMethod,
  methodToModelId,
  OFFLINE_VOCAL_MODELS,
  type AiVocalRemoverMethod,
  type OfflineVocalModelId
} from '../../shared/vocalRemover';
import { MDX_SAMPLE_RATE } from './MdxNetSeparator';
import { MdxVocalWorkerClient } from './MdxVocalWorkerClient';
import {
  configureOrtWasmFromUserData,
  formatOrtBackendError,
  getConfiguredOrtWasmPaths
} from './ortWasmConfig';
import { yieldToMainThread } from './yieldToMain';

export type AiSeparatorProgress = {
  phase: 'model' | 'decode' | 'separate' | 'ready' | 'error';
  progress: number;
  message: string;
  modelId?: OfflineVocalModelId;
};

type ProgressListener = (info: AiSeparatorProgress) => void;

const MAX_CACHED_STEMS = 4;

export { formatOrtBackendError };

export class OfflineAiVocalSeparator {
  private readonly instrumentalCache = new Map<string, AudioBuffer>();
  private readonly inFlight = new Map<string, Promise<AudioBuffer>>();
  private readonly listeners = new Set<ProgressListener>();

  private mdxClient: MdxVocalWorkerClient | null = null;
  private demucs: DemucsProcessor | null = null;
  private demucsReady = false;
  private bsSession: ort.InferenceSession | null = null;
  private bsReady = false;

  public onProgress(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(info: AiSeparatorProgress): void {
    for (const listener of this.listeners) {
      try {
        listener(info);
      } catch {
        /* ignore */
      }
    }
  }

  private cacheKey(method: AiVocalRemoverMethod, mediaUrl: string): string {
    return `${method}::${mediaUrl}`;
  }

  public getCachedInstrumental(
    method: AiVocalRemoverMethod,
    mediaUrl: string
  ): AudioBuffer | null {
    return this.instrumentalCache.get(this.cacheKey(method, mediaUrl)) || null;
  }

  /**
   * Load model bytes from durable userData/models via karaoke://models/ when possible.
   * Falls back to IPC getModelBuffer (async read) outside Electron.
   */
  private async loadModelArrayBuffer(modelId: OfflineVocalModelId): Promise<ArrayBuffer> {
    const api = typeof window !== 'undefined' ? window.karaokeApi?.vocalModels : undefined;
    if (!api?.ensureModel) {
      throw new Error('Vocal model IPC unavailable (not running in Electron?)');
    }

    const ensured = await api.ensureModel(modelId);
    if (!ensured?.success) {
      const err = new Error(ensured?.error || `Failed to download offline model ${modelId}`);
      (err as Error & { code?: string }).code = 'VOCAL_MODEL_DOWNLOAD';
      throw err;
    }

    // Prefer streaming fetch so the main process does not serialize 50–170 MB over IPC.
    const fetchUrl =
      ensured.modelUrl ||
      `karaoke://models/${encodeURIComponent(OFFLINE_VOCAL_MODELS[modelId].filename)}`;
    try {
      await yieldToMainThread();
      const response = await fetch(fetchUrl);
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > 0) return buffer;
      }
    } catch {
      // Fall through to IPC buffer path.
    }

    if (!api.getModelBuffer) {
      throw new Error(`Failed to load offline model buffer for ${modelId}`);
    }
    const result = await api.getModelBuffer(modelId);
    if (!result?.success || !result.buffer || result.buffer.byteLength === 0) {
      const err = new Error(
        result?.error || `Failed to load offline model buffer for ${modelId}`
      );
      if (result?.error && /download failed|integrity|SHA-256/i.test(result.error)) {
        (err as Error & { code?: string }).code = 'VOCAL_MODEL_DOWNLOAD';
      }
      throw err;
    }
    return result.buffer;
  }

  /**
   * Ensures the ONNX weights for `method` are on disk (IPC) and the in-process
   * runtime session is ready.
   */
  public async ensureMethodReady(method: AiVocalRemoverMethod): Promise<void> {
    if (!isAiVocalRemoverMethod(method)) {
      throw new Error(`Not an AI vocal remover method: ${method}`);
    }
    const modelId = methodToModelId(method);
    this.emit({
      phase: 'model',
      progress: 0,
      message: `Preparing ${modelId}…`,
      modelId
    });

    const buffer = await this.loadModelArrayBuffer(modelId);
    await yieldToMainThread();

    try {
      await configureOrtWasmFromUserData();
    } catch (err) {
      const wrapped = new Error(formatOrtBackendError(err));
      (wrapped as Error & { code?: string }).code = 'ORT_WASM_BACKEND';
      throw wrapped;
    }

    const wasmPaths = getConfiguredOrtWasmPaths() || 'karaoke://ort/';

    try {
      switch (method) {
        case 'aiMdxKaraoke2':
          if (!this.mdxClient) {
            this.mdxClient = new MdxVocalWorkerClient();
            this.mdxClient.onProgress((info) => this.emit({ ...info, modelId }));
          }
          await this.mdxClient.loadModel(buffer, wasmPaths);
          break;
        case 'aiHtDemucs':
          await this.ensureDemucs(buffer);
          break;
        case 'aiBsRoformer':
          await this.ensureBsRoformer(buffer);
          break;
      }
    } catch (err) {
      const message = formatOrtBackendError(err);
      const wrapped = new Error(message);
      if (
        /no available backend|wasm|jsep|ort-wasm|Failed to f/i.test(
          err instanceof Error ? err.message : String(err)
        )
      ) {
        (wrapped as Error & { code?: string }).code = 'ORT_WASM_BACKEND';
      }
      throw wrapped;
    }
    this.emit({
      phase: 'model',
      progress: 1,
      message: `${modelId} ready`,
      modelId
    });
  }

  private async ensureDemucs(modelBuffer: ArrayBuffer): Promise<void> {
    if (this.demucsReady && this.demucs) return;
    this.demucs = new DemucsProcessor({
      ort,
      sessionOptions: {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'basic'
      },
      onProgress: (info: { progress: number }) => {
        const progress = Math.max(0, Math.min(1, info.progress));
        this.emit({
          phase: 'separate',
          progress,
          message: `HTDemucs separating… ${Math.round(progress * 100)}%`,
          modelId: 'htDemucs'
        });
      },
      onLog: (phase: string, message: string) => {
        this.emit({
          phase: 'model',
          progress: 0.05,
          message: `[${phase}] ${message}`,
          modelId: 'htDemucs'
        });
      },
      onDownloadProgress: (loaded: number, total: number) => {
        const ratio = total > 0 ? loaded / total : 0;
        this.emit({
          phase: 'model',
          progress: ratio,
          message: `Downloading HTDemucs… ${Math.round(ratio * 100)}%`,
          modelId: 'htDemucs'
        });
      }
    });
    await yieldToMainThread();
    await this.demucs.loadModel(modelBuffer);
    this.demucsReady = true;
  }

  private async ensureBsRoformer(modelBuffer: ArrayBuffer): Promise<void> {
    if (this.bsReady && this.bsSession) return;
    this.emit({
      phase: 'model',
      progress: 0.1,
      message: 'Loading BS-Roformer (ViperX)…',
      modelId: 'bsRoformer'
    });
    await yieldToMainThread();
    this.bsSession = await ort.InferenceSession.create(modelBuffer.slice(0), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'basic'
    });
    this.bsReady = true;
  }

  public async separateInstrumentalFromUrl(
    method: AiVocalRemoverMethod,
    mediaUrl: string,
    audioContext: AudioContext
  ): Promise<AudioBuffer> {
    const key = this.cacheKey(method, mediaUrl);
    const cached = this.instrumentalCache.get(key);
    if (cached) return cached;

    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const work = this.runSeparation(method, mediaUrl, audioContext, key);
    this.inFlight.set(key, work);
    try {
      return await work;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async runSeparation(
    method: AiVocalRemoverMethod,
    mediaUrl: string,
    audioContext: AudioContext,
    cacheKey: string
  ): Promise<AudioBuffer> {
    await this.ensureMethodReady(method);

    this.emit({ phase: 'decode', progress: 0.05, message: 'Decoding audio…' });
    await yieldToMainThread();
    const response = await fetch(mediaUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch media for separation (HTTP ${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    await yieldToMainThread();
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));

    let instrumental: AudioBuffer;
    switch (method) {
      case 'aiMdxKaraoke2':
        instrumental = await this.runMdx(decoded, audioContext);
        break;
      case 'aiHtDemucs':
        instrumental = await this.runDemucs(decoded, audioContext);
        break;
      case 'aiBsRoformer':
        instrumental = await this.runBsRoformer(decoded, audioContext);
        break;
    }

    if (this.instrumentalCache.has(cacheKey)) {
      this.instrumentalCache.delete(cacheKey);
    }
    this.instrumentalCache.set(cacheKey, instrumental);
    while (this.instrumentalCache.size > MAX_CACHED_STEMS) {
      const oldest = this.instrumentalCache.keys().next().value;
      if (oldest === undefined) break;
      this.instrumentalCache.delete(oldest);
    }
    this.emit({ phase: 'ready', progress: 1, message: 'Instrumental stem ready' });
    return instrumental;
  }

  private async runMdx(decoded: AudioBuffer, audioContext: AudioContext): Promise<AudioBuffer> {
    if (!this.mdxClient) throw new Error('MDX separator unavailable');
    let working = decoded;
    if (Math.abs(decoded.sampleRate - MDX_SAMPLE_RATE) > 1) {
      working = await this.resampleBuffer(decoded, MDX_SAMPLE_RATE);
    }
    const left = working.getChannelData(0);
    const right = working.numberOfChannels > 1 ? working.getChannelData(1) : left;
    const { left: outL, right: outR } = await this.mdxClient.separateInstrumental(left, right);
    const buf = audioContext.createBuffer(2, outL.length, MDX_SAMPLE_RATE);
    buf.getChannelData(0).set(outL);
    buf.getChannelData(1).set(outR);
    return buf;
  }

  private async runDemucs(decoded: AudioBuffer, audioContext: AudioContext): Promise<AudioBuffer> {
    if (!this.demucs) throw new Error('HTDemucs processor unavailable');
    const targetRate = CONSTANTS.SAMPLE_RATE;
    let working = decoded;
    if (Math.abs(decoded.sampleRate - targetRate) > 1) {
      working = await this.resampleBuffer(decoded, targetRate);
    }
    const left = working.getChannelData(0);
    const right = working.numberOfChannels > 1 ? working.getChannelData(1) : left;
    this.emit({
      phase: 'separate',
      progress: 0.1,
      message: 'Running HTDemucs inference…',
      modelId: 'htDemucs'
    });
    await yieldToMainThread();
    const stems = await this.demucs.separate(left, right);
    await yieldToMainThread();
    const length = left.length;
    const instrumental = audioContext.createBuffer(2, length, targetRate);
    const outL = instrumental.getChannelData(0);
    const outR = instrumental.getChannelData(1);
    for (let i = 0; i < length; i++) {
      outL[i] = stems.drums.left[i] + stems.bass.left[i] + stems.other.left[i];
      outR[i] = stems.drums.right[i] + stems.bass.right[i] + stems.other.right[i];
      if ((i & 0xffff) === 0xffff) {
        // Periodic yield while mixing long stems.
        await yieldToMainThread();
      }
    }
    return instrumental;
  }

  /**
   * Best-effort BS-Roformer path.
   * The ViperX quantized ONNX is a no-STFT export that normally needs the MSS
   * band-split preprocessor (Python). In Electron WASM we cannot reliably port
   * that preprocessor without huge native deps — fail clearly so the UI toasts
   * and algorithmic / MDX / HTDemucs remain available. The model file is still
   * downloaded and cached under userData/models for future offline use.
   */
  private async runBsRoformer(
    _decoded: AudioBuffer,
    _audioContext: AudioContext
  ): Promise<AudioBuffer> {
    if (!this.bsSession) {
      throw new Error('BS-Roformer session unavailable');
    }
    const inputName = this.bsSession.inputNames[0] || '(none)';
    const outputName = this.bsSession.outputNames[0] || '(none)';
    this.emit({
      phase: 'error',
      progress: 0,
      message: `BS-Roformer loaded (in=${inputName}, out=${outputName}) but band-split STFT is not portable to ORT-WASM yet`,
      modelId: 'bsRoformer'
    });
    throw new Error(
      'BS-Roformer (ViperX) needs band-split STFT preprocessing not yet reliable in Electron WASM. Model is cached offline under userData/models. Choose UVR-MDX-NET Karaoke 2 (recommended) or HTDemucs for on-device AI now.'
    );
  }

  private async resampleBuffer(buffer: AudioBuffer, targetRate: number): Promise<AudioBuffer> {
    const offline = new OfflineAudioContext(
      buffer.numberOfChannels,
      Math.ceil(buffer.duration * targetRate),
      targetRate
    );
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start(0);
    return offline.startRendering();
  }

  public clearCache(): void {
    this.instrumentalCache.clear();
  }
}

let sharedSeparator: OfflineAiVocalSeparator | null = null;

export function getOfflineAiVocalSeparator(): OfflineAiVocalSeparator {
  if (!sharedSeparator) {
    sharedSeparator = new OfflineAiVocalSeparator();
  }
  return sharedSeparator;
}
