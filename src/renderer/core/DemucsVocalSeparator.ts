import * as ort from 'onnxruntime-web';
import { DemucsProcessor, CONSTANTS } from 'demucs-web';

export type VocalSeparatorProgress = {
  phase: 'model' | 'decode' | 'separate' | 'ready' | 'error';
  progress: number;
  message: string;
};

export type ProgressListener = (info: VocalSeparatorProgress) => void;

/**
 * Offline ML vocal remover powered by Meta HTDemucs via demucs-web + onnxruntime-web.
 *
 * Why this library (not DIY EQ / center-channel cancel):
 * - demucs-web is a dedicated open-source music source-separation package (MIT)
 * - Runs Meta's battle-tested HTDemucs ONNX model entirely in-process
 * - Compatible with Electron renderer / Web Audio (no native rebuild required)
 * - Produces true stems (drums / bass / other / vocals) so the instrumental keeps
 *   brightness and stereo image instead of the muffled artifacts of frequency cuts
 *
 * Separation is offline (chunked inference). Results are cached per media URL so
 * toggling the remover mid-show reuses the instrumental without re-running ML.
 *
 * Cache lifecycle: Map insertion order is used as a tiny LRU (MAX_CACHED_STEMS).
 * AudioBuffers are large; without eviction, long shows would retain every stem
 * for the night. clearCache() is also called from AudioGraphManager.dispose /
 * track changes so we never keep buffers for a media element that was replaced.
 */
export class DemucsVocalSeparator {
  /** Hard cap on retained instrumental stems — each buffer can be tens of MB. */
  private static readonly MAX_CACHED_STEMS = 4;

  private processor: DemucsProcessor | null = null;
  private modelReady = false;
  private modelLoadPromise: Promise<void> | null = null;
  private readonly instrumentalCache = new Map<string, AudioBuffer>();
  private readonly inFlight = new Map<string, Promise<AudioBuffer>>();
  private listeners = new Set<ProgressListener>();

  public onProgress(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(info: VocalSeparatorProgress): void {
    for (const listener of this.listeners) {
      try {
        listener(info);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Lazily loads onnxruntime-web + HTDemucs weights (from main-process cache when available).
   */
  public async ensureModel(): Promise<void> {
    if (this.modelReady) return;
    if (this.modelLoadPromise) return this.modelLoadPromise;

    this.modelLoadPromise = (async () => {
      this.emit({ phase: 'model', progress: 0, message: 'Loading HTDemucs model…' });

      // Single-threaded WASM is the most reliable path inside Electron sandboxes.
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.simd = true;
      // Serve local WASM assets copied into /public/ort during build/dev.
      ort.env.wasm.wasmPaths = './ort/';

      this.processor = new DemucsProcessor({
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
            message: `Separating stems… ${Math.round(progress * 100)}%`
          });
        },
        onLog: (phase: string, message: string) => {
          this.emit({ phase: 'model', progress: 0.05, message: `[${phase}] ${message}` });
        },
        onDownloadProgress: (loaded: number, total: number) => {
          const ratio = total > 0 ? loaded / total : 0;
          this.emit({
            phase: 'model',
            progress: ratio,
            message: `Downloading HTDemucs model… ${Math.round(ratio * 100)}%`
          });
        }
      });

      let modelBuffer: ArrayBuffer | null = null;
      if (typeof window !== 'undefined' && window.karaokeApi?.demucs?.getModelBuffer) {
        try {
          modelBuffer = await window.karaokeApi.demucs.getModelBuffer();
        } catch (err) {
          console.warn('Demucs model IPC cache miss, falling back to direct fetch:', err);
        }
      }

      if (modelBuffer && modelBuffer.byteLength > 0) {
        await this.processor.loadModel(modelBuffer);
      } else {
        await this.processor.loadModel(CONSTANTS.DEFAULT_MODEL_URL);
      }

      this.modelReady = true;
      this.emit({ phase: 'model', progress: 1, message: 'HTDemucs model ready' });
    })();

    try {
      await this.modelLoadPromise;
    } finally {
      this.modelLoadPromise = null;
    }
  }

  /** Returns a previously separated instrumental when present in memory cache. */
  public getCachedInstrumental(cacheKey: string): AudioBuffer | null {
    return this.instrumentalCache.get(cacheKey) || null;
  }

  /**
   * Separates vocals from a media URL and returns an instrumental AudioBuffer
   * (drums + bass + other). Concurrent calls for the same key coalesce.
   */
  public async separateInstrumentalFromUrl(
    mediaUrl: string,
    audioContext: AudioContext,
    cacheKey: string = mediaUrl
  ): Promise<AudioBuffer> {
    const cached = this.instrumentalCache.get(cacheKey);
    if (cached) return cached;

    const existing = this.inFlight.get(cacheKey);
    if (existing) return existing;

    const work = this.runSeparation(mediaUrl, audioContext, cacheKey);
    this.inFlight.set(cacheKey, work);
    try {
      return await work;
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  private async runSeparation(
    mediaUrl: string,
    audioContext: AudioContext,
    cacheKey: string
  ): Promise<AudioBuffer> {
    await this.ensureModel();
    if (!this.processor) {
      throw new Error('Demucs processor unavailable');
    }

    this.emit({ phase: 'decode', progress: 0.1, message: 'Decoding audio for separation…' });
    const response = await fetch(mediaUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch media for vocal separation (HTTP ${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));

    const targetRate = CONSTANTS.SAMPLE_RATE;
    let working = decoded;
    if (Math.abs(decoded.sampleRate - targetRate) > 1) {
      working = await this.resampleBuffer(decoded, targetRate);
    }

    const left = working.getChannelData(0);
    const right = working.numberOfChannels > 1 ? working.getChannelData(1) : left;

    this.emit({ phase: 'separate', progress: 0.15, message: 'Running HTDemucs inference…' });
    const stems = await this.processor.separate(left, right);

    const length = left.length;
    const instrumental = audioContext.createBuffer(2, length, targetRate);
    const outL = instrumental.getChannelData(0);
    const outR = instrumental.getChannelData(1);

    // Karaoke instrumental = drums + bass + other (exclude vocals)
    for (let i = 0; i < length; i++) {
      outL[i] = stems.drums.left[i] + stems.bass.left[i] + stems.other.left[i];
      outR[i] = stems.drums.right[i] + stems.bass.right[i] + stems.other.right[i];
    }

    // Refresh LRU position: delete+set moves the key to Map insertion tail.
    if (this.instrumentalCache.has(cacheKey)) {
      this.instrumentalCache.delete(cacheKey);
    }
    this.instrumentalCache.set(cacheKey, instrumental);
    while (this.instrumentalCache.size > DemucsVocalSeparator.MAX_CACHED_STEMS) {
      const oldestKey = this.instrumentalCache.keys().next().value;
      if (oldestKey === undefined) break;
      this.instrumentalCache.delete(oldestKey);
    }
    this.emit({ phase: 'ready', progress: 1, message: 'Instrumental stem ready' });
    return instrumental;
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

/** Process-wide singleton so React remounts never reload the ONNX session. */
let sharedSeparator: DemucsVocalSeparator | null = null;

export function getDemucsVocalSeparator(): DemucsVocalSeparator {
  if (!sharedSeparator) {
    sharedSeparator = new DemucsVocalSeparator();
  }
  return sharedSeparator;
}
