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
  }

  export class DemucsProcessor {
    constructor(options: DemucsProcessorOptions);
    loadModel(modelPathOrBuffer?: string | ArrayBuffer): Promise<unknown>;
    separate(left: Float32Array, right: Float32Array): Promise<SeparationResult>;
  }
}
