import { MidiLyricEvent, MidiParsedSong } from '../../shared/types';
import { MidiParser, TimedMidiEvent } from './MidiParser';
import { PitchShifterNode } from './PitchShifterNode';
import { WorkletSynthesizer } from 'spessasynth_lib';
import { getDemucsVocalSeparator } from './DemucsVocalSeparator';

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
 * - Media element audio routing with stereo phase vocoder pitch shifting (-8 to +8 semitones)
 * - Independent tempo scaling (0.50x to 1.50x)
 * - Meta HTDemucs vocal removal via demucs-web / onnxruntime-web (true stem separation)
 * - Auto-ducking BGM attenuation when microphone input or host talks
 * - AudioWorklet-based General MIDI / SoundFont 2 synthesis via SpessaSynth
 * - Real-time channel muting (channels 0-15) without desynchronizing lyrics
 * - Continuous 100ms timeline sync and event scheduling
 * - Secondary device CUE / Pre-listening routing (setSinkId)
 */
export class AudioGraphManager {
  private audioCtx: AudioContext | null = null;
  private mediaElement: HTMLMediaElement | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private pitchShifterNode: PitchShifterNode | null = null;

  // Vocal Remover — Demucs HTDemucs instrumental stem path (not DIY EQ cancel)
  private vocalRemoverPassThroughGain: GainNode | null = null;
  private vocalRemoverEffectGain: GainNode | null = null;
  private instrumentalSourceNode: AudioBufferSourceNode | null = null;
  private instrumentalBuffer: AudioBuffer | null = null;
  private instrumentalPlaying = false;
  private vocalSeparationToken = 0;
  private mediaSyncHandlersBound = false;
  private onMediaPlaySync: (() => void) | null = null;
  private onMediaPauseSync: (() => void) | null = null;
  private onMediaSeekSync: (() => void) | null = null;

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
   * @returns The active AudioContext instance
   */
  public async initAudioContext(): Promise<AudioContext> {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
    element.playbackRate = this.currentPlaybackSpeed;

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
  }

  /**
   * Builds the Demucs-backed vocal-remover routing graph.
   *
   * Dry path: MediaElementSource → passThroughGain → PitchShifter
   * Wet path: AudioBufferSource(instrumental stems) → effectGain → PitchShifter
   *
   * The wet buffer is produced asynchronously by demucs-web (HTDemucs) as
   * drums + bass + other. Until separation completes, playback stays on the dry path.
   */
  private setupVocalRemoverGraph(): void {
    if (!this.audioCtx || !this.sourceNode || !this.duckingGainNode) return;

    if (!this.pitchShifterNode) {
      this.pitchShifterNode = new PitchShifterNode(this.audioCtx);
      this.pitchShifterNode.setPitchOffset(this.currentPitchOffset);
      this.pitchShifterNode.output.connect(this.duckingGainNode);
    }

    const targetInputNode = this.pitchShifterNode.input;

    this.stopInstrumentalSource();
    if (this.vocalRemoverPassThroughGain) {
      try { this.vocalRemoverPassThroughGain.disconnect(); } catch { /* ignore */ }
    }
    if (this.vocalRemoverEffectGain) {
      try { this.vocalRemoverEffectGain.disconnect(); } catch { /* ignore */ }
    }

    this.vocalRemoverPassThroughGain = this.audioCtx.createGain();
    this.vocalRemoverPassThroughGain.gain.setValueAtTime(1, this.audioCtx.currentTime);

    this.vocalRemoverEffectGain = this.audioCtx.createGain();
    this.vocalRemoverEffectGain.gain.setValueAtTime(0, this.audioCtx.currentTime);

    this.sourceNode.connect(this.vocalRemoverPassThroughGain);
    this.vocalRemoverPassThroughGain.connect(targetInputNode);
    this.vocalRemoverEffectGain.connect(targetInputNode);

    this.bindMediaSyncHandlers();

    // Re-apply desired remover state after graph rebuild (e.g. new media element).
    if (this.isVocalRemoverEnabled) {
      void this.activateDemucsInstrumental();
    }
  }

