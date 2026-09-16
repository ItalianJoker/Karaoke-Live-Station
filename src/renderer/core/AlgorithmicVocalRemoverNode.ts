/**
 * AlgorithmicVocalRemoverNode
 *
 * Real-time, non-ML vocal reduction using classic mid/side DSP.
 * Built entirely from native Web Audio nodes (no ScriptProcessor, no ONNX, no Demucs)
 * so enabling it never blocks the audio thread or introduces buffer underruns.
 *
 * Algorithms (selectable from Settings):
 * - centerCancelBassKeep: cancel mid/center above ~160 Hz, keep mono bass (default karaoke)
 * - centerCancel: full mid mute (classic L−R karaoke)
 * - softMid: partial mid attenuation (gentler, fewer artifacts)
 */
import { rampAudioParam } from './audioGainRamp';

export type VocalRemoverAlgorithm = 'centerCancelBassKeep' | 'centerCancel' | 'softMid';

export const VOCAL_REMOVER_ALGORITHMS: VocalRemoverAlgorithm[] = [
  'centerCancelBassKeep',
  'centerCancel',
  'softMid'
];

export class AlgorithmicVocalRemoverNode {
  private readonly ctx: AudioContext;
  private readonly inputGain: GainNode;
  private readonly outputGain: GainNode;
  private readonly bypassGain: GainNode;
  private readonly effectGain: GainNode;

  private readonly splitter: ChannelSplitterNode;
  private readonly merger: ChannelMergerNode;

  /** Mid = (L+R)/2 built with two gains into a summer */
  private readonly midFromL: GainNode;
  private readonly midFromR: GainNode;
  private readonly midSum: GainNode;

  /** Side = (L−R)/2 */
  private readonly sideFromL: GainNode;
  private readonly sideFromR: GainNode;
  private readonly sideSum: GainNode;

  private readonly midLowpass: BiquadFilterNode;
  private readonly midHighpass: BiquadFilterNode;
  private readonly midLowGain: GainNode;
  private readonly midHighGain: GainNode;

  private readonly sideGain: GainNode;
  private readonly outLFromMid: GainNode;
  private readonly outRFromMid: GainNode;
  private readonly outLFromSide: GainNode;
  private readonly outRFromSide: GainNode;

  private enabled = false;
  private algorithm: VocalRemoverAlgorithm = 'centerCancelBassKeep';

