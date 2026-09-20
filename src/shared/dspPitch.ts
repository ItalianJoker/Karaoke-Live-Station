/**
 * Pitch / speed DSP engine selection and semitone / tempo range constants.
 *
 * Hi-Fi / `signalsmith` id (default): Signalsmith Stretch (MIT) AudioWorklet — UI ±8,
 * internal hard cap ±12; speed UI 0.50–1.50, absolute hard 0.50–2.00.
 * Legacy settings id `bungee` migrates to `signalsmith` via {@link coerceDspPitchEngine}.
 * SoundTouch (emergency/light): WSOLA ScriptProcessor — hard UI ±4; speed UI 0.75–1.25,
 * absolute media+WSOLA 0.50–1.50. Auto-selected if Hi-Fi init or mute watchdog fails.
 *
 * MIDI/KAR transposition is independent (SpessaSynth note shift) and does not
 * use these DSP engines.
 */

/** Selectable media pitch/speed DSP backends. */
export type DspPitchEngine = 'signalsmith' | 'soundtouch';

/** @deprecated Legacy persisted id — coerce to `signalsmith`. */
export type LegacyDspPitchEngineId = 'bungee';

/** Recommended Control-window UI range for Signalsmith Hi-Fi (semitones). */
export const SIGNALSMITH_PITCH_UI_MIN = -8;
export const SIGNALSMITH_PITCH_UI_MAX = 8;

/** Absolute non-destructive Signalsmith clamp (semitones); UI uses recommended ±8. */
export const SIGNALSMITH_PITCH_ABSOLUTE_MIN = -12;
export const SIGNALSMITH_PITCH_ABSOLUTE_MAX = 12;

/** @deprecated Prefer {@link SIGNALSMITH_PITCH_UI_MIN}. */
export const BUNGEE_PITCH_UI_MIN = SIGNALSMITH_PITCH_UI_MIN;
/** @deprecated Prefer {@link SIGNALSMITH_PITCH_UI_MAX}. */
export const BUNGEE_PITCH_UI_MAX = SIGNALSMITH_PITCH_UI_MAX;
/** @deprecated Prefer {@link SIGNALSMITH_PITCH_ABSOLUTE_MIN}. */
export const BUNGEE_PITCH_ABSOLUTE_MIN = SIGNALSMITH_PITCH_ABSOLUTE_MIN;
/** @deprecated Prefer {@link SIGNALSMITH_PITCH_ABSOLUTE_MAX}. */
export const BUNGEE_PITCH_ABSOLUTE_MAX = SIGNALSMITH_PITCH_ABSOLUTE_MAX;

/** Hard UI / DSP clamp for SoundTouch WSOLA (semitones). */
export const SOUNDTOUCH_PITCH_MIN = -4;
export const SOUNDTOUCH_PITCH_MAX = 4;

/** Control UI tempo range for Signalsmith (step 0.05 in UI). */
export const SIGNALSMITH_SPEED_UI_MIN = 0.5;
export const SIGNALSMITH_SPEED_UI_MAX = 1.5;

/** Absolute Signalsmith hard clamp (beyond UI). */
export const SIGNALSMITH_SPEED_ABSOLUTE_MIN = 0.5;
export const SIGNALSMITH_SPEED_ABSOLUTE_MAX = 2.0;

/** @deprecated Prefer {@link SIGNALSMITH_SPEED_UI_MIN}. */
export const BUNGEE_SPEED_UI_MIN = SIGNALSMITH_SPEED_UI_MIN;
/** @deprecated Prefer {@link SIGNALSMITH_SPEED_UI_MAX}. */
export const BUNGEE_SPEED_UI_MAX = SIGNALSMITH_SPEED_UI_MAX;
/** @deprecated Prefer {@link SIGNALSMITH_SPEED_ABSOLUTE_MIN}. */
export const BUNGEE_SPEED_ABSOLUTE_MIN = SIGNALSMITH_SPEED_ABSOLUTE_MIN;
/** @deprecated Prefer {@link SIGNALSMITH_SPEED_ABSOLUTE_MAX}. */
export const BUNGEE_SPEED_ABSOLUTE_MAX = SIGNALSMITH_SPEED_ABSOLUTE_MAX;

/** Control UI tempo range for SoundTouch (tighter — media rate + WSOLA). */
export const SOUNDTOUCH_SPEED_UI_MIN = 0.75;
export const SOUNDTOUCH_SPEED_UI_MAX = 1.25;

/** Absolute SoundTouch / media-element hard clamp. */
export const SOUNDTOUCH_SPEED_ABSOLUTE_MIN = 0.5;
export const SOUNDTOUCH_SPEED_ABSOLUTE_MAX = 1.5;

