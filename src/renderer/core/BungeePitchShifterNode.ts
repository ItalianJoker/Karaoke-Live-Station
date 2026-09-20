import SignalsmithStretch, {
  type SignalsmithStretchNode
} from 'signalsmith-stretch';
import {
  BUNGEE_PITCH_ABSOLUTE_MAX,
  BUNGEE_PITCH_ABSOLUTE_MIN,
  clampBungeeAbsoluteSpeed
} from '../../shared/dspPitch';

/** Max wait for Signalsmith Stretch AudioWorklet factory (ms). */
const HIFI_INIT_TIMEOUT_MS = 8000;
/** Analyser FFT size for mute watchdog (power of 2). */
const WATCHDOG_FFT = 256;
/** Poll interval ≈ one Web Audio quantum @ 44.1 kHz (128/44100 ≈ 2.9 ms) × 4. */
const WATCHDOG_POLL_MS = 12;
/** Consecutive silent polls with live input before SoundTouch fallback. */
const WATCHDOG_SILENT_POLLS = 4;

/**
 * BungeePitchShifterNode (Hi-Fi DSP)
 *
 * Stereo pitch via **Signalsmith Stretch** (MIT) — successor to the broken
 * `bungee-pitch-shift@1.0.8` Wasm path. Settings id remains `bungee` (Hi-Fi)
 * for persistence; UI labels say Signalsmith / Hi-Fi.
 *
 * **Upstream:** https://github.com/Signalsmith-Audio/signalsmith-stretch (MIT)
 * npm: `signalsmith-stretch` (official Web Audio / AudioWorklet release).
 *
 * Live input: pitch via `schedule({ semitones })`. Tempo via HTMLMediaElement
 * with `preservesPitch` (browser time-stretch); Signalsmith live ignores `rate`.
 * SoundTouch remains emergency fallback on init failure or mute watchdog.
 *
 * **Critical invariant (Safety-First):** when pitch === 0 && speed === 1.0,
 * the Stretch node is disconnected (`input → output` direct) for true
 * zero-latency / zero-CPU bit-perfect pass-through.
 */
export class BungeePitchShifterNode {
  private readonly audioCtx: AudioContext;
  private readonly _input: GainNode;
  private readonly _output: GainNode;
  private stretch: SignalsmithStretchNode | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private semitones = 0;
  private speed = 1.0;
  private bypassActive = true;
  private disposed = false;
  private wasmReady = false;
  private underrunFallbackHandler: (() => void) | null = null;
  private underrunNotified = false;
  private silentPolls = 0;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private readonly watchdogIn = new Float32Array(WATCHDOG_FFT);
  private readonly watchdogOut = new Float32Array(WATCHDOG_FFT);

  private constructor(audioCtx: AudioContext) {
    this.audioCtx = audioCtx;
    this._input = audioCtx.createGain();
    this._output = audioCtx.createGain();
    this.applyBypassRouting(true);
  }

  /**
   * Creates Signalsmith Stretch, configures the default preset, and returns a
   * ready node. Throws on load / timeout so {@link AudioGraphManager} falls back
   * to SoundTouch.
   */
  public static async create(audioCtx: AudioContext): Promise<BungeePitchShifterNode> {
    const node = new BungeePitchShifterNode(audioCtx);
    await node.loadStretch();
    return node;
  }

  public get input(): GainNode {
    return this._input;
  }

  public get output(): GainNode {
    return this._output;
  }

  public get isWasmReady(): boolean {
    return this.wasmReady;
  }

  /**
   * Host callback when the mute watchdog fires (live input, silent wet).
   * Switch to SoundTouch without stopping playback.
   */
  public setUnderrunFallbackHandler(handler: (() => void) | null): void {
    this.underrunFallbackHandler = handler;
  }