  private bindMediaSyncHandlers(): void {
    if (!this.mediaElement || this.mediaSyncHandlersBound) return;

    this.onMediaPlaySync = () => {
      if (this.isVocalRemoverEnabled && this.instrumentalBuffer) {
        this.startInstrumentalAt(this.mediaElement?.currentTime || 0);
      }
    };
    this.onMediaPauseSync = () => {
      this.stopInstrumentalSource(true);
    };
    this.onMediaSeekSync = () => {
      if (this.isVocalRemoverEnabled && this.instrumentalBuffer && this.mediaElement && !this.mediaElement.paused) {
        this.startInstrumentalAt(this.mediaElement.currentTime);
      }
    };

    this.mediaElement.addEventListener('play', this.onMediaPlaySync);
    this.mediaElement.addEventListener('pause', this.onMediaPauseSync);
    this.mediaElement.addEventListener('seeked', this.onMediaSeekSync);
    this.mediaSyncHandlersBound = true;
  }

  private unbindMediaSyncHandlers(): void {
    if (!this.mediaElement || !this.mediaSyncHandlersBound) return;
    if (this.onMediaPlaySync) this.mediaElement.removeEventListener('play', this.onMediaPlaySync);
    if (this.onMediaPauseSync) this.mediaElement.removeEventListener('pause', this.onMediaPauseSync);
    if (this.onMediaSeekSync) this.mediaElement.removeEventListener('seeked', this.onMediaSeekSync);
    this.mediaSyncHandlersBound = false;
  }

  private stopInstrumentalSource(preserveBuffer = false): void {
    if (this.instrumentalSourceNode || this.instrumentalPlaying) {
      if (this.instrumentalSourceNode) {
        try {
          this.instrumentalSourceNode.onended = null;
          this.instrumentalSourceNode.stop();
        } catch { /* already stopped */ }
        try { this.instrumentalSourceNode.disconnect(); } catch { /* ignore */ }
        this.instrumentalSourceNode = null;
      }
    }
    this.instrumentalPlaying = false;
    if (!preserveBuffer) {
      // keep buffer for cache reuse unless caller clears it explicitly elsewhere
    }
  }

  private startInstrumentalAt(offsetSec: number): void {
    if (!this.audioCtx || !this.vocalRemoverEffectGain || !this.instrumentalBuffer) return;

    this.stopInstrumentalSource(true);

    const safeOffset = Math.max(0, Math.min(offsetSec, Math.max(0, this.instrumentalBuffer.duration - 0.05)));
    const source = this.audioCtx.createBufferSource();
    source.buffer = this.instrumentalBuffer;
    source.playbackRate.value = this.currentPlaybackSpeed;
    source.connect(this.vocalRemoverEffectGain);
    try {
      source.start(0, safeOffset);
    } catch (err) {
      this.log('warn', 'Failed to start Demucs instrumental buffer', err);
      return;
    }

    this.instrumentalSourceNode = source;
    this.instrumentalPlaying = true;
  }

  private crossfadeToInstrumental(enabled: boolean): void {
    if (!this.audioCtx || !this.vocalRemoverPassThroughGain || !this.vocalRemoverEffectGain) return;
    const now = this.audioCtx.currentTime;
    this.vocalRemoverPassThroughGain.gain.cancelScheduledValues(now);
    this.vocalRemoverEffectGain.gain.cancelScheduledValues(now);
    if (enabled) {
      this.vocalRemoverPassThroughGain.gain.linearRampToValueAtTime(0, now + 0.08);
      this.vocalRemoverEffectGain.gain.linearRampToValueAtTime(1, now + 0.08);
    } else {
      this.vocalRemoverPassThroughGain.gain.linearRampToValueAtTime(1, now + 0.08);
      this.vocalRemoverEffectGain.gain.linearRampToValueAtTime(0, now + 0.08);
    }
  }

  private async activateDemucsInstrumental(): Promise<void> {
    if (!this.audioCtx || !this.mediaElement) return;

    const mediaUrl = this.mediaElement.currentSrc || this.mediaElement.src;
    if (!mediaUrl) {
      this.log('warn', 'Vocal remover requested but media element has no src');
      return;
    }

    const token = ++this.vocalSeparationToken;
    const separator = getDemucsVocalSeparator();
    const cacheKey = mediaUrl;

    try {
      const cached = separator.getCachedInstrumental(cacheKey);
      const instrumental =
        cached ||
        (await separator.separateInstrumentalFromUrl(mediaUrl, this.audioCtx, cacheKey));

      if (token !== this.vocalSeparationToken || !this.isVocalRemoverEnabled) {
        return;
      }

      this.instrumentalBuffer = instrumental;
      if (this.mediaElement && !this.mediaElement.paused) {
        this.startInstrumentalAt(this.mediaElement.currentTime);
      }
      this.crossfadeToInstrumental(true);
      this.log('info', 'Demucs instrumental stem engaged for vocal removal');
    } catch (err) {
      if (token !== this.vocalSeparationToken) return;
      this.log('error', 'Demucs vocal separation failed; keeping original mix', err);
      this.crossfadeToInstrumental(false);
      this.stopInstrumentalSource(true);
    }
  }

