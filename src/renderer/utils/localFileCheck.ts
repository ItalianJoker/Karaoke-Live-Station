import type { KaraokeMediaTrack } from '../../shared/types';

/**
 * True when `filePath` must not be probed with Node `fs` / IPC.
 * Empty strings, http(s) URLs, and protocol URIs (karaoke/blob/data) skip the disk check.
 */
export function shouldSkipLocalFileExistsCheck(filePath: string | undefined | null): boolean {
  const p = (filePath || '').trim();
  if (!p) return true;
  if (/^https?:\/\//i.test(p)) return true;
  if (/^(karaoke|blob|data):/i.test(p)) return true;
  return false;
}

/**
 * Whether a track needs a local disk existence check before enqueue / play.
 * Remote / YouTube entries without `localFilePath` always skip (treated as OK).
 */
export function trackNeedsLocalFileCheck(
  track: Pick<KaraokeMediaTrack, 'localFilePath' | 'source' | 'uri'>
): boolean {
  if (!track.localFilePath?.trim()) return false;
  return !shouldSkipLocalFileExistsCheck(track.localFilePath);
}

/**
 * Probe disk via `library.checkFileExists` IPC. Never throws.
 * Empty / web URLs skip fs and report `{ exists: true }`.
 *
 * @param filePath - Absolute local path, or empty / URL (skipped)
 * @returns `{ exists, path }` matching the main-process contract shape
 */
export async function checkLocalMediaFileExists(
  filePath: string | undefined | null
): Promise<{ exists: boolean; path: string }> {
  const pathStr = (filePath || '').trim();
  if (shouldSkipLocalFileExistsCheck(pathStr)) {
    return { exists: true, path: pathStr };
  }
  try {
    const api =
      typeof window !== 'undefined' ? window.karaokeApi?.library?.checkFileExists : undefined;
    if (!api) {
      // Outside Electron (unit probes) — assume present to avoid false positives
      return { exists: true, path: pathStr };
    }
    const exists = await api(pathStr);
    return { exists: Boolean(exists), path: pathStr };
  } catch {
    return { exists: false, path: pathStr };
  }
}

/**
 * Track-level wrapper: skips remote/YouTube-without-path, otherwise probes disk.
 */
export async function checkTrackLocalFileExists(
  track: Pick<KaraokeMediaTrack, 'localFilePath' | 'source' | 'uri'>
): Promise<{ exists: boolean; path: string; skipped: boolean }> {
  if (!trackNeedsLocalFileCheck(track)) {
    return { exists: true, path: (track.localFilePath || '').trim(), skipped: true };
  }
  const result = await checkLocalMediaFileExists(track.localFilePath);
  return { ...result, skipped: false };
}
