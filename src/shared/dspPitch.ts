/**
 * Pitch / speed DSP engine selection and semitone range constants.
 *
 * Bungee (default): phase-vocoder Wasm AudioWorklet — recommended UI ±8,
 * internal hard cap ±12 without destructive artifacts.
 * SoundTouch (legacy/light): WSOLA ScriptProcessor — hard UI ±4.
 *
 * MIDI/KAR transposition is independent (SpessaSynth note shift) and does not
 * use these DSP engines.
 */

/** Selectable media pitch/speed DSP backends. */
export type DspPitchEngine = 'bungee' | 'soundtouch';

/** Recommended Control-window UI range for Bungee (semitones). */
export const BUNGEE_PITCH_UI_MIN = -8;
export const BUNGEE_PITCH_UI_MAX = 8;

/** Absolute non-destructive Bungee clamp (semitones); UI uses recommended ±8. */
export const BUNGEE_PITCH_ABSOLUTE_MIN = -12;
export const BUNGEE_PITCH_ABSOLUTE_MAX = 12;

/** Hard UI / DSP clamp for SoundTouch WSOLA (semitones). */
export const SOUNDTOUCH_PITCH_MIN = -4;
export const SOUNDTOUCH_PITCH_MAX = 4;

/** Independent tempo scaling shared by both engines (media playback). */
export const DSP_SPEED_MIN = 0.5;
export const DSP_SPEED_MAX = 1.5;

export interface DspPitchRange {
  min: number;
  max: number;
}

/**
 * Returns the Control UI semitone range for the active DSP engine.
 */
export function getPitchRangeForEngine(engine: DspPitchEngine): DspPitchRange {
  if (engine === 'soundtouch') {
    return { min: SOUNDTOUCH_PITCH_MIN, max: SOUNDTOUCH_PITCH_MAX };
  }
  return { min: BUNGEE_PITCH_UI_MIN, max: BUNGEE_PITCH_UI_MAX };
}

/**
 * Coerces persisted / IPC values to a valid {@link DspPitchEngine}.
 * Unknown / missing → `'bungee'` (product default).
 */
export function coerceDspPitchEngine(value: unknown): DspPitchEngine {
  if (value === 'soundtouch' || value === 'bungee') return value;
  return 'bungee';
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
 * Clamps playback speed to the shared 0.50x–1.50x window.
 */
export function clampPlaybackSpeed(speed: number): number {
  const n = Number.isFinite(speed) ? speed : 1;
  return Math.max(DSP_SPEED_MIN, Math.min(DSP_SPEED_MAX, Math.round(n * 100) / 100));
}

/**
 * True when DSP can disconnect for bit-perfect pass-through
 * (pitch 0 and speed 1.0).
 */
export function isDspNeutralBypass(pitchSemitones: number, speed: number): boolean {
  return pitchSemitones === 0 && Math.abs(speed - 1) < 1e-6;
}
