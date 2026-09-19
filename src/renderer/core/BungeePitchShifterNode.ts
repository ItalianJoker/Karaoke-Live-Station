import {
  BUNGEE_PITCH_ABSOLUTE_MAX,
  BUNGEE_PITCH_ABSOLUTE_MIN,
  clampPlaybackSpeed,
  isDspNeutralBypass
} from '../../shared/dspPitch';

/**
 * BungeePitchShifterNode
 *
 * Stereo pitch + independent speed via Bungee phase-vocoder Wasm AudioWorklet.
 *
 * **Upstream (runtime Wasm only — no C++ source vendored):**
 * https://github.com/bungee-audio-stretch/bungee — Mozilla Public License 2.0 (MPL-2.0).
 * Prebuilt assets: `public/workers/bungee_processor.js`, `public/workers/bungee.wasm`
 * (see `public/workers/BUNGEE_NOTICE.md`).
 *
 * **Critical invariant (Safety-First):** when pitch === 0 && speed === 1.0,
 * the AudioWorklet is disconnected (`input → output` direct) for true
 * zero-latency / zero-CPU bit-perfect pass-through.
 */
export class BungeePitchShifterNode {
  private readonly audioCtx: AudioContext;
  private readonly _input: GainNode;
  private readonly _output: GainNode;
  private worklet: AudioWorkletNode | null = null;
  private semitones = 0;
  private speed = 1.0;
  private bypassActive = true;
  private disposed = false;

  private constructor(audioCtx: AudioContext) {
    this.audioCtx = audioCtx;
    this._input = audioCtx.createGain();
    this._output = audioCtx.createGain();
    this.applyBypassRouting(true);
  }

  /**
   * Loads the Bungee AudioWorklet (blob URL, same pattern as SpessaSynth) and
   * returns a ready node. Throws on load / init failure so the caller can
   * fall back to SoundTouch silently.
   */
  public static async create(audioCtx: AudioContext): Promise<BungeePitchShifterNode> {
    const node = new BungeePitchShifterNode(audioCtx);
    await node.loadWorklet();
    return node;
  }

  public get input(): GainNode {
    return this._input;
  }

  public get output(): GainNode {
    return this._output;
  }

  /**
   * Fetches `bungee_processor.js` and registers it via AudioWorklet.
   * Uses a blob URL so Electron `file://` / packaged paths stay CORS-safe.
   *
   * License note at load site: Bungee Wasm from
   * https://github.com/bungee-audio-stretch/bungee (MPL-2.0). No upstream
   * `.cpp`/`.h` trees are present in this repository.
   */
  private async loadWorklet(): Promise<void> {
    // Upstream: https://github.com/bungee-audio-stretch/bungee — MPL-2.0 (Wasm prebuilt only).
    const scriptUrl = '/workers/bungee_processor.js';
    const response = await fetch(scriptUrl).catch(() =>
      fetch(new URL('workers/bungee_processor.js', window.location.href).href)
    );
    if (!response.ok) {
      throw new Error(`Bungee processor fetch failed: HTTP ${response.status}`);
    }
    const scriptText = await response.text();
    const blob = new Blob([scriptText], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    try {
      await this.audioCtx.audioWorklet.addModule(blobUrl);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }

    this.worklet = new AudioWorkletNode(this.audioCtx, 'bungee-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers'
    });

    this.worklet.port.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; message?: string };
      if (data?.type === 'error') {
        console.warn('[BungeePitchShifterNode]', data.message ?? 'worklet error');
      }
    };

    this.send('setPitch', this.semitones);
    this.send('setSpeed', this.speed);
    this.send('setMix', 1.0);
  }

  private send(type: string, value?: number): void {
    if (!this.worklet) return;
    this.worklet.port.postMessage(
      value === undefined ? { type } : { type, value }
    );
  }

  /**
   * Connects either input→output (bypass) or input→worklet→output.
   */
  private applyBypassRouting(bypass: boolean): void {
    try {
      this._input.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.worklet?.disconnect();
    } catch {
      /* ignore */
    }

    this.bypassActive = bypass;
    if (bypass || !this.worklet) {
      this._input.connect(this._output);
    } else {
      this._input.connect(this.worklet);
      this.worklet.connect(this._output);
    }
  }

  private refreshBypass(): void {
    const needsDsp = !isDspNeutralBypass(this.semitones, this.speed);
    if (needsDsp === this.bypassActive) {
      this.applyBypassRouting(!needsDsp);
    }
  }

  /**
   * Sets live pitch offset in whole semitones (absolute clamp ±12).
   * Neutral with speed 1.0 → true bypass.
   */
  public setPitchOffset(semitones: number): void {
    const clamped = Math.max(
      BUNGEE_PITCH_ABSOLUTE_MIN,
      Math.min(
        BUNGEE_PITCH_ABSOLUTE_MAX,
        Math.round(Number.isFinite(semitones) ? semitones : 0)
      )
    );
    if (clamped === this.semitones) {
      this.refreshBypass();
      return;
    }
    this.semitones = clamped;
    this.send('setPitch', clamped);
    this.refreshBypass();
  }

  /**
   * Sets independent playback speed (0.50x–1.50x). Neutral with pitch 0 → bypass.
   */
  public setPlaybackSpeed(speed: number): void {
    const clamped = clampPlaybackSpeed(speed);
    if (clamped === this.speed) {
      this.refreshBypass();
      return;
    }
    this.speed = clamped;
    this.send('setSpeed', clamped);
    this.refreshBypass();
  }

  /** Resets internal Bungee grain state (e.g. after seek). */
  public reset(): void {
    this.send('reset');
  }

  public get isBypassActive(): boolean {
    return this.bypassActive;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this._input.disconnect();
      this.worklet?.disconnect();
      if (this.worklet) {
        this.worklet.port.onmessage = null;
      }
      this._output.disconnect();
    } catch {
      /* ignore teardown */
    }
    this.worklet = null;
  }
}
