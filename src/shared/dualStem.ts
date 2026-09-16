/**
 * On-demand dual-stem vocal remover — shared types and cache layout.
 *
 * Playback states (video clock is master when dual-stem is active):
 * - NATIVE_AUDIO: MediaElement feeds the graph; no FFmpeg/AI until engaged
 * - EXTRACTING_AND_SEPARATING: native audio continues; stems built in background
 * - DUAL_STEM_ACTIVE: video muted; instrumental + vocals buffers synced to currentTime
 */

export type DualStemPlaybackState =
  | 'NATIVE_AUDIO'
  | 'EXTRACTING_AND_SEPARATING'
  | 'DUAL_STEM_ACTIVE';

/** On-disk filenames under userData/dual-stem-cache/<sha256>/ */
export const DUAL_STEM_INSTRUMENTAL_FILENAME = 'stem_instrumental.wav';
export const DUAL_STEM_VOCALS_FILENAME = 'stem_vocals.wav';
export const DUAL_STEM_META_FILENAME = 'meta.json';

export type DualStemCacheMeta = {
  sourcePath: string;
  sourceSize: number;
  sourceMtimeMs: number;
  sha256: string;
  sampleRate: number;
  method: string;
  createdAt: string;
};

export type DualStemLookupResult = {
  success: boolean;
  /** Present when both stem WAVs exist for this media hash. */
  hit?: boolean;
  sha256?: string;
  instrumentalUrl?: string;
  vocalsUrl?: string;
  meta?: DualStemCacheMeta;
  error?: string;
};

export type DualStemSaveResult = {
  success: boolean;
  sha256?: string;
  instrumentalUrl?: string;
  vocalsUrl?: string;
  error?: string;
};

/**
 * Guide-vocal fader: 1 = full guide vocal (native-equivalent mix), 0 = instrumental only.
 * Engaging the feature means level &lt; 1 (or explicit toggle → 0).
 */
export function isDualStemEngaged(vocalGuideLevel: number): boolean {
  return vocalGuideLevel < 0.999;
}
