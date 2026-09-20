import { MidiLyricEvent, MidiParsedSong } from '../../shared/types';
import {
  clampPitchForEngine,
  clampSpeedForEngine,
  coerceDspPitchEngine,
  type DspPitchEngine
} from '../../shared/dspPitch';
import { MidiParser, TimedMidiEvent } from './MidiParser';
import { PitchShifterNode } from './PitchShifterNode';
import { BungeePitchShifterNode } from './BungeePitchShifterNode';
import { WorkletSynthesizer } from 'spessasynth_lib';
import {
  AlgorithmicVocalRemoverNode,
  type VocalRemoverAlgorithm
} from './AlgorithmicVocalRemoverNode';
import {
  coerceAlgorithmicVocalRemoverMethod,
  type AlgorithmicVocalRemoverMethod,
  type VocalRemoverMethod
} from '../../shared/vocalRemover';

/**
 * Callback receiving updated synchronized MIDI/KAR lyrics.
 */
export type LyricCallback = (lyric: MidiLyricEvent | null) => void;

/**
 * Callback invoked when MIDI sequence playback reaches duration end.
 */
export type PlaybackEndCallback = () => void;

/**
 * Tracks an active voice in fallback oscillator synthesis mode.
 */
interface ActiveMidiVoice {
  channel: number;
  note: number;
  sourceNode: AudioScheduledSourceNode;
  gainNode: GainNode;
  stopTime?: number;
}

/**
 * Master Web Audio graph for Control Desk playback (media + MIDI/KAR).
 *
 * - Media element pitch/speed DSP: **Bungee** (default, Wasm AudioWorklet) or
 *   **SoundTouch** WSOLA (selectable legacy/light) — see {@link setDspEngine}
 * - Independent tempo scaling (0.50x to 1.50x)
 * - Guide-vocal removal: realtime algorithmic mid/side DSP only (never live AI)
 * - Auto-ducking BGM attenuation when microphone input or host talks
 * - AudioWorklet-based General MIDI / SoundFont 2 synthesis via SpessaSynth
 * - Real-time channel muting (channels 0-15) without desynchronizing lyrics
 * - Continuous MIDI event scheduling (5 ms clock — see {@link startSchedulerTimer})
 * - Secondary device CUE / Pre-listening routing (setSinkId)
 *
 * **Critical invariants (Safety-First):**
 * - `latencyHint: 'playback'` on AudioContext (stable buffer, not interactive)
 * - Master gain = `volume²` clamped [0,1] ({@link computePerceptualGain})
 * - Pitch 0 (+ speed 1.0 for Bungee) bypasses DSP (bit-perfect / zero CPU)
 * - SpessaSynth MIDI scheduler ticks every **5 ms** (worker or fallback interval)
 * - MIDI/KAR pitch is note-number transpose — never routed through media DSP
 *
 * @see scripts/verify-critical-invariants.js
 */
export class AudioGraphManager {
  private audioCtx: AudioContext | null = null;
  private mediaElement: HTMLMediaElement | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  /** Stable bridge so vocal-remover wiring survives engine swaps. */
  private dspBridgeIn: GainNode | null = null;
  private dspBridgeOut: GainNode | null = null;
  /** SoundTouch WSOLA path — kept selectable; do not remove. */
  private pitchShifterNode: PitchShifterNode | null = null;
  /** Bungee Wasm path (default). */
  private bungeeNode: BungeePitchShifterNode | null = null;
  /** Operator preference from Settings (`dspEngine`). */
  private preferredDspEngine: DspPitchEngine = 'soundtouch';
  /** Engine currently wired into the bridge (may be SoundTouch after silent fallback). */
  private activeDspEngine: DspPitchEngine | null = null;
  private dspInitGeneration = 0;
  /** In-flight ensureDspEngine promise — dedupes concurrent bind/setDspEngine calls. */
  private dspEnsurePromise: Promise<void> | null = null;

  // Vocal Remover — algorithmic mid/side DSP only (live); AI ids coerce to default algo
  private vocalRemoverNode: AlgorithmicVocalRemoverNode | null = null;
  private vocalRemoverMethod: AlgorithmicVocalRemoverMethod = 'centerCancelBassKeep';
  /** @deprecated alias kept for call sites that still say "algorithm" */
  private get vocalRemoverAlgorithm(): VocalRemoverAlgorithm {
    return this.vocalRemoverMethod;
  }

  // Ducking, Delay Sync & Master Gain
  private duckingGainNode: GainNode | null = null;
  private syncDelayNode: DelayNode | null = null;
  private masterGainNode: GainNode | null = null;
  private cueGainNode: GainNode | null = null;
  private cueAudioElement: HTMLAudioElement | null = null;

  // Audio Normalization (Dynamic Range Compression / Auto-Leveling)
  private normalizerCompressorNode: DynamicsCompressorNode | null = null;
  private normalizerGainNode: GainNode | null = null;
  private isNormalizationActive: boolean = true;

  // MIDI Synthesizer State
  private isMidiMode: boolean = false;
  private midiSong: MidiParsedSong | null = null;
  private midiEvents: TimedMidiEvent[] = [];
  private midiEventIndex: number = 0;
  private midiPlaybackStartTimeMs: number = 0;
  private midiPlaybackOffsetMs: number = 0;
  private workerTimer: Worker | null = null;
  private fallbackIntervalId: number | null = null;
  private activeMidiNotes: Map<number, number> = new Map();
  private activeVoices: ActiveMidiVoice[] = [];
  /** Pending note-release timers — cleared on dispose so they cannot mutate a torn-down graph. */
  private voiceReleaseTimeouts: ReturnType<typeof setTimeout>[] = [];
  private soundFontBuffer: ArrayBuffer | null = null;
  private soundFontLoadedPath: string = '';
  private soundFontLoadingPromise: Promise<boolean> | null = null;
  private workletSynth: WorkletSynthesizer | null = null;
  private isWorkletModuleLoaded: boolean = false;

  // Real-time parameters
  private currentPitchOffset: number = 0;
  private currentPlaybackSpeed: number = 1.0;
  private mutedChannels: Set<number> = new Set();
  private isVocalRemoverEnabled: boolean = false;
  private isDuckingActive: boolean = false;

  // Callbacks
  private onLyricCallback: LyricCallback | null = null;
  private onEndCallback: PlaybackEndCallback | null = null;
  private currentLyricIndex: number = -1;

  constructor() {
    // AudioContext will be initialized on first user gesture / track load
  }

