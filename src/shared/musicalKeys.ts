/**
 * Musical key / BPM helpers for Regia pitch & speed pills.
 *
 * Pure functions only — safe to import from renderer, main, and tests.
 * Heavy chromagram / onset analysis lives in main `TrackAnalysisService`
 * so play-start stays non-blocking (Safety-First).
 */

/** Sharp-side chromatic names (C…B). */
export const CHROMATIC_SHARP = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B'
] as const;

/** Flat-side chromatic names (C…B). */
export const CHROMATIC_FLAT = [
  'C',
  'Db',
  'D',
  'Eb',
  'E',
  'F',
  'Gb',
  'G',
  'Ab',
  'A',
  'Bb',
  'B'
] as const;

export type KeyNotation = 'sharp' | 'flat' | 'auto';

const ENHARMONIC_TO_PC: Record<string, number> = {
  c: 0,
  'c#': 1,
  db: 1,
  d: 2,
  'd#': 3,
  eb: 3,
  e: 4,
  fb: 4,
  'e#': 5,
  f: 5,
  'f#': 6,
  gb: 6,
  g: 7,
  'g#': 8,
  ab: 8,
  a: 9,
  'a#': 10,
  bb: 10,
  b: 11,
  cb: 11,
  'b#': 0
};

/**
 * Parse a key string like "Am", "F# major", "Bb", "C maj" into pitch-class + mode.
 * Returns null when the label is missing or unparseable.
 */