/**
 * @deprecated Prefer {@link SIGNALSMITH_SPEED_UI_MIN} / {@link getSpeedRangeForEngine}.
 * Kept as alias of the Signalsmith UI floor for older call sites.
 */
export const DSP_SPEED_MIN = SIGNALSMITH_SPEED_UI_MIN;
/**
 * @deprecated Prefer {@link SIGNALSMITH_SPEED_UI_MAX} / {@link getSpeedRangeForEngine}.
 */
export const DSP_SPEED_MAX = SIGNALSMITH_SPEED_UI_MAX;

/** Default Control UI step for speed buttons / shortcuts. */
export const DSP_SPEED_UI_STEP = 0.05;

/** Neutral bypass epsilon for speed (|speed − 1.0|). */
export const DSP_SPEED_NEUTRAL_EPSILON = 0.001;

export interface DspPitchRange {
  min: number;
  max: number;
}

export interface DspSpeedRange {
  min: number;
  max: number;
  /** Suggested UI step (Control buttons). */
  step: number;
}

/**
 * Returns the Control UI semitone range for the active DSP engine.
 */
export function getPitchRangeForEngine(engine: DspPitchEngine): DspPitchRange {
  if (engine === 'soundtouch') {
    return { min: SOUNDTOUCH_PITCH_MIN, max: SOUNDTOUCH_PITCH_MAX };
  }
  return { min: SIGNALSMITH_PITCH_UI_MIN, max: SIGNALSMITH_PITCH_UI_MAX };
}

/**
 * Returns the Control UI tempo range for the active DSP engine.
 */
export function getSpeedRangeForEngine(engine: DspPitchEngine): DspSpeedRange {
  if (engine === 'soundtouch') {
    return {
      min: SOUNDTOUCH_SPEED_UI_MIN,
      max: SOUNDTOUCH_SPEED_UI_MAX,
      step: DSP_SPEED_UI_STEP
    };
  }
  return {
    min: SIGNALSMITH_SPEED_UI_MIN,
    max: SIGNALSMITH_SPEED_UI_MAX,
    step: DSP_SPEED_UI_STEP
  };
}

/**
 * Coerces persisted / IPC values to a valid {@link DspPitchEngine}.
 * Legacy `'bungee'` / `'hifi'` → `'signalsmith'`. Unknown / missing → `'signalsmith'`.
 */
export function coerceDspPitchEngine(value: unknown): DspPitchEngine {
  if (value === 'soundtouch') return 'soundtouch';
  if (value === 'signalsmith' || value === 'bungee' || value === 'hifi') return 'signalsmith';
  return 'signalsmith';
}

/**
 * Rounds and clamps a semitone offset to the UI range of the given engine.
 */
export function clampPitchForEngine(semitones: number, engine: DspPitchEngine): number {
  const { min, max } = getPitchRangeForEngine(engine);
  const n = Number.isFinite(semitones) ? Math.round(semitones) : 0;
  return Math.max(min, Math.min(max, n));
}

/**
 * Rounds to 0.01 and clamps playback speed to the UI range of the given engine.
 */
export function clampSpeedForEngine(speed: number, engine: DspPitchEngine): number {
  const { min, max } = getSpeedRangeForEngine(engine);
  const n = Number.isFinite(speed) ? speed : 1;
  return Math.max(min, Math.min(max, Math.round(n * 100) / 100));
}

/**
 * Absolute Signalsmith hard clamp (0.50–2.00), round 0.01.
 */
export function clampSignalsmithAbsoluteSpeed(speed: number): number {
  const n = Number.isFinite(speed) ? speed : 1;
  return Math.max(
    SIGNALSMITH_SPEED_ABSOLUTE_MIN,
    Math.min(SIGNALSMITH_SPEED_ABSOLUTE_MAX, Math.round(n * 100) / 100)
  );
}

/**
 * @deprecated Prefer {@link clampSignalsmithAbsoluteSpeed}.
 */
export function clampBungeeAbsoluteSpeed(speed: number): number {
  return clampSignalsmithAbsoluteSpeed(speed);
}

/**
 * @deprecated Prefer {@link clampSpeedForEngine} with the active engine.
 * Clamps to the Signalsmith UI window (0.50–1.50).
 */
export function clampPlaybackSpeed(speed: number): number {
  return clampSpeedForEngine(speed, 'signalsmith');
}

/**
 * True when DSP can disconnect for bit-perfect pass-through
 * (pitch 0 and speed ≈ 1.0 within {@link DSP_SPEED_NEUTRAL_EPSILON}).
 */
export function isDspNeutralBypass(pitchSemitones: number, speed: number): boolean {
  return pitchSemitones === 0 && Math.abs(speed - 1) < DSP_SPEED_NEUTRAL_EPSILON;
}
