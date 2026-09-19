/**
 * HTDemucs advanced performance settings (Download Instrumental only).
 *
 * Shown in Settings only when `instrumentalVocalRemoverMethod === 'aiHtDemucs'`.
 * Non-Demucs methods must not receive these knobs in the AI worker payload.
 *
 * Mapping (EN):
 * - `demucsShifts` → Meta Demucs-style shift averaging (0 | 1 | 2). 0 = single pass.
 * - `demucsSegmentSize` → preferred segment length in seconds (5..20). The embedded
 *   ONNX window is fixed (~7.8 s / TRAINING_SAMPLES); values are coerced and injected
 *   for stride/padding policy in the worker wrapper.
 * - `demucsOverlap` → fractional overlap between successive Demucs windows (0.10–0.50).
 */

export const DEMUCS_SHIFTS_OPTIONS = [0, 1, 2] as const;
export type DemucsShifts = (typeof DEMUCS_SHIFTS_OPTIONS)[number];

export const DEMUCS_DEFAULT_SHIFTS: DemucsShifts = 0;
/** Preferred segment length (seconds); demucs-web TRAINING_SAMPLES ≈ 7.8 s. */
export const DEMUCS_DEFAULT_SEGMENT_SIZE = 8;
export const DEMUCS_DEFAULT_OVERLAP = 0.25;

export const DEMUCS_SEGMENT_MIN = 5;
export const DEMUCS_SEGMENT_MAX = 20;
export const DEMUCS_OVERLAP_MIN = 0.1;
export const DEMUCS_OVERLAP_MAX = 0.5;
export const DEMUCS_OVERLAP_STEP = 0.05;

export type DemucsAdvancedSettings = {
  demucsShifts: DemucsShifts;
  demucsSegmentSize: number;
  demucsOverlap: number;
};

/** Wire / persist shape before coerce. */
export type DemucsAdvancedSettingsInput = {
  demucsShifts?: number;
  demucsSegmentSize?: number;
  demucsOverlap?: number;
};

/** Coerce shifts to 0 | 1 | 2. */
export function coerceDemucsShifts(value: unknown): DemucsShifts {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEMUCS_DEFAULT_SHIFTS;
  const t = Math.round(n);
  if (t <= 0) return 0;
  if (t === 1) return 1;
  return 2;
}

/** Coerce segment length (seconds) to [5, 20], 0.1 precision. */
export function coerceDemucsSegmentSize(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEMUCS_DEFAULT_SEGMENT_SIZE;
  const clamped = Math.max(DEMUCS_SEGMENT_MIN, Math.min(DEMUCS_SEGMENT_MAX, n));
  return Math.round(clamped * 10) / 10;
}

/** Coerce overlap to [0.10, 0.50], 0.01 precision. */
export function coerceDemucsOverlap(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEMUCS_DEFAULT_OVERLAP;
  const clamped = Math.max(DEMUCS_OVERLAP_MIN, Math.min(DEMUCS_OVERLAP_MAX, n));
  return Math.round(clamped * 100) / 100;
}

export function coerceDemucsAdvancedSettings(
  partial?: DemucsAdvancedSettingsInput | Partial<DemucsAdvancedSettings> | null
): DemucsAdvancedSettings {
  return {
    demucsShifts: coerceDemucsShifts(partial?.demucsShifts),
    demucsSegmentSize: coerceDemucsSegmentSize(partial?.demucsSegmentSize),
    demucsOverlap: coerceDemucsOverlap(partial?.demucsOverlap)
  };
}

export function isDemucsInstrumentalMethod(method: string | undefined | null): boolean {
  return method === 'aiHtDemucs';
}

/**
 * Build Demucs-only worker/download payload fields.
 * Returns `undefined` for MDX / Roformer / algorithmic so callers omit the knobs.
 */
export function demucsPayloadForMethod(
  method: string | undefined | null,
  settings: DemucsAdvancedSettingsInput | Partial<DemucsAdvancedSettings> | null | undefined
): DemucsAdvancedSettings | undefined {
  if (!isDemucsInstrumentalMethod(method)) return undefined;
  return coerceDemucsAdvancedSettings(settings);
}
