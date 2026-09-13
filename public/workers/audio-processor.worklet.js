/**
 * AudioWorkletProcessor per il disaccoppiamento matematico di Pitch e Time-Stretching
 */
class PitchTimeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pitchSemi = 0;
    this.bufferL = new Float32Array(4096);
    this.bufferR = new Float32Array(4096);
    this.writeIndex = 0;
    this.readIndex = 0;
    this.port.onmessage = (event) => {
      const { type, value } = event.data;
      if (type === 'set-pitch') {
        this.pitchSemi = typeof value === 'number' ? Math.max(-8, Math.min(8, value)) : 0;
      }
    };
  }

  process(inputs, outputs) {
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