  /**
   * Lazily initializes and resumes the main AudioContext, wiring the master gain,
   * delay sync, and ducking nodes.
   *
   * Why `latencyHint: 'playback'`: favors larger, stable buffers for karaoke PA
   * over lowest-latency interactive mode (reduces underruns under UI load).
   *
   * @returns The active AudioContext instance
   */
  public async initAudioContext(): Promise<AudioContext> {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      // INVARIANT: keep latencyHint 'playback' — do not switch to 'interactive' without measuring Stage sync.
      this.audioCtx = new AudioCtxClass({ latencyHint: 'playback' });

      // Master Output Graph
      this.masterGainNode = this.audioCtx.createGain();
      this.masterGainNode.gain.setValueAtTime(1.0, this.audioCtx.currentTime);

      this.duckingGainNode = this.audioCtx.createGain();
      this.duckingGainNode.gain.setValueAtTime(1.0, this.audioCtx.currentTime);

      this.syncDelayNode = this.audioCtx.createDelay(1.0);
      this.syncDelayNode.delayTime.setValueAtTime(0, this.audioCtx.currentTime);

      this.cueGainNode = this.audioCtx.createGain();
      this.cueGainNode.gain.setValueAtTime(1.0, this.audioCtx.currentTime);

      // Audio Normalization Nodes (Dynamics Compressor + Leveling Makeup Gain)
      this.normalizerCompressorNode = this.audioCtx.createDynamicsCompressor();
      this.normalizerCompressorNode.threshold.setValueAtTime(-22, this.audioCtx.currentTime);
      this.normalizerCompressorNode.knee.setValueAtTime(24, this.audioCtx.currentTime);
      this.normalizerCompressorNode.ratio.setValueAtTime(6, this.audioCtx.currentTime);
      this.normalizerCompressorNode.attack.setValueAtTime(0.003, this.audioCtx.currentTime);
      this.normalizerCompressorNode.release.setValueAtTime(0.25, this.audioCtx.currentTime);

      this.normalizerGainNode = this.audioCtx.createGain();
      this.normalizerGainNode.gain.setValueAtTime(1.35, this.audioCtx.currentTime);

      this.duckingGainNode.connect(this.syncDelayNode);
      this.wireMasterOutputRouting();
      this.masterGainNode.connect(this.audioCtx.destination);
    }

    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    return this.audioCtx;
  }

  /**
   * Dynamically routes the master audio path through the dynamics normalizer
   * or directly to the master gain node.
   */
  private wireMasterOutputRouting(): void {
    if (!this.syncDelayNode || !this.masterGainNode) return;
    try {
      this.syncDelayNode.disconnect();
    } catch {}

    if (this.isNormalizationActive && this.normalizerCompressorNode && this.normalizerGainNode) {
      try {
        this.normalizerCompressorNode.disconnect();
        this.normalizerGainNode.disconnect();
      } catch {}
      this.syncDelayNode.connect(this.normalizerCompressorNode);
      this.normalizerCompressorNode.connect(this.normalizerGainNode);
      this.normalizerGainNode.connect(this.masterGainNode);
    } else {
      this.syncDelayNode.connect(this.masterGainNode);
    }
  }

  /**
   * Enables or disables real-time audio volume normalization (leveling).
   */
  public setAudioNormalization(active: boolean): void {
    this.isNormalizationActive = active;
    this.wireMasterOutputRouting();
    this.log('info', `Audio volume normalization ${active ? 'activated' : 'deactivated'}`);
  }

  /**
   * Dispatches diagnostic events to the persistent application logger.
   */
  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void {
    if (typeof window !== 'undefined' && window.karaokeApi?.logger?.log) {
      window.karaokeApi.logger.log(level, 'AudioGraphManager', message, data);
    }
  }

  /**
   * Alias for initAudioContext.
   */
  public initContext(): Promise<AudioContext> {
    return this.initAudioContext();
  }

  /**
   * Binds an HTMLMediaElement (video or audio) into the Web Audio API graph.
   *
   * @param element - The media element to connect
   */
  public async bindMediaElement(element: HTMLMediaElement): Promise<void> {
    this.mediaElement = element;
    (element as any).preservesPitch = true;
    (element as any).mozPreservesPitch = true;
    (element as any).webkitPreservesPitch = true;
    // Bungee owns tempo in Wasm — never set element rate to currentPlaybackSpeed here
    // (would double-accelerate once the worklet also stretches). SoundTouch uses element rate.
    this.applyMediaElementRateForActiveEngine();

    if (!this.audioCtx) {
      await this.initAudioContext();
    }
    if (!this.audioCtx) return;

    if (!this.sourceNode) {
      try {
        this.sourceNode = this.audioCtx.createMediaElementSource(element);
        this.setupVocalRemoverGraph();
      } catch (err) {
        console.warn('MediaElementSource binding notice:', err);
      }
    }

    // Re-apply after graph setup (active engine may still be null until ensureDspEngine resolves).
    this.applyMediaElementRateForActiveEngine();
  }

  /**
   * Builds vocal-remover routing:
   * MediaElementSource → AlgorithmicVocalRemoverNode → DSP bridge → ducking
   */
  private setupVocalRemoverGraph(): void {
    if (!this.audioCtx || !this.sourceNode || !this.duckingGainNode) return;

    this.ensureDspBridge();
    void this.ensureDspEngine();

    this.teardownVocalRemoverNodes();

    try {
      this.sourceNode.disconnect();
    } catch {
      /* ignore */
    }

    this.setupAlgorithmicVocalRemoverGraph();
  }

  /**
   * Creates stable GainNode bridges once so engine swaps do not rewire vocal remover.
   */
  private ensureDspBridge(): void {
    if (!this.audioCtx || !this.duckingGainNode) return;
    if (!this.dspBridgeIn) {
      this.dspBridgeIn = this.audioCtx.createGain();
    }
    if (!this.dspBridgeOut) {
      this.dspBridgeOut = this.audioCtx.createGain();
      this.dspBridgeOut.connect(this.duckingGainNode);
    }
  }

  /**
   * Ensures the preferred DSP engine is loaded and wired.
   * Silent fallback to SoundTouch when Bungee Wasm/Worklet init fails.
   * Concurrent callers share one in-flight promise (avoids double create + generation abort).
   */
  private async ensureDspEngine(): Promise<void> {
    if (!this.audioCtx || !this.dspBridgeIn || !this.dspBridgeOut) return;

    if (this.dspEnsurePromise) {
      await this.dspEnsurePromise;
    }

    // Already on the preferred engine (or silent SoundTouch fallback after Bungee failure).
    if (this.activeDspEngine === this.preferredDspEngine) return;
    if (
      this.preferredDspEngine === 'bungee' &&
      this.activeDspEngine === 'soundtouch' &&
      !this.bungeeNode
    ) {
      return;
    }

    const run = this.ensureDspEngineInternal();
    this.dspEnsurePromise = run.finally(() => {
      this.dspEnsurePromise = null;
    });
    await this.dspEnsurePromise;
  }

  private async ensureDspEngineInternal(): Promise<void> {
    if (!this.audioCtx || !this.dspBridgeIn || !this.dspBridgeOut) return;
    const generation = ++this.dspInitGeneration;
    const preferred = this.preferredDspEngine;

    if (preferred === 'bungee') {
      if (!this.bungeeNode) {
        try {
          // Upstream Wasm: https://github.com/bungee-audio-stretch/bungee (MPL-2.0).
          // Runtime assets only under public/workers/ — no C++ source in-tree.
          // create() waits for Wasm `initialized` (throws on timeout/error → SoundTouch).
          this.bungeeNode = await BungeePitchShifterNode.create(this.audioCtx);
          this.bungeeNode.setUnderrunFallbackHandler(() => {
            this.log(
              'warn',
              'Bungee underrun/mute detected — falling back to SoundTouch WSOLA'
            );
            // Prefer SoundTouch going forward for this session (avoid mute loops).
            this.preferredDspEngine = 'soundtouch';
            this.wireSoundTouchEngine();
          });
          this.log('info', 'Bungee pitch/speed DSP initialized (Wasm AudioWorklet)');
        } catch (err) {
          this.log(
            'warn',
            'Bungee DSP init failed — falling back to SoundTouch WSOLA',
            err
          );
          if (generation !== this.dspInitGeneration) return;
          this.wireSoundTouchEngine();
          return;
        }
      }
      if (generation !== this.dspInitGeneration) return;
      if (this.preferredDspEngine !== 'bungee') {
        this.wireSoundTouchEngine();
        return;
      }
      this.wireBungeeEngine();
      return;
    }

    this.wireSoundTouchEngine();
  }

  private disconnectDspBridgeInternals(): void {
    if (!this.dspBridgeIn) return;
    try {
      this.dspBridgeIn.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.pitchShifterNode?.output.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.bungeeNode?.output.disconnect();
    } catch {
      /* ignore */
    }
  }

  private wireBungeeEngine(): void {
    if (!this.dspBridgeIn || !this.dspBridgeOut || !this.bungeeNode) return;
    this.disconnectDspBridgeInternals();
    this.dspBridgeIn.connect(this.bungeeNode.input);
    this.bungeeNode.output.connect(this.dspBridgeOut);
    this.activeDspEngine = 'bungee';
    // Re-apply live params after wire (covers pitch/speed set while ensureDspEngine was pending).
    this.bungeeNode.setPitchOffset(this.currentPitchOffset);
    this.bungeeNode.setPlaybackSpeed(this.currentPlaybackSpeed);
    this.applyMediaElementRateForActiveEngine();
    this.log(
      'info',
      `Bungee DSP wired — pitch ${this.currentPitchOffset} ST, speed ${this.currentPlaybackSpeed.toFixed(2)}x`
    );
  }

  private wireSoundTouchEngine(): void {
    if (!this.audioCtx || !this.dspBridgeIn || !this.dspBridgeOut) return;
    if (!this.pitchShifterNode) {
      this.pitchShifterNode = new PitchShifterNode(this.audioCtx);
    }
    this.disconnectDspBridgeInternals();
    this.dspBridgeIn.connect(this.pitchShifterNode.input);
    this.pitchShifterNode.output.connect(this.dspBridgeOut);
    this.activeDspEngine = 'soundtouch';
    this.pitchShifterNode.setPitchOffset(this.currentPitchOffset);
    this.applyMediaElementRateForActiveEngine();
  }

  /**
   * Bungee owns tempo via Wasm — element rate stays 1.0 (no double acceleration).
   * SoundTouch (or engine not yet wired): HTMLMediaElement.playbackRate drives tempo;
   * while Bungee is preferred but not yet active, keep rate at 1.0 to avoid a chipmunk
   * flash before the worklet takes over.
   */
  private applyMediaElementRateForActiveEngine(): void {
    if (!this.mediaElement || this.isMidiMode) return;
    if (this.activeDspEngine === 'bungee' || (this.activeDspEngine === null && this.preferredDspEngine === 'bungee')) {
      this.mediaElement.playbackRate = 1.0;
    } else {
      this.mediaElement.playbackRate = this.currentPlaybackSpeed;
    }
  }

  private teardownVocalRemoverNodes(): void {
    if (this.vocalRemoverNode) {
      try {
        this.vocalRemoverNode.dispose();
      } catch {
        /* ignore */
      }
      this.vocalRemoverNode = null;
    }
  }

  private setupAlgorithmicVocalRemoverGraph(): void {
    if (!this.audioCtx || !this.sourceNode || !this.dspBridgeIn) return;
    this.vocalRemoverNode = new AlgorithmicVocalRemoverNode(this.audioCtx);
    this.vocalRemoverNode.setAlgorithm(this.vocalRemoverAlgorithm);
    this.sourceNode.connect(this.vocalRemoverNode.input);
    this.vocalRemoverNode.output.connect(this.dspBridgeIn);
    this.vocalRemoverNode.setEnabled(this.isVocalRemoverEnabled);
  }

  /**
   * Toggles guide-vocal removal for the selected Settings method (algorithmic mid/side DSP).
   */
  public setVocalRemover(enabled: boolean): void {
    this.isVocalRemoverEnabled = enabled;
    this.vocalRemoverNode?.setEnabled(enabled);
  }

  /**
   * Selects the vocal-remover algorithm for live Rimozione Vocale (DSP only).
   * AI Settings ids (Download Instrumental) coerce to centerCancelBassKeep for live playback.
   * Does not restore dual-stem Separazione.
   */
  public setVocalRemoverAlgorithm(algorithm: VocalRemoverMethod | string): void {
    const next = coerceAlgorithmicVocalRemoverMethod(algorithm);
    this.vocalRemoverMethod = next;

    if (this.vocalRemoverNode) {
      this.vocalRemoverNode.setAlgorithm(next);
    } else if (this.sourceNode) {
      this.setupVocalRemoverGraph();
    }
  }


  /**
   * Smoothly attenuates background music gain when voice-over or microphone is active.
   *
   * @param active - Ducking active state
   * @param duckLevel - Attenuation multiplier (default 0.25 = -12 dB)
   */
  public setDucking(active: boolean, duckLevel: number = 0.25): void {
    this.isDuckingActive = active;
    if (!this.audioCtx || !this.duckingGainNode) return;

    const now = this.audioCtx.currentTime;
    const targetGain = active ? Math.max(0, Math.min(1, duckLevel)) : 1.0;
    this.duckingGainNode.gain.cancelScheduledValues(now);
    this.duckingGainNode.gain.linearRampToValueAtTime(targetGain, now + 0.15);
  }

  /**
   * Returns current ducking status.
   */
  public getDucking(): boolean {
    return this.isDuckingActive;
  }

  // ==========================================
  // Pitch & Speed DSP Controls
  // ==========================================

  /**
   * Selects the media pitch/speed DSP engine (`soundtouch` default, `bungee` optional).
   * Public API for pitch/speed ({@link setPitchOffset}, {@link setPlaybackSpeed}) is unchanged.
   * On Bungee init failure or runtime mute underrun the graph falls back to SoundTouch.
   */
  public setDspEngine(engine: DspPitchEngine | string): void {
    const next = coerceDspPitchEngine(engine);
    if (next === this.preferredDspEngine && this.activeDspEngine === next) return;
    this.preferredDspEngine = next;
    // Re-clamp stored speed/pitch into the new engine UI windows before wiring.
    this.currentPlaybackSpeed = clampSpeedForEngine(this.currentPlaybackSpeed, next);
    this.currentPitchOffset = clampPitchForEngine(this.currentPitchOffset, next);
    if (this.audioCtx && this.dspBridgeIn) {
      void this.ensureDspEngine();
    }
  }

  /** Currently preferred DSP engine from Settings (before silent fallback). */
  public getDspEngine(): DspPitchEngine {
    return this.preferredDspEngine;
  }

  /** Engine actually wired (may differ after Bungee fallback). */
  public getActiveDspEngine(): DspPitchEngine | null {
    return this.activeDspEngine;
  }

  /**
   * Updates real-time pitch transposition in semitones without modifying speed.
   * Range depends on the preferred engine (Bungee UI ±8, SoundTouch ±4).
   *
   * Always stores {@link currentPitchOffset} so {@link wireBungeeEngine} /
   * {@link wireSoundTouchEngine} can re-apply after async DSP init.
   * When `activeDspEngine` is still null, prefers the matching node if already created.
   *
   * @param semitones - Transposition offset
   */
  public setPitchOffset(semitones: number): void {
    const clamped = clampPitchForEngine(semitones, this.preferredDspEngine);
    if (clamped === this.currentPitchOffset) return;
    this.currentPitchOffset = clamped;

    if (this.activeDspEngine === 'bungee' || (this.activeDspEngine === null && this.bungeeNode)) {
      this.bungeeNode?.setPitchOffset(clamped);
      this.log('info', `Pitch offset applied (Bungee): ${clamped} ST`);
    } else if (this.activeDspEngine === 'soundtouch' || this.pitchShifterNode) {
      this.pitchShifterNode?.setPitchOffset(clamped);
      this.log('info', `Pitch offset applied (SoundTouch): ${clamped} ST`);
    } else {
      this.log('debug', `Pitch offset queued (${clamped} ST) — DSP engine not wired yet`);
    }

    if (this.isMidiMode) {
      this.silenceAllVoices();
    }
  }

  /**
   * Adjusts playback rate / speed (0.50x to 1.50x) without modifying pitch.
   * Bungee applies speed in Wasm (element rate forced to 1.0).
   * SoundTouch uses HTMLMediaElement.playbackRate (pitch compensate via WSOLA).
   * Stores {@link currentPlaybackSpeed} for re-apply on engine wire.
   *
   * @param speed - Playback speed multiplier
   */
  public setPlaybackSpeed(speed: number): void {
    const clamped = clampSpeedForEngine(speed, this.preferredDspEngine);
    if (clamped === this.currentPlaybackSpeed) return;
    this.currentPlaybackSpeed = clamped;

    if (this.isMidiMode && this.isTimerRunning()) {
      const currentMs = this.getMidiCurrentTimeMs();
      this.midiPlaybackOffsetMs = currentMs;
      this.midiPlaybackStartTimeMs = performance.now() - (currentMs / this.currentPlaybackSpeed);
    }

    if (this.activeDspEngine === 'bungee' || (this.activeDspEngine === null && this.bungeeNode)) {
      this.bungeeNode?.setPlaybackSpeed(clamped);
      this.applyMediaElementRateForActiveEngine();
      this.log('info', `Playback speed applied (Bungee Wasm): ${clamped.toFixed(2)}x (element rate 1.0)`);
    } else if (this.activeDspEngine === null && this.preferredDspEngine === 'bungee') {
      // Pending Bungee init — keep element at 1.0; wireBungeeEngine will send setSpeed.
      this.applyMediaElementRateForActiveEngine();
      this.log('debug', `Playback speed queued (Bungee pending): ${clamped.toFixed(2)}x`);
    } else if (this.mediaElement && !this.isMidiMode) {
      this.mediaElement.playbackRate = this.currentPlaybackSpeed;
      this.log('info', `Playback speed applied (SoundTouch / media element): ${clamped.toFixed(2)}x`);
    }
  }

  /**
   * Computes perceptual gain using a quadratic audio taper curve.
   *
   * **Critical invariant:** `gain = volume²` with volume clamped to [0, 1].
   * Do not replace with a linear fader or alternate exponents without operator UX sign-off
   * (Suite 1 + `verify-critical-invariants.js` lock this curve).
   *
   * Psychoacoustic rationale: Human perception of sound pressure level is logarithmic
   * (Weber-Fechner). A linear gain fader changes precipitously near 0 and stays flat
   * between 0.5 and 1.0. Quadratic taper examples:
   * - volume = 1.00 → gain = 1.0000 (0.0 dB)
   * - volume = 0.50 → gain = 0.2500 (−12.0 dB, perceived half loudness)
   * - volume = 0.00 → gain = 0.0000
   *
   * @param volume - Slider position normalized from 0.0 (silent) to 1.0 (full)
   * @param isMuted - When true, forces output gain to 0.0 regardless of slider level
   * @returns Gain value for Web Audio GainNode (0.0 to 1.0)
   */
  public static computePerceptualGain(volume: number, isMuted: boolean): number {
    if (isMuted) return 0;
    const clamped = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0));
    return Math.round(Math.pow(clamped, 2) * 10000) / 10000;
  }

  /**
   * Adjusts master output volume using a perceptual audio taper with anti-click ramping.
   * Applies smoothly across all audio sources (HTML5 media, SoundTouch WSOLA, and SpessaSynth MIDI).
   *
   * @param volume - Gain level (0.0 to 1.0)
   * @param isMuted - If true, ramps gain to 0
   */
  public setMasterVolume(volume: number, isMuted: boolean): void {
    if (!this.audioCtx || !this.masterGainNode) return;
    const now = this.audioCtx.currentTime;
    const target = AudioGraphManager.computePerceptualGain(volume, isMuted);
    this.masterGainNode.gain.cancelScheduledValues(now);
    // 50ms linear ramp prevents audible DC offset thumps, zipper noise, or clicks
    this.masterGainNode.gain.linearRampToValueAtTime(target, now + 0.05);
  }

  // ==========================================
  // Headphone Routing (CUE / Pre-ascolto)
  // ==========================================
  /**
   * Routes the main media element audio output to a specific hardware device (via setSinkId).
   *
   * @param deviceId - Audio device identifier
   */
  public async setCueOutputDevice(deviceId: string): Promise<boolean> {
    if (!this.mediaElement) return false;
    const element = this.mediaElement as HTMLMediaElement & {
      setSinkId?: (id: string) => Promise<void>;
    };

    if (typeof element.setSinkId === 'function') {
      try {
        await element.setSinkId(deviceId);
        return true;
      } catch (err) {
        console.error('Failed to set sinkId on media element:', err);
        return false;
      }
    }
    return false;
  }

  /**
   * Routes this AudioContext destination to a hardware output (Chromium setSinkId).
   * Used by isolated Pre-Ascolto MIDI preview instances so synthesis leaves the CUE device
   * without touching the room/master graph.
   */
  public async setAudioOutputDevice(deviceId: string): Promise<boolean> {
    await this.initAudioContext();
    if (!this.audioCtx) return false;
    const ctx = this.audioCtx as AudioContext & {
      setSinkId?: (id: string) => Promise<void>;
      sinkId?: string;
    };
    if (typeof ctx.setSinkId !== 'function') return false;
    const sink = !deviceId || deviceId === 'default' || deviceId === 'communications' ? '' : deviceId;
    try {
      await ctx.setSinkId(sink);
      return true;
    } catch (err) {
      console.warn('AudioContext setSinkId failed:', err);
      return false;
    }
  }

  /**
   * Previews a track in the operator's headphones without interrupting room audio.
   *
   * @param uri - Song playback URI
   * @param deviceId - Headphone output device ID
   */
  public async playCuePreview(uri: string, deviceId: string = 'default'): Promise<void> {
    this.stopCuePreview();

    this.cueAudioElement = new Audio(uri);
    this.cueAudioElement.volume = 1.0;

    const el = this.cueAudioElement as HTMLAudioElement & {
      setSinkId?: (id: string) => Promise<void>;
    };

    if (deviceId && deviceId !== 'default' && typeof el.setSinkId === 'function') {
      try {
        await el.setSinkId(deviceId);
      } catch (err) {
        console.warn('Could not set sinkId on CUE element:', err);
      }
    }

    try {
      await this.cueAudioElement.play();
    } catch (err) {
      console.error('Failed to start CUE playback:', err);
    }
  }

  /**
   * Stops active CUE headphone pre-listening preview.
   */
  public stopCuePreview(): void {
    if (this.cueAudioElement) {
      this.cueAudioElement.pause();
      this.cueAudioElement.currentTime = 0;
      this.cueAudioElement = null;
    }
  }

  /**
   * Adjusts hardware audio/video synchronization latency delay.
   *
   * @param offsetMs - Delay in milliseconds
   */
  public setAudioVideoSyncOffsetMs(offsetMs: number): void {
    if (!this.syncDelayNode || !this.audioCtx) return;
    const now = this.audioCtx.currentTime;
    const delaySeconds = Math.max(0, Math.min(1.0, offsetMs / 1000));
    this.syncDelayNode.delayTime.cancelScheduledValues(now);
    this.syncDelayNode.delayTime.setValueAtTime(delaySeconds, now);
  }

  /**
   * Registers the SpessaSynth AudioWorklet processor module if not already loaded.
   */
  private async ensureWorkletModuleLoaded(): Promise<boolean> {
    if (this.isWorkletModuleLoaded || !this.audioCtx) return true;
    try {
      // Fetch worklet script and load via blob URL to prevent CORS/file:// protocol restrictions
      const scriptUrl = '/workers/spessasynth_processor.min.js';
      const response = await fetch(scriptUrl).catch(() => {
        return fetch(new URL('workers/spessasynth_processor.min.js', window.location.href).href);
      });
      if (response.ok) {
        const scriptText = await response.text();
        const blob = new Blob([scriptText], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        await this.audioCtx.audioWorklet.addModule(blobUrl);
        URL.revokeObjectURL(blobUrl);
        this.isWorkletModuleLoaded = true;
        this.log('info', 'SpessaSynth AudioWorklet processor registered.');
        return true;
      }
    } catch (err) {
      this.log('warn', 'Could not load SpessaSynth Worklet module (falling back to oscillators)', err);
    }
    return false;
  }

  // ==========================================
  // SoundFont (.sf2) & MIDI/KAR Synthesis
  // ==========================================
  /**
   * Fetches a SoundFont 2 (.sf2) bank via karaoke://local/ and registers it with the WorkletSynthesizer.
   *
   * @param sf2Path - Absolute path to .sf2 bank on disk
   * @returns True if successfully loaded
   */
  public async loadSoundFont(sf2Path: string): Promise<boolean> {
    if (!sf2Path) return false;
    if (sf2Path === this.soundFontLoadedPath && this.workletSynth) return true;

    // Deduplicate concurrent calls (e.g. from mount effect and settings change)
    if (this.soundFontLoadingPromise) {
      return this.soundFontLoadingPromise;
    }

    this.soundFontLoadingPromise = this.internalLoadSoundFont(sf2Path);
    try {
      return await this.soundFontLoadingPromise;
    } finally {
      this.soundFontLoadingPromise = null;
    }
  }

  private async internalLoadSoundFont(sf2Path: string): Promise<boolean> {
    try {
      await this.initAudioContext();
      if (!this.audioCtx) return false;

      let buffer: ArrayBuffer | null = null;
      // 1. Try fetching via custom protocol karaoke://local/
      try {
        const response = await fetch(`karaoke://local/${encodeURIComponent(sf2Path)}`);
        if (response.ok) {
          buffer = await response.arrayBuffer();
        }
      } catch {
        // Fallback to web path
      }

      // 2. Fallback to direct web asset path (e.g. /soundfonts/GeneralUser-GS.sf2)
      if (!buffer || buffer.byteLength === 0) {
        const fallbackUrl = sf2Path.includes('GeneralUser') || !sf2Path.startsWith('/')
          ? '/soundfonts/GeneralUser-GS.sf2'
          : sf2Path;
        try {
          const resp2 = await fetch(fallbackUrl);
          if (resp2.ok) {
            buffer = await resp2.arrayBuffer();
          }
        } catch {
          // Web fallback catch
        }
      }

      if (!buffer || buffer.byteLength === 0) {
        throw new Error(`Failed to load SoundFont file from: ${sf2Path}`);
      }

      this.soundFontBuffer = buffer;
      this.soundFontLoadedPath = sf2Path;
      this.log('info', `Loaded SoundFont: ${sf2Path} (${this.soundFontBuffer.byteLength} bytes)`);

      const workletReady = await this.ensureWorkletModuleLoaded();
      if (workletReady) {
        try {
          if (!this.workletSynth) {
            this.workletSynth = new WorkletSynthesizer(this.audioCtx);
            await this.workletSynth.isReady;
            if (this.duckingGainNode) {
              this.workletSynth.connect(this.duckingGainNode);
            }
          }
          // CLONE the buffer slice so the original this.soundFontBuffer is NEVER detached!
          await this.workletSynth.soundBankManager.addSoundBank(this.soundFontBuffer.slice(0), 'active_soundfont');
          this.log('info', 'SoundFont successfully loaded into WorkletSynthesizer.');
        } catch (synthErr) {
          const errPayload =
            synthErr instanceof Error
              ? { message: synthErr.message, stack: synthErr.stack, name: synthErr.name }
              : String(synthErr);
          this.log('warn', 'WorkletSynthesizer init error, fallback to oscillators:', errPayload);
        }
      }

      return true;
    } catch (err) {
      const errPayload =
        err instanceof Error ? { message: err.message, stack: err.stack, name: err.name } : String(err);
      this.log('error', 'Error loading SoundFont file:', errPayload);
      return false;
    }
  }

  /**
   * Parses standard MIDI or KAR binary data, extracts lyric events, and prepares playback.
   *
   * @param midiBuffer - Raw binary buffer of the .mid or .kar file
   * @returns Parsed song information
   */
  public async loadMidiSong(midiBuffer: ArrayBuffer): Promise<MidiParsedSong> {
    await this.initAudioContext();
    this.isMidiMode = true;
    this.stopMidiPlayback();

    // Immediately clear any old lyric text
    this.currentLyricIndex = -1;
    if (this.onLyricCallback) {
      this.onLyricCallback(null);
    }

    const { song, events } = MidiParser.parse(midiBuffer);
    this.midiSong = song;
    this.midiEvents = events;
    this.midiEventIndex = 0;
    this.midiPlaybackOffsetMs = 0;

    return song;
  }

  /**
   * Starts the SpessaSynth / MIDI high-resolution clock.
   *
   * **Critical invariant:** tick every **5 ms** (Worker preferred, `setInterval` fallback).
   * Why: event priority order + lyric sync depend on this cadence; coarsening it
   * desynchronizes KAR lyrics and note-ons under load. Do not add Control↔Stage latency
   * in this path.
   */
  private startSchedulerTimer(): void {
    this.stopSchedulerTimer();

    // Use inline Web Worker timer for jitter-free background clocking immune to UI/DOM lag
    try {
      const blob = new Blob([
        `let tid = null;
        self.onmessage = function(e) {
          if (e.data === 'start') {
            if (tid) clearInterval(tid);
            tid = setInterval(function() {
              self.postMessage('tick');
            }, 5);
          } else if (e.data === 'stop') {
            if (tid) clearInterval(tid);
            tid = null;
          }
        };`
      ], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      this.workerTimer = new Worker(url);
      URL.revokeObjectURL(url);

      this.workerTimer.onmessage = () => {
        this.tickMidiScheduler();
      };
      this.workerTimer.postMessage('start');
    } catch {
      // Fallback to window.setInterval if Web Worker creation fails — still 5 ms.
      this.fallbackIntervalId = window.setInterval(() => {
        this.tickMidiScheduler();
      }, 5);
    }
  }

  /**
   * Stops active scheduler timer and terminates worker.
   */
  private stopSchedulerTimer(): void {
    if (this.workerTimer) {
      try {
        this.workerTimer.postMessage('stop');
        this.workerTimer.terminate();
      } catch {
        // Ignore termination error
      }
      this.workerTimer = null;
    }
    if (this.fallbackIntervalId !== null) {
      clearInterval(this.fallbackIntervalId);
      this.fallbackIntervalId = null;
    }
  }

  /**
   * Checks if the MIDI scheduler clock is actively running.
   */
  public isTimerRunning(): boolean {
    return this.workerTimer !== null || this.fallbackIntervalId !== null;
  }

  /**
   * Starts or resumes high-precision MIDI note scheduling.
   */
  public async playMidi(): Promise<void> {
    if (!this.midiSong) return;
    this.isMidiMode = true;

    if (this.soundFontLoadingPromise) {
      try {
        await this.soundFontLoadingPromise;
      } catch {
        // Fallback or continue
      }
    }

    await this.initAudioContext();
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      try {
        await this.audioCtx.resume();
      } catch (err) {
        console.warn('AudioContext resume notice:', err);
      }
    }

    this.stopSchedulerTimer();
    this.silenceAllVoices();

    this.midiPlaybackStartTimeMs = performance.now() - (this.midiPlaybackOffsetMs / this.currentPlaybackSpeed);

    // Fast-forward event pointer to current offset while executing CCs/patch changes to restore instrument state
    this.midiEventIndex = 0;
    while (
      this.midiEventIndex < this.midiEvents.length &&
      this.midiEvents[this.midiEventIndex].timeMs < this.midiPlaybackOffsetMs
    ) {
      const ev = this.midiEvents[this.midiEventIndex];
      if (ev.type === 'programChange' || ev.type === 'controlChange' || ev.type === 'pitchBend') {
        this.executeMidiEvent(ev);
      }
      this.midiEventIndex++;
    }

    this.startSchedulerTimer();
  }

  /**
   * Pauses active MIDI playback and silences sounding notes.
   */
  public pauseMidi(): void {
    if (!this.isMidiMode) return;
    this.stopSchedulerTimer();
    this.midiPlaybackOffsetMs = this.getMidiCurrentTimeMs();
    this.silenceAllVoices();
  }

  /**
   * Stops MIDI playback completely and resets timeline offset to 0.
   */
  public stopMidiPlayback(): void {
    this.stopSchedulerTimer();
    this.silenceAllVoices();
    this.isMidiMode = false;
    this.midiEventIndex = 0;
    this.midiPlaybackOffsetMs = 0;
    this.currentLyricIndex = -1;
    if (this.onLyricCallback) {
      this.onLyricCallback(null);
    }
  }

  /**
   * Seeks MIDI playback position to the target millisecond timestamp.
   *
   * @param timeMs - Target timestamp in milliseconds
   */
  public seekMidi(timeMs: number): void {
    const wasPlaying = this.isTimerRunning();
    this.pauseMidi();
    this.midiPlaybackOffsetMs = Math.max(0, Math.min(timeMs, this.midiSong?.durationMs || 0));
    this.currentLyricIndex = -1;
    if (wasPlaying) {
      this.playMidi();
    }
  }

  /**
   * Calculates the current high-resolution playback timestamp in milliseconds.
   */
  public getMidiCurrentTimeMs(): number {
    if (!this.isMidiMode) return 0;
    if (!this.isTimerRunning()) {
      return this.midiPlaybackOffsetMs;
    }
    const elapsed = (performance.now() - this.midiPlaybackStartTimeMs) * this.currentPlaybackSpeed;
    return Math.min(elapsed, this.midiSong?.durationMs || 0);
  }

  // ==========================================
  // Real-Time MIDI Channel Muting (0-15)
  // ==========================================
  /**
   * Mutes or unmutes specific MIDI channels in real time (e.g. guide melody on Channel 4).
   *
   * @param mutedChannels - Array of muted MIDI channel indices (0-15)
   */
  public setMutedMidiChannels(mutedChannels: number[]): void {
    if (
      this.mutedChannels.size === mutedChannels.length &&
      mutedChannels.every((ch) => this.mutedChannels.has(ch))
    ) {
      return;
    }
    this.mutedChannels = new Set(mutedChannels);

    if (this.workletSynth) {
      for (const ch of mutedChannels) {
        try {
          this.workletSynth.controllerChange(ch, 120, 0); // All Sound Off
          this.workletSynth.controllerChange(ch, 123, 0); // All Notes Off
        } catch {
          // Ignore controller errors
        }
      }
    }

    if (this.audioCtx) {
      const now = this.audioCtx.currentTime;
      for (const voice of this.activeVoices) {
        if (this.mutedChannels.has(voice.channel)) {
          voice.gainNode.gain.cancelScheduledValues(now);
          voice.gainNode.gain.setValueAtTime(0, now);
          voice.sourceNode.stop(now + 0.01);
        }
      }
      this.activeVoices = this.activeVoices.filter((v) => !this.mutedChannels.has(v.channel));
    }
  }

  /**
   * Main clock loop running at 5ms intervals to schedule note events and broadcast lyrics.
   */
  private tickMidiScheduler(): void {
    if (!this.audioCtx || !this.midiSong) return;

    const currentMs = this.getMidiCurrentTimeMs();

    // 1. Process MIDI Events up to current time (no future queueing = zero stutter & zero background leakage)
    while (this.midiEventIndex < this.midiEvents.length) {
      const ev = this.midiEvents[this.midiEventIndex];
      if (ev.timeMs > currentMs) break;

      this.executeMidiEvent(ev);
      this.midiEventIndex++;
    }

    // 2. Process Synchronized Lyrics
    if (this.onLyricCallback && this.midiSong.lyrics.length > 0) {
      let activeIndex = -1;
      for (let i = 0; i < this.midiSong.lyrics.length; i++) {
        if (this.midiSong.lyrics[i].timeMs <= currentMs) {
          activeIndex = i;
        } else {
          break;
        }
      }

      if (activeIndex !== this.currentLyricIndex) {
        this.currentLyricIndex = activeIndex;
        const currentLyric = activeIndex >= 0 ? this.midiSong.lyrics[activeIndex] : null;
        this.onLyricCallback(currentLyric);
      }
    }

    // 3. Check for Song End
    if (currentMs >= this.midiSong.durationMs && this.midiEvents.length > 0) {
      this.stopMidiPlayback();
      if (this.onEndCallback) {
        this.onEndCallback();
      }
    }
  }

  /**
   * Dispatches an individual MIDI event to the synthesizer immediately, applying pitch transposition.
   *
   * @param event - Timed MIDI event (NoteOn, NoteOff, CC, ProgramChange)
   */
  private executeMidiEvent(event: TimedMidiEvent): void {
    if (!this.audioCtx) return;

    const isDrum = event.channel === 9;
    const note = event.note !== undefined ? event.note : 0;
    const effectiveNote = isDrum
      ? note
      : Math.max(0, Math.min(127, note + this.currentPitchOffset));

    if (this.workletSynth) {
      try {
        if (event.type === 'noteOn' && event.note !== undefined && event.velocity && event.velocity > 0) {
          // Skip noteOn if channel is muted
          if (this.mutedChannels.has(event.channel)) return;
          this.activeMidiNotes.set((event.channel << 8) | note, effectiveNote);
          this.workletSynth.noteOn(event.channel, effectiveNote, event.velocity);
        } else if (event.type === 'noteOff' && event.note !== undefined) {
          const soundedNote = this.activeMidiNotes.get((event.channel << 8) | note);
          this.activeMidiNotes.delete((event.channel << 8) | note);
          const noteToTurnOff = soundedNote !== undefined ? soundedNote : effectiveNote;
          this.workletSynth.noteOff(event.channel, noteToTurnOff);
        } else if (event.type === 'programChange' && event.program !== undefined) {
          this.workletSynth.programChange(event.channel, event.program);
        } else if (event.type === 'controlChange' && event.controller !== undefined && event.value !== undefined) {
          this.workletSynth.controllerChange(event.channel, event.controller as any, event.value);
        } else if (event.type === 'pitchBend' && event.value !== undefined) {
          this.workletSynth.pitchWheel(event.channel, event.value);
        }
        return;
      } catch (err) {
        console.warn('WorkletSynth execution error, using fallback:', err);
      }
    }

    // Fallback Oscillator synthesis
    const now = this.audioCtx.currentTime;
    if (event.type === 'noteOn' && event.note !== undefined && event.velocity && event.velocity > 0) {
      if (this.mutedChannels.has(event.channel)) return;
      this.synthesizeNote(event.channel, effectiveNote, event.velocity, now);
    } else if (event.type === 'noteOff' && event.note !== undefined) {
      this.releaseNote(event.channel, effectiveNote, now);
    }
  }

  /**
   * Fallback synthesis using Web Audio Oscillators when SoundFont is unavailable.
   */
  private synthesizeNote(channel: number, noteNumber: number, velocity: number, time: number): void {
    if (!this.audioCtx || !this.duckingGainNode) return;

    // Apply Live Pitch Offset (-8/+8 semitones) to melodic channels (exclude percussion Ch 9)
    const effectiveNote = channel === 9 ? noteNumber : noteNumber + this.currentPitchOffset;
    const freq = 440 * Math.pow(2, (effectiveNote - 69) / 12);

    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();

    // Select waveform based on channel / GM type
    if (channel === 9) {
      // Drum / Percussion synthesis
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(100, time);
      osc.frequency.exponentialRampToValueAtTime(30, time + 0.1);
    } else if (channel === 1) {
      // Bass
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, time);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);
    }

    // Velocity & Envelope
    const peakGain = (velocity / 127) * 0.25;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peakGain, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(peakGain * 0.7, time + 0.1);

    osc.connect(gain);
    gain.connect(this.duckingGainNode);

    osc.start(time);

    this.activeVoices.push({
      channel,
      note: noteNumber,
      sourceNode: osc,
      gainNode: gain
    });
  }

  /**
   * Releases an active fallback oscillator note with exponential decay envelope.
   */
  private releaseNote(channel: number, noteNumber: number, time: number): void {
    if (!this.audioCtx) return;

    for (let i = this.activeVoices.length - 1; i >= 0; i--) {
      const voice = this.activeVoices[i];
      if (voice.channel === channel && voice.note === noteNumber && !voice.stopTime) {
        voice.stopTime = time + 0.15;
        voice.gainNode.gain.cancelScheduledValues(time);
        voice.gainNode.gain.setValueAtTime(voice.gainNode.gain.value, time);
        voice.gainNode.gain.linearRampToValueAtTime(0.0001, time + 0.15);
        voice.sourceNode.stop(time + 0.16);

        // Remove from tracking array after release — keep handle so dispose() can cancel.
        const handle = setTimeout(() => {
          this.voiceReleaseTimeouts = this.voiceReleaseTimeouts.filter((h) => h !== handle);
          const idx = this.activeVoices.indexOf(voice);
          if (idx !== -1) this.activeVoices.splice(idx, 1);
        }, (time - this.audioCtx.currentTime + 0.2) * 1000);
        this.voiceReleaseTimeouts.push(handle);
        break;
      }
    }
  }

  /**
   * Immediately stops and silences all currently sounding MIDI voices and resets all channel controllers.
   */
  private silenceAllVoices(): void {
    if (this.workletSynth) {
      try {
        this.workletSynth.stopAll(true);
        for (let ch = 0; ch < 16; ch++) {
          this.workletSynth.controllerChange(ch, 120, 0); // All Sound Off (kills release tails immediately)
          this.workletSynth.controllerChange(ch, 123, 0); // All Notes Off
          this.workletSynth.controllerChange(ch, 64, 0);  // Sustain / Damper Pedal Off
          this.workletSynth.controllerChange(ch, 121, 0); // Reset All Controllers
          this.workletSynth.pitchWheel(ch, 8192);         // Center Pitch Bend Wheel
        }
      } catch {
        // Voice stop catch
      }
    }
    this.activeMidiNotes.clear();

    if (!this.audioCtx) return;
    const now = this.audioCtx.currentTime;
    for (const voice of this.activeVoices) {
      try {
        voice.gainNode.gain.cancelScheduledValues(now);
        voice.gainNode.gain.setValueAtTime(0, now);
        voice.sourceNode.stop(now + 0.01);
      } catch {
        // Voice might have already ended
      }
    }
    this.activeVoices = [];
  }

  /**
   * Subscribes a listener to receive real-time synchronized KAR lyric events.
   */
  public registerLyricCallback(cb: LyricCallback): void {
    this.onLyricCallback = cb;
  }

  /**
   * Subscribes a listener to be notified when a song completes playback.
   */
  public registerPlaybackEndCallback(cb: PlaybackEndCallback): void {
    this.onEndCallback = cb;
  }

  /**
   * Re-applies vocal remover state after the media element changes.
   */
  public refreshVocalRemoverForCurrentMedia(): void {
    this.vocalRemoverNode?.setEnabled(this.isVocalRemoverEnabled);
  }


  /**
   * Tears down the Web Audio graph and closes the AudioContext.
   *
   * **Why disconnect before close:** Chromium can retain MediaElementSource /
   * GainNode references if nodes are not disconnected, leaking DSP worklets
   * across ControlWindow remounts. Never touches permanent `libraryPath` media.
   */
  public dispose(): void {
    // Cancel MIDI release timers before tearing down AudioNodes.
    for (const handle of this.voiceReleaseTimeouts) {
      clearTimeout(handle);
    }
    this.voiceReleaseTimeouts = [];
    this.activeVoices = [];
    this.teardownVocalRemoverNodes();
    this.stopMidiPlayback();
    this.stopCuePreview();
    if (this.workletSynth) {
      try {
        this.workletSynth.destroy();
      } catch {
        // Ignore destroy error
      }
      this.workletSynth = null;
    }
    this.disconnectDspBridgeInternals();
    this.pitchShifterNode?.dispose();
    this.pitchShifterNode = null;
    this.bungeeNode?.dispose();
    this.bungeeNode = null;
    // Explicit disconnects so MediaElementSource / gains release their graphs
    for (const node of [
      this.sourceNode,
      this.dspBridgeIn,
      this.dspBridgeOut,
      this.duckingGainNode,
      this.masterGainNode,
      this.syncDelayNode,
      this.normalizerGainNode,
      this.normalizerCompressorNode
    ]) {
      try {
        node?.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    this.sourceNode = null;
    this.mediaElement = null;
    this.dspBridgeIn = null;
    this.dspBridgeOut = null;
    this.duckingGainNode = null;
    this.masterGainNode = null;
    this.syncDelayNode = null;
    this.normalizerGainNode = null;
    this.normalizerCompressorNode = null;
    this.activeDspEngine = null;
    this.soundFontBuffer = null;
    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
  }
}