  // ==========================================
  // Vocal Remover & BGM Auto-Ducking
  // ==========================================
  /**
   * Toggles Demucs HTDemucs vocal removal.
   * Separation runs asynchronously; dry audio continues until the instrumental is ready.
   *
   * @param enabled - Enable or disable vocal suppression
   */
  public setVocalRemover(enabled: boolean): void {
    this.isVocalRemoverEnabled = enabled;
    if (!enabled) {
      this.vocalSeparationToken++;
      this.crossfadeToInstrumental(false);
      this.stopInstrumentalSource(true);
      return;
    }
    void this.activateDemucsInstrumental();
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
   * Updates real-time pitch transposition in semitones without modifying speed.
   *
   * @param semitones - Transposition offset (-8 to +8)
   */
  public setPitchOffset(semitones: number): void {
    const clamped = Math.max(-8, Math.min(8, semitones));
    if (clamped === this.currentPitchOffset) return;
    this.currentPitchOffset = clamped;
    this.pitchShifterNode?.setPitchOffset(this.currentPitchOffset);
    if (this.isMidiMode) {
      this.silenceAllVoices();
    }
  }

  /**
   * Adjusts playback rate / speed (0.50x to 1.50x) without modifying pitch.
   *
   * @param speed - Playback speed multiplier
   */
  public setPlaybackSpeed(speed: number): void {
    const clamped = Math.max(0.50, Math.min(1.50, speed));
    if (clamped === this.currentPlaybackSpeed) return;
    this.currentPlaybackSpeed = clamped;

    if (this.isMidiMode && this.isTimerRunning()) {
      const currentMs = this.getMidiCurrentTimeMs();
      this.midiPlaybackOffsetMs = currentMs;
      this.midiPlaybackStartTimeMs = performance.now() - (currentMs / this.currentPlaybackSpeed);
    }

    if (this.mediaElement && !this.isMidiMode) {
      this.mediaElement.playbackRate = this.currentPlaybackSpeed;
    }
  }

  /**
   * Computes perceptual gain using a quadratic audio taper curve.
   *
   * Psychoacoustic rationale: Human perception of sound pressure level is logarithmic
   * (governed by the Weber-Fechner law). A linear gain fader produces an unnatural response
   * where volume changes precipitously near 0 and remains almost flat between 0.5 and 1.0.
   * Using a quadratic power curve (Gain = volume^2) provides a natural, smooth, and progressive
   * volume taper across the entire 0.0 to 1.0 slider travel:
   * - volume = 1.00 -> gain = 1.0000 (0.0 dB, full scale)
   * - volume = 0.75 -> gain = 0.5625 (-5.0 dB)
   * - volume = 0.50 -> gain = 0.2500 (-12.0 dB, perceived as half loudness)
   * - volume = 0.25 -> gain = 0.0625 (-24.1 dB, soft background level)
   * - volume = 0.00 -> gain = 0.0000 (-infinity dB, complete silence)
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
   * Starts high-resolution 5ms background clock loop using Web Worker or interval.
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
      // Fallback to window.setInterval if Web Worker creation fails
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

        // Remove from tracking array after release
        setTimeout(() => {
          const idx = this.activeVoices.indexOf(voice);
          if (idx !== -1) this.activeVoices.splice(idx, 1);
        }, (time - this.audioCtx.currentTime + 0.2) * 1000);
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
   * Clears any Demucs instrumental cache for the previous track and re-runs
   * separation when vocal removal is still enabled (call on track change).
   */
  public refreshVocalRemoverForCurrentMedia(): void {
    this.vocalSeparationToken++;
    this.stopInstrumentalSource();
    this.instrumentalBuffer = null;
    this.crossfadeToInstrumental(false);
    if (this.isVocalRemoverEnabled) {
      void this.activateDemucsInstrumental();
    }
  }

  public dispose(): void {
    this.vocalSeparationToken++;
    this.unbindMediaSyncHandlers();
    this.stopInstrumentalSource();
    this.instrumentalBuffer = null;
    this.stopMidiPlayback();
    if (this.workletSynth) {
      try {
        this.workletSynth.destroy();
      } catch {
        // Ignore destroy error
      }
      this.workletSynth = null;
    }
    this.pitchShifterNode?.dispose();
    this.pitchShifterNode = null;
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
  }
}
