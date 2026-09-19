/**
 * Ambient module declaration for demucs-web (JS-only package).
 */
declare module 'demucs-web' {
  import type * as OrtNamespace from 'onnxruntime-web';

  export const CONSTANTS: {
    SAMPLE_RATE: number;
    FFT_SIZE: number;
    HOP_SIZE: number;
    TRAINING_SAMPLES: number;
    MODEL_SPEC_BINS: number;
    MODEL_SPEC_FRAMES: number;
    SEGMENT_OVERLAP: number;
    TRACKS: string[];
    DEFAULT_MODEL_URL: string;
  };

  export interface StemChannels {
    left: Float32Array;
    right: Float32Array;
  }

  export interface SeparationResult {
    drums: StemChannels;
    bass: StemChannels;
    other: StemChannels;
    vocals: StemChannels;
  }

  export interface DemucsProcessorOptions {
    ort: typeof OrtNamespace;
    modelPath?: string;
    sessionOptions?: Record<string, unknown>;
    onProgress?: (info: {
      progress: number;
      currentSegment: number;
      totalSegments: number;
    }) => void;
    onLog?: (phase: string, message: string) => void;
    onDownloadProgress?: (loaded: number, total: number) => void;
    /** KLS advanced knobs — injected for Settings pipeline (optional). */
    demucsShifts?: number;
    demucsSegmentSize?: number;
    demucsOverlap?: number;
  }

  export function prepareModelInput(
    leftChannel: Float32Array,
    rightChannel: Float32Array
  ): { waveform: Float32Array; magSpec: Float32Array; numBins: number; numFrames: number; originalLength: number };

  export function standaloneMask(freqOutput: Float32Array): unknown[];
  export function standaloneIspec(
    trackSpec: unknown,
    targetLength: number
  ): StemChannels;

  export class DemucsProcessor {
    session: OrtNamespace.InferenceSession | null;
    ort: typeof OrtNamespace;
    onProgress: (info: {
      progress: number;
      currentSegment: number;
      totalSegments: number;
    }) => void;
    demucsShifts?: number;
    demucsSegmentSize?: number;
    demucsOverlap?: number;
    constructor(options: DemucsProcessorOptions);
    loadModel(modelPathOrBuffer?: string | ArrayBuffer): Promise<unknown>;
    separate(left: Float32Array, right: Float32Array): Promise<SeparationResult>;
  }
}

declare module 'fft.js' {
  export default class FFT {
    constructor(size: number);
    createComplexArray(): number[];
    transform(out: number[], data: ArrayLike<number>): void;
    inverseTransform(out: number[], data: ArrayLike<number>): void;
    realTransform(out: number[], data: ArrayLike<number>): void;
    completeSpectrum(data: number[]): void;
  }
}