  /**
   * Pre-registers the static Signalsmith Stretch AudioWorklet processor module.
   * Loading from public/workers/signalsmith_processor.js bypasses dynamic Blob
   * stringification of minified ${Module} inside AudioWorkletGlobalScope in Vite production builds.
   */
  public static async ensureWorkletModuleLoaded(audioCtx: AudioContext): Promise<boolean> {
    const ctxWithFlag = audioCtx as AudioContext & { __signalsmithWorkletLoaded?: boolean };
    if (ctxWithFlag.__signalsmithWorkletLoaded) return true;
    try {
      const scriptUrl = '/workers/signalsmith_processor.js';
      const response = await fetch(scriptUrl).catch(() =>
        fetch(new URL('workers/signalsmith_processor.js', window.location.href).href)
      );
      if (response.ok) {
        const scriptText = await response.text();
        const blob = new Blob([scriptText], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        await audioCtx.audioWorklet.addModule(blobUrl);
        URL.revokeObjectURL(blobUrl);
        ctxWithFlag.__signalsmithWorkletLoaded = true;
        return true;
      }
    } catch (err) {
      console.warn('[BungeePitchShifterNode] Could not pre-load static signalsmith worklet module:', err);
    }
    return false;
  }

  private async loadStretch(): Promise<void> {
    await BungeePitchShifterNode.ensureWorkletModuleLoaded(this.audioCtx);

    // Upstream: Signalsmith Stretch — MIT (official npm Web Audio release).
    const stretchPromise = SignalsmithStretch(this.audioCtx, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers'
    });

    const timeout = new Promise<never>((_, reject) => {
      window.setTimeout(
        () =>
          reject(
            new Error(`Signalsmith Stretch init timed out after ${HIFI_INIT_TIMEOUT_MS}ms`)
          ),
        HIFI_INIT_TIMEOUT_MS
      );
    });

    this.stretch = await Promise.race([stretchPromise, timeout]);
    await this.stretch.configure({ preset: 'default' });

    this.inputAnalyser = this.audioCtx.createAnalyser();
    this.outputAnalyser = this.audioCtx.createAnalyser();
    this.inputAnalyser.fftSize = WATCHDOG_FFT;
    this.outputAnalyser.fftSize = WATCHDOG_FFT;
    this.inputAnalyser.smoothingTimeConstant = 0;
    this.outputAnalyser.smoothingTimeConstant = 0;

    this.wasmReady = true;
    this.refreshBypass();
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    this.silentPolls = 0;
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    if (!this.inputAnalyser || !this.outputAnalyser) return;
    this.watchdogTimer = setInterval(() => {
      if (this.disposed || this.bypassActive || this.underrunNotified) return;
      try {
        this.inputAnalyser!.getFloatTimeDomainData(this.watchdogIn);
        this.outputAnalyser!.getFloatTimeDomainData(this.watchdogOut);
      } catch {
        return;
      }
      let inEnergy = 0;
      let outMax = 0;
      for (let i = 0; i < this.watchdogIn.length; i++) {
        const s = this.watchdogIn[i];
        inEnergy += s * s;
      }
      for (let i = 0; i < this.watchdogOut.length; i++) {
        const a = Math.abs(this.watchdogOut[i]);
        if (a > outMax) outMax = a;
      }
      const inRms = Math.sqrt(inEnergy / Math.max(1, this.watchdogIn.length));
      if (inRms > 0.001 && outMax < 1e-6) {
        this.silentPolls++;
      } else {
        this.silentPolls = 0;
      }
      if (this.silentPolls > WATCHDOG_SILENT_POLLS) {
        this.underrunNotified = true;
        this.stopWatchdog();
        // Dry pass-through immediately so the operator hears audio while host switches.
        this.applyBypassRouting(true);
        console.warn(
          '[BungeePitchShifterNode] Signalsmith mute watchdog — dry pass-through + SoundTouch fallback'
        );
        try {
          this.underrunFallbackHandler?.();
        } catch {
          /* ignore host errors */
        }
      }
    }, WATCHDOG_POLL_MS);
  }

  private applySchedule(): void {
    if (!this.stretch || this.bypassActive) return;
    const when = this.audioCtx.currentTime;
    void this.stretch.schedule({
      active: true,
      output: when,
      semitones: this.semitones,
      tonalityHz: 8000
    });
  }

  /**
   * Connects either input→output (bypass) or input→Signalsmith→output.
   */
  private applyBypassRouting(bypass: boolean): void {
    try {
      this._input.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.stretch?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.inputAnalyser?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.outputAnalyser?.disconnect();
    } catch {
      /* ignore */
    }

    this.bypassActive = bypass;
    if (bypass || !this.stretch) {
      this.stopWatchdog();
      void this.stretch?.schedule({ active: false, output: this.audioCtx.currentTime });
      this._input.connect(this._output);
    } else {
      // input → analyser → stretch → analyser → output
      this._input.connect(this.inputAnalyser!);
      this.inputAnalyser!.connect(this.stretch);
      this.stretch.connect(this.outputAnalyser!);
      this.outputAnalyser!.connect(this._output);
      this.applySchedule();
      void this.stretch.start({ active: true, semitones: this.semitones });
      this.startWatchdog();
    }
  }

  private refreshBypass(): void {
    // Tempo is HTMLMediaElement (+ preservesPitch). Signalsmith only needed for pitch ≠ 0.
    const needsDsp = this.semitones !== 0;
    if (needsDsp === this.bypassActive) {
      this.applyBypassRouting(!needsDsp);
    } else if (needsDsp && !this.bypassActive) {
      this.applySchedule();
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
    this.refreshBypass();
  }

  /**
   * Records playback speed for bypass decisions. Host drives tempo via
   * HTMLMediaElement.playbackRate (+ preservesPitch); Signalsmith live ignores rate.
   */
  public setPlaybackSpeed(speed: number): void {
    const clamped = clampBungeeAbsoluteSpeed(speed);
    if (clamped === this.speed) {
      this.refreshBypass();
      return;
    }
    this.speed = clamped;
    this.refreshBypass();
  }

  /** Resets Stretch state after seek (re-schedule current params). */
  public reset(): void {
    this.silentPolls = 0;
    this.underrunNotified = false;
    if (!this.bypassActive) {
      this.applySchedule();
    }
  }

  public get isBypassActive(): boolean {
    return this.bypassActive;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopWatchdog();
    try {
      void this.stretch?.stop();
      this._input.disconnect();
      this.stretch?.disconnect();
      this.inputAnalyser?.disconnect();
      this.outputAnalyser?.disconnect();
      this._output.disconnect();
    } catch {
      /* ignore teardown */
    }
    this.stretch = null;
    this.inputAnalyser = null;
    this.outputAnalyser = null;
    this.wasmReady = false;
    this.underrunFallbackHandler = null;
  }
}
