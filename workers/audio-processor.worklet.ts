/**
 * AudioWorkletProcessor per il disaccoppiamento matematico di Pitch e Time-Stretching
 */

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor
): void;

class PitchTimeProcessor extends AudioWorkletProcessor {
  private pitchSemi: number = 0;
  private bufferL: Float32Array = new Float32Array(4096);
  private bufferR: Float32Array = new Float32Array(4096);
  private writeIndex: number = 0;
  private readIndex: number = 0;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent) => {
      const { type, value } = event.data;
      if (type === 'set-pitch') {
        this.pitchSemi = typeof value === 'number' ? Math.max(-8, Math.min(8, value)) : 0;
      }
    };
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    _parameters: Record<string, Float32Array>
  ): boolean {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || input.length === 0 || !output || output.length === 0) {
      return true;
    }

    const inL = input[0];
    const inR = input[1] || input[0];
    const outL = output[0];
    const outR = output[1] || output[0];

    const pitchRatio = Math.pow(2, this.pitchSemi / 12);
    const effectiveStep = pitchRatio;
    const bufLen = this.bufferL.length;

    for (let i = 0; i < inL.length; i++) {
      this.bufferL[this.writeIndex] = inL[i];
      this.bufferR[this.writeIndex] = inR[i];
      this.writeIndex = (this.writeIndex + 1) % bufLen;

      const rIdxFloor = Math.floor(this.readIndex);
      const frac = this.readIndex - rIdxFloor;
      const nextIdx = (rIdxFloor + 1) % bufLen;

      const sampleL = this.bufferL[rIdxFloor] * (1 - frac) + this.bufferL[nextIdx] * frac;
      const sampleR = this.bufferR[rIdxFloor] * (1 - frac) + this.bufferR[nextIdx] * frac;

      outL[i] = sampleL;
      if (outR) outR[i] = sampleR;

      this.readIndex = (this.readIndex + effectiveStep) % bufLen;
    }

    return true;
  }
}

registerProcessor('pitch-time-processor', PitchTimeProcessor);