export function parseMusicalKey(
  key: string | null | undefined
): { pitchClass: number; minor: boolean; rawRoot: string } | null {
  if (key == null) return null;
  const trimmed = String(key).trim();
  if (!trimmed) return null;

  const m = trimmed.match(
    /^([A-Ga-g])([#b♯♭]?)\s*(maj(?:or)?|min(?:or)?|m)?$/i
  );
  if (!m) return null;

  const letter = m[1].toUpperCase();
  let accidental = (m[2] || '').replace('♯', '#').replace('♭', 'b');
  const modeTok = (m[3] || '').toLowerCase();
  const minor = modeTok === 'm' || modeTok.startsWith('min');

  const rootKey = `${letter}${accidental}`.toLowerCase();
  const pc = ENHARMONIC_TO_PC[rootKey];
  if (pc === undefined) return null;

  return { pitchClass: pc, minor, rawRoot: `${letter}${accidental}` };
}

/**
 * Format pitch-class + mode as a display key (e.g. "Am", "F#").
 */
export function formatMusicalKey(
  pitchClass: number,
  minor: boolean,
  notation: KeyNotation = 'auto'
): string {
  const pc = ((pitchClass % 12) + 12) % 12;
  let useFlat = notation === 'flat';
  if (notation === 'auto') {
    // Prefer flats for keys that commonly use them in karaoke packs
    useFlat = [1, 3, 6, 8, 10].includes(pc) && (minor ? [1, 3, 6, 8, 10].includes(pc) : pc === 10 || pc === 3 || pc === 8 || pc === 1 || pc === 6);
    // Simpler heuristic: prefer sharps except for Bb/Eb/Ab/Db/Gb families when minor uses flat roots
    useFlat = minor
      ? [1, 3, 8, 10].includes(pc) // Db, Eb, Ab, Bb minor-ish roots → flats
      : [3, 8, 10].includes(pc); // Eb, Ab, Bb major
  }
  const root = (useFlat ? CHROMATIC_FLAT : CHROMATIC_SHARP)[pc];
  return minor ? `${root}m` : root;
}

/**
 * Transpose a musical key by N semitones.
 * Returns undefined when `key` is missing/unparseable (UI falls back to label-only).
 */
export function transposeKey(
  key: string | null | undefined,
  semitones: number,
  notation: KeyNotation = 'auto'
): string | undefined {
  const parsed = parseMusicalKey(key);
  if (!parsed) return undefined;
  const shifted = parsed.pitchClass + Math.trunc(semitones);
  return formatMusicalKey(shifted, parsed.minor, notation);
}

/**
 * Effective BPM after speed scaling. Rounds to nearest integer.
 * Returns undefined when initial BPM is missing/invalid.
 */
export function effectiveBpm(
  initialBpm: number | null | undefined,
  speed: number
): number | undefined {
  if (initialBpm == null || !Number.isFinite(initialBpm) || initialBpm <= 0) {
    return undefined;
  }
  const spd = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return Math.round(initialBpm * spd);
}

/**
 * Compact Regia label: `Am→Bm` or just the base when transpose is 0 / result equals base.
 * Returns undefined when no key is known (caller keeps label-only pitch pill).
 */
export function formatKeyTransition(
  initialKey: string | null | undefined,
  semitones: number,
  notation: KeyNotation = 'auto'
): string | undefined {
  const base = parseMusicalKey(initialKey)
    ? formatMusicalKey(
        parseMusicalKey(initialKey)!.pitchClass,
        parseMusicalKey(initialKey)!.minor,
        notation
      )
    : undefined;
  if (!base) return undefined;
  const result = transposeKey(initialKey, semitones, notation);
  if (!result || result === base || semitones === 0) return base;
  return `${base}→${result}`;
}

/**
 * Compact Regia label: `120→126` or just the base BPM when speed ≈ 1.
 * Returns undefined when no BPM is known.
 */
export function formatBpmTransition(
  initialBpm: number | null | undefined,
  speed: number
): string | undefined {
  if (initialBpm == null || !Number.isFinite(initialBpm) || initialBpm <= 0) {
    return undefined;
  }
  const base = Math.round(initialBpm);
  const eff = effectiveBpm(initialBpm, speed);
  if (eff == null) return undefined;
  if (Math.abs((speed || 1) - 1) < 0.001 || eff === base) return String(base);
  return `${base}→${eff}`;
}

/**
 * MIDI key-signature meta (sf, mi) → display key string.
 * sf: −7…+7 (flats/sharps), mi: 0 major / 1 minor.
 */
export function keyFromMidiSignature(sf: number, mi: number): string {
  const majorSharp = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
  const majorFlat = ['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];
  const clamped = Math.max(-7, Math.min(7, Math.trunc(sf)));
  let root: string;
  if (clamped >= 0) root = majorSharp[clamped];
  else root = majorFlat[-clamped];
  const minor = mi === 1;
  if (!minor) return root;
  // Relative minor: major root − 3 semitones
  const parsed = parseMusicalKey(root)!;
  return formatMusicalKey(parsed.pitchClass - 3, true, clamped < 0 ? 'flat' : 'sharp');
}

/**
 * Krumhansl-Schmuckler major/minor profiles (normalized later by scorer).
 */
export const KS_MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88
];
export const KS_MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17
];

function correlate(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den > 0 ? num / den : 0;
}

/**
 * Estimate musical key from a 12-bin chromagram (pitch-class histogram).
 * Rotates chroma so candidate tonic sits at index 0, then correlates KS profiles.
 */
export function estimateKeyFromChromagram(chroma: number[]): string | undefined {
  if (!chroma || chroma.length < 12) return undefined;
  const c = chroma.slice(0, 12);
  let bestScore = -Infinity;
  let bestKey: string | undefined;
  for (let root = 0; root < 12; root++) {
    const rotated = Array.from({ length: 12 }, (_, i) => c[(i + root) % 12]);
    const sMaj = correlate(rotated, KS_MAJOR_PROFILE);
    const sMin = correlate(rotated, KS_MINOR_PROFILE);
    if (sMaj > bestScore) {
      bestScore = sMaj;
      bestKey = formatMusicalKey(root, false, 'auto');
    }
    if (sMin > bestScore) {
      bestScore = sMin;
      bestKey = formatMusicalKey(root, true, 'auto');
    }
  }
  return bestKey;
}

/**
 * Estimate BPM from an onset-strength envelope via autocorrelation.
 * `hopSec` is the time per onset bin (e.g. 512/22050).
 */
export function estimateBpmFromOnsetStrength(
  onset: number[],
  hopSec: number,
  minBpm = 70,
  maxBpm = 180
): number | undefined {
  if (!onset || onset.length < 8 || !(hopSec > 0)) return undefined;

  const minLag = Math.max(1, Math.floor(60 / maxBpm / hopSec));
  const maxLag = Math.min(onset.length - 1, Math.ceil(60 / minBpm / hopSec));
  if (maxLag <= minLag) return undefined;

  let bestLag = minLag;
  let bestCorr = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i + lag < onset.length; i++) {
      sum += onset[i] * onset[i + lag];
      count++;
    }
    const corr = count > 0 ? sum / count : 0;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  const bpm = 60 / (bestLag * hopSec);
  if (!Number.isFinite(bpm) || bpm < minBpm || bpm > maxBpm) return undefined;
  return Math.round(bpm);
}