  constructor(audioCtx: AudioContext) {
    this.ctx = audioCtx;

    this.inputGain = audioCtx.createGain();
    this.outputGain = audioCtx.createGain();
    this.bypassGain = audioCtx.createGain();
    this.effectGain = audioCtx.createGain();
    this.bypassGain.gain.value = 1;
    this.effectGain.gain.value = 0;

    this.splitter = audioCtx.createChannelSplitter(2);
    this.merger = audioCtx.createChannelMerger(2);

    this.midFromL = audioCtx.createGain();
    this.midFromR = audioCtx.createGain();
    this.midSum = audioCtx.createGain();
    this.midFromL.gain.value = 0.5;
    this.midFromR.gain.value = 0.5;

    this.sideFromL = audioCtx.createGain();
    this.sideFromR = audioCtx.createGain();
    this.sideSum = audioCtx.createGain();
    this.sideFromL.gain.value = 0.5;
    this.sideFromR.gain.value = -0.5;

    this.midLowpass = audioCtx.createBiquadFilter();
    this.midLowpass.type = 'lowpass';
    this.midLowpass.frequency.value = 160;
    this.midLowpass.Q.value = 0.707;

    this.midHighpass = audioCtx.createBiquadFilter();
    this.midHighpass.type = 'highpass';
    this.midHighpass.frequency.value = 160;
    this.midHighpass.Q.value = 0.707;

    this.midLowGain = audioCtx.createGain();
    this.midHighGain = audioCtx.createGain();
    this.sideGain = audioCtx.createGain();
    this.sideGain.gain.value = 1;

    this.outLFromMid = audioCtx.createGain();
    this.outRFromMid = audioCtx.createGain();
    this.outLFromSide = audioCtx.createGain();
    this.outRFromSide = audioCtx.createGain();
    this.outLFromMid.gain.value = 1;
    this.outRFromMid.gain.value = 1;
    this.outLFromSide.gain.value = 1;
    this.outRFromSide.gain.value = -1; // R = mid − side

    // Input splits into bypass + effect
    this.inputGain.connect(this.bypassGain);
    this.inputGain.connect(this.splitter);

    // Encode M/S
    this.splitter.connect(this.midFromL, 0);
    this.splitter.connect(this.midFromR, 1);
    this.midFromL.connect(this.midSum);
    this.midFromR.connect(this.midSum);

    this.splitter.connect(this.sideFromL, 0);
    this.splitter.connect(this.sideFromR, 1);
    this.sideFromL.connect(this.sideSum);
    this.sideFromR.connect(this.sideSum);

    // Mid band-split (bass keep / vocal band cancel)
    this.midSum.connect(this.midLowpass);
    this.midSum.connect(this.midHighpass);
    this.midLowpass.connect(this.midLowGain);
    this.midHighpass.connect(this.midHighGain);

    // Side path
    this.sideSum.connect(this.sideGain);

    // Decode M/S → stereo (mid contributes to both; side +L / −R)
    this.midLowGain.connect(this.outLFromMid);
    this.midHighGain.connect(this.outLFromMid);
    this.midLowGain.connect(this.outRFromMid);
    this.midHighGain.connect(this.outRFromMid);
    this.sideGain.connect(this.outLFromSide);
    this.sideGain.connect(this.outRFromSide);

    this.outLFromMid.connect(this.merger, 0, 0);
    this.outLFromSide.connect(this.merger, 0, 0);
    this.outRFromMid.connect(this.merger, 0, 1);
    this.outRFromSide.connect(this.merger, 0, 1);

    this.merger.connect(this.effectGain);
    this.bypassGain.connect(this.outputGain);
    this.effectGain.connect(this.outputGain);

    this.applyAlgorithmGains();
  }

  public get input(): AudioNode {
    return this.inputGain;
  }

  public get output(): AudioNode {
    return this.outputGain;
  }

  public getAlgorithm(): VocalRemoverAlgorithm {
    return this.algorithm;
  }

  public setAlgorithm(algorithm: VocalRemoverAlgorithm): void {
    if (this.algorithm === algorithm) return;
    this.algorithm = algorithm;
    this.applyAlgorithmGains();
  }

  public setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    // Short crossfade avoids clicks; setValueAtTime+ramp so Chromium actually applies it.
    if (enabled) {
      rampAudioParam(this.bypassGain.gain, 0, 0.05, this.ctx);
      rampAudioParam(this.effectGain.gain, 1, 0.05, this.ctx);
    } else {
      rampAudioParam(this.bypassGain.gain, 1, 0.05, this.ctx);
      rampAudioParam(this.effectGain.gain, 0, 0.05, this.ctx);
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  private applyAlgorithmGains(): void {
    const now = this.ctx.currentTime;
    // Defaults: keep mono bass, kill vocal band in mid, keep side
    let low = 1;
    let high = 0;
    let side = 1.15; // slight makeup for energy lost with mid cut

    switch (this.algorithm) {
      case 'centerCancel':
        low = 0;
        high = 0;
        side = 1.25;
        break;
      case 'softMid':
        low = 0.85;
        high = 0.28;
        side = 1.05;
        break;
      case 'centerCancelBassKeep':
      default:
        low = 1;
        high = 0.05;
        side = 1.15;
        break;
    }

    this.midLowGain.gain.setTargetAtTime(low, now, 0.02);
    this.midHighGain.gain.setTargetAtTime(high, now, 0.02);
    this.sideGain.gain.setTargetAtTime(side, now, 0.02);
  }

  public dispose(): void {
    try {
      this.inputGain.disconnect();
      this.outputGain.disconnect();
      this.bypassGain.disconnect();
      this.effectGain.disconnect();
      this.splitter.disconnect();
      this.merger.disconnect();
    } catch {
      // ignore teardown races
    }
  }
}
