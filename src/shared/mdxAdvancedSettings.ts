/**
 * UVR-MDX-NET advanced performance settings (Download Instrumental only).
 *
 * Shown in Settings only when `instrumentalVocalRemoverMethod === 'aiMdxKaraoke2'`.
 * Non-MDX methods must not receive these knobs in the AI worker payload.
 *
 * Mapping (EN):
 * - `mdxSegmentSize` → UVR `dim_t` (time frames). `chunk_size = hop * (dim_t - 1)`.
 * - `mdxOverlap` → fractional overlap; hop between ORT windows is
 *   `mdxStepSamples(overlap) = floor((1 - overlap) * chunk_size)` (not UVR "Default"
 *   `chunk_size - n_fft`). UI default 0.25 → ~25% overlap.
 * - `mdxEnableOrt` → ORT WASM graphOptimizationLevel + SIMD; ORT is always required
 *   for MDX inference (toggle cannot skip the engine).
 */

/** Allowed UVR-style segment sizes (powers of 2). Karaoke 2 catalog target is 256. */
export const MDX_SEGMENT_SIZES = [64, 128, 256, 512, 1024] as const;
export type MdxSegmentSize = (typeof MDX_SEGMENT_SIZES)[number];

export const MDX_DEFAULT_SEGMENT_SIZE: MdxSegmentSize = 256;
/** Fractional overlap default — between UVR Default (~2%) and prior KLS 50% OLA. */
export const MDX_DEFAULT_OVERLAP = 0.25;
export const MDX_DEFAULT_ENABLE_ORT = true;

export const MDX_OVERLAP_MIN = 0.1;
export const MDX_OVERLAP_MAX = 0.99;
/** Warn in UI when overlap is studio-slow (≥ 0.75). */
export const MDX_OVERLAP_WARN_THRESHOLD = 0.75;
export const MDX_OVERLAP_STEP = 0.05;

export type MdxAdvancedSettings = {
  mdxSegmentSize: MdxSegmentSize;
  mdxOverlap: number;
  mdxEnableOrt: boolean;
};

/** Wire / persist shape before coerce (numbers may be any finite value). */
export type MdxAdvancedSettingsInput = {
  mdxSegmentSize?: number;
  mdxOverlap?: number;
  mdxEnableOrt?: boolean;
};

/** Coerce unknown persist/UI values to the nearest allowed power-of-two segment size. */
export function coerceMdxSegmentSize(value: unknown): MdxSegmentSize {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return MDX_DEFAULT_SEGMENT_SIZE;
  const clamped = Math.max(64, Math.min(1024, Math.round(n)));
  // Snap to nearest allowed power of two in the catalog.
  let best: MdxSegmentSize = MDX_DEFAULT_SEGMENT_SIZE;
  let bestDist = Infinity;
  for (const s of MDX_SEGMENT_SIZES) {
    const d = Math.abs(s - clamped);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

/** Coerce overlap to [0.10, 0.99], snapped to 0.01 precision. */
export function coerceMdxOverlap(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return MDX_DEFAULT_OVERLAP;
  const clamped = Math.max(MDX_OVERLAP_MIN, Math.min(MDX_OVERLAP_MAX, n));
  return Math.round(clamped * 100) / 100;
}

/** Coerce ORT acceleration toggle; default true. */
export function coerceMdxEnableOrt(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === '0' || value === 'false' || value === 'off') return false;
  if (value === 1 || value === '1' || value === 'true' || value === 'on') return true;
  return MDX_DEFAULT_ENABLE_ORT;
}

export function coerceMdxAdvancedSettings(
  partial?: MdxAdvancedSettingsInput | Partial<MdxAdvancedSettings> | null
): MdxAdvancedSettings {
  return {
    mdxSegmentSize: coerceMdxSegmentSize(partial?.mdxSegmentSize),
    mdxOverlap: coerceMdxOverlap(partial?.mdxOverlap),
    mdxEnableOrt: coerceMdxEnableOrt(partial?.mdxEnableOrt)
  };
}

export function isMdxInstrumentalMethod(method: string | undefined | null): boolean {
  return method === 'aiMdxKaraoke2';
}

/**
 * Build MDX-only worker/download payload fields.
 * Returns `undefined` for Demucs / Roformer / algorithmic so callers omit the knobs.
 */
export function mdxPayloadForMethod(
  method: string | undefined | null,
  settings: MdxAdvancedSettingsInput | Partial<MdxAdvancedSettings> | null | undefined
): MdxAdvancedSettings | undefined {
  if (!isMdxInstrumentalMethod(method)) return undefined;
  return coerceMdxAdvancedSettings(settings);
}

/** Client-side range check before IPC (throws on invalid — callers catch/toast). */
export function assertMdxAdvancedSettingsInRange(settings: MdxAdvancedSettings): void {
  const coerced = coerceMdxAdvancedSettings(settings);
  if (coerced.mdxSegmentSize !== settings.mdxSegmentSize) {
    throw new Error(
      `mdxSegmentSize out of range (allowed: ${MDX_SEGMENT_SIZES.join(', ')})`
    );
  }
  if (
    settings.mdxOverlap < MDX_OVERLAP_MIN ||
    settings.mdxOverlap > MDX_OVERLAP_MAX ||
    !Number.isFinite(settings.mdxOverlap)
  ) {
    throw new Error(
      `mdxOverlap out of range [${MDX_OVERLAP_MIN}, ${MDX_OVERLAP_MAX}]`
    );
  }
  if (typeof settings.mdxEnableOrt !== 'boolean') {
    throw new Error('mdxEnableOrt must be boolean');
  }
}
