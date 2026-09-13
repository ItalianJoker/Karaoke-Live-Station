declare module 'soundtouchjs' {
  export interface FifoSampleBuffer {
    putSamples: (samples: Float32Array, position?: number, numFrames?: number) => void;
    receiveSamples: (output: Float32Array, numFrames?: number) => void;
    clear: () => void;
    frameCount: number;
    vector: Float32Array;
  }

  export class SoundTouch {
    constructor();
    rate: number;
    tempo: number;
    pitch: number;
    pitchSemitones: number;
    pitchOctaves: number;
    virtualPitch: number;
    virtualRate: number;
    virtualTempo: number;
    inputBuffer: FifoSampleBuffer;
    outputBuffer: FifoSampleBuffer;
    process: () => void;
    clear: () => void;
  }
}

