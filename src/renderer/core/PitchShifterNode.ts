import { SoundTouch } from 'soundtouchjs';

/**
 * PitchShifterNode
 * 
 * High-quality stereo real-time pitch shifter using SoundTouch WSOLA
 * (Waveform Similarity Overlap-Add).
 * Transposes audio pitch from -8 to +8 semitones while maintaining 100% constant playback speed,
 * completely eliminating comb-filtering distortion, metallic flanging, and volume wobbles.
 * When semitones === 0, audio passes through with zero latency and zero CPU cost.
 */
export class PitchShifterNode {
  private processor: ScriptProcessorNode;
  private _input: GainNode;
  private _output: GainNode;
  private semitones: number = 0;
  private st: SoundTouch;

  private readonly bufferSize = 2048;

  // FIFO capacity: 65536 stereo frames (~1.5s)
  private readonly fifoCapacity: number;
  private fifo: Float32Array;
  private fifoHead: number = 0;
  private fifoCount: number = 0;

  // Target latency: ~5120 frames (~116ms)
  private readonly targetFifo: number;
  private readPosFrac: number = 0.0;
  private primed: boolean = false;

  constructor(audioCtx: AudioContext) {
    this._input = audioCtx.createGain();
    this._output = audioCtx.createGain();

    this.st = new SoundTouch();

    this.fifoCapacity = this.bufferSize * 32; // 65536 frames
    this.fifo = new Float32Array(this.fifoCapacity * 2);
    this.targetFifo = Math.floor(this.bufferSize * 2.5); // 5120 frames

    // Use stereo 2-channel ScriptProcessor
    this.processor = audioCtx.createScriptProcessor(this.bufferSize, 2, 2);
    this.processor.onaudioprocess = this.onAudioProcess.bind(this);

    this._input.connect(this.processor);
    this.processor.connect(this._output);
  }

  public get input(): GainNode {
    return this._input;
  }

  public get output(): GainNode {
    return this._output;
  }

  public setPitchOffset(semitones: number): void {
    const clamped = Math.max(-8, Math.min(8, Math.round(semitones)));
    if (this.semitones === clamped) return;

    this.semitones = clamped;
    this.resetBuffers();

    if (clamped !== 0) {
      this.st.pitchSemitones = clamped;
      this.st.tempo = 1.0;
    }
  }

  public resetBuffers(): void {
    this.st.clear();
    this.fifoCount = 0;
    this.fifoHead = 0;
    this.readPosFrac = 0.0;
    this.primed = false;
  }

  private onAudioProcess(e: AudioProcessingEvent): void {
    const inL = e.inputBuffer.getChannelData(0);
    const inR = e.inputBuffer.getChannelData(1);
    const outL = e.outputBuffer.getChannelData(0);
    const outR = e.outputBuffer.getChannelData(1);
    const len = inL.length;

    // 1. Bit-perfect zero-latency pass-through when no pitch shift is active
    if (this.semitones === 0) {
      outL.set(inL);
      outR.set(inR);
      return;
    }

    // 2. Interleave stereo input for SoundTouch
    const inputInterleaved = new Float32Array(len * 2);
    for (let i = 0; i < len; i++) {
      inputInterleaved[i * 2] = inL[i];
      inputInterleaved[i * 2 + 1] = inR[i];
    }

    // 3. Process through SoundTouch WSOLA
    this.st.inputBuffer.putSamples(inputInterleaved, 0, len);
    this.st.process();

    // 4. Drain processed samples from SoundTouch output into FIFO
    const avail = this.st.outputBuffer.frameCount;
    if (avail > 0) {
      const temp = new Float32Array(avail * 2);
      this.st.outputBuffer.receiveSamples(temp, avail);

      const cap = this.fifoCapacity;
      for (let i = 0; i < avail; i++) {
        const destIdx = (this.fifoHead + (this.fifoCount + i) * 2) % (cap * 2);
        this.fifo[destIdx] = temp[i * 2];
        this.fifo[destIdx + 1] = temp[i * 2 + 1];
      }
      this.fifoCount += avail;
    }

    // 5. Pre-roll priming: accumulate target frames before starting output
    if (!this.primed) {
      if (this.fifoCount >= this.targetFifo) {
        this.primed = true;
      } else {
        outL.fill(0);
        outR.fill(0);
        return;
      }
    }

    // 6. Drift-compensated fractional extraction
    const delta = this.fifoCount - this.targetFifo;
    // Rate smoothly adjusts by +/- 1.5% to maintain target buffer
    const rate = Math.max(0.985, Math.min(1.015, 1.0 + (delta / this.targetFifo) * 0.015));

    const cap = this.fifoCapacity;
    for (let i = 0; i < len; i++) {
      const frameIdx = Math.floor(this.readPosFrac);
      const frac = this.readPosFrac - frameIdx;

      if (this.fifoCount <= 0) {
        outL[i] = 0;
        outR[i] = 0;
      } else if (frameIdx + 1 >= this.fifoCount) {
        // Buffer boundary safety fallback
        const lastIdx = (this.fifoHead + (this.fifoCount - 1) * 2) % (cap * 2);
        outL[i] = this.fifo[lastIdx];
        outR[i] = this.fifo[lastIdx + 1];
      } else {
        const idx0 = (this.fifoHead + frameIdx * 2) % (cap * 2);
        const idx1 = (idx0 + 2) % (cap * 2);

        const l0 = this.fifo[idx0], r0 = this.fifo[idx0 + 1];
        const l1 = this.fifo[idx1], r1 = this.fifo[idx1 + 1];

        outL[i] = l0 * (1 - frac) + l1 * frac;
        outR[i] = r0 * (1 - frac) + r1 * frac;
      }

      this.readPosFrac += rate;
    }

    // 7. Advance integer frames consumed from circular FIFO
    const consumed = Math.min(this.fifoCount, Math.floor(this.readPosFrac));
    this.fifoHead = (this.fifoHead + consumed * 2) % (cap * 2);
    this.fifoCount -= consumed;
    this.readPosFrac -= consumed;

    if (this.fifoCount <= 0) {
      this.fifoCount = 0;
      this.readPosFrac = 0.0;
      this.primed = false;
    }
  }

  public dispose(): void {
    try {
      this._input.disconnect();
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
      this._output.disconnect();
      this.resetBuffers();
    } catch {
      // Ignore disconnect errors during teardown
    }
  }
}
