import type { KaraokeMediaTrack } from './types';

/** YouTube video ids are 11 chars from [A-Za-z0-9_-]. */
const YT_ID_RE = /^[\w-]{11}$/;

/**
 * Extracts a YouTube video id from a bare id, watch/short URL, or null.
 * Mirrors DownloadManager.extractYouTubeId for renderer-safe use.
 */
export function extractYouTubeVideoId(urlOrId?: string): string | null {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  const trimmed = urlOrId.trim();
  if (YT_ID_RE.test(trimmed)) return trimmed;

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname.includes('youtu.be')) {
      const id = parsed.pathname.replace(/^\//, '').slice(0, 11);
      return YT_ID_RE.test(id) ? id : null;
    }
    const v = parsed.searchParams.get('v');
    if (v && YT_ID_RE.test(v)) return v;
    const shorts = parsed.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{11})/);
    if (shorts) return shorts[1];
  } catch {
    // Not a URL
  }

  const loose = trimmed.match(/(?:v=|\/)([\w-]{11})(?:[^\w-]|$)/);
  return loose ? loose[1] : null;
}

/** Stable watch URL for a YouTube video id (used when restoring web search rows). */
export function buildYouTubeWatchUri(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Library files archived from YouTube are named `${youtubeId}_Artist - Title.ext`.
 * Returns the leading id when present.
 */
export function extractYouTubeIdFromLibraryPath(filePath?: string): string | null {
  if (!filePath || typeof filePath !== 'string') return null;
  const base = filePath.replace(/\\/g, '/').split('/').pop() || '';
  const prefix = base.match(/^([\w-]{11})_/);
  return prefix ? prefix[1] : null;
}

/** Identity keys collected from a deleted library track for matching web/local rows. */
export interface DeletedLibraryIdentity {
  id?: string;
  uri?: string;
  localFilePath?: string;
}

/**
 * Builds a set of match keys (id, uri, path, YouTube id) for a deleted library row.
 * Used to find the same item still patched into web search results.
 */
export function collectDeletedLibraryMatchKeys(deleted: DeletedLibraryIdentity): Set<string> {
  const keys = new Set<string>();
  const add = (value?: string) => {
    const v = (value || '').trim();
    if (v) keys.add(v);
  };

  add(deleted.id);
  add(deleted.uri);
  const path = (deleted.localFilePath || '').trim();
  if (path) {
    add(path);
    add(path.toLowerCase());
  }

  const ytFromId = extractYouTubeVideoId(deleted.id);
  const ytFromUri = extractYouTubeVideoId(deleted.uri);
  const ytFromPath = extractYouTubeIdFromLibraryPath(deleted.localFilePath);
  for (const yt of [ytFromId, ytFromUri, ytFromPath]) {
    if (yt) {
      add(yt);
      add(buildYouTubeWatchUri(yt));
    }
  }

  return keys;
}

function trackMatchesDeletedKeys(track: KaraokeMediaTrack, keys: Set<string>): boolean {
  if (keys.size === 0) return false;
  if (keys.has(track.id) || keys.has(track.uri)) return true;
  const path = (track.localFilePath || '').trim();
  if (path && (keys.has(path) || keys.has(path.toLowerCase()))) return true;
  const yt =
    extractYouTubeVideoId(track.id) ||
    extractYouTubeVideoId(track.uri) ||
    extractYouTubeIdFromLibraryPath(track.localFilePath);
  return Boolean(yt && keys.has(yt));
}

/**
 * If this row was a YouTube result patched to local_library after download,
 * restore source/uri so Web search shows Download again.
 * Non-YouTube rows (midi / pure local) are left unchanged.
 */
export function revertLibraryMembershipOnTrack(
  track: KaraokeMediaTrack,
  deleted: DeletedLibraryIdentity
): KaraokeMediaTrack {
  const keys = collectDeletedLibraryMatchKeys(deleted);
  if (!trackMatchesDeletedKeys(track, keys)) return track;

  const ytId =
    extractYouTubeVideoId(track.id) ||
    extractYouTubeVideoId(deleted.id) ||
    extractYouTubeVideoId(deleted.uri) ||
    extractYouTubeIdFromLibraryPath(track.localFilePath) ||
    extractYouTubeIdFromLibraryPath(deleted.localFilePath);

  // Only YouTube-origin rows should flip back to Download actions.
  if (!ytId) return track;
  if (track.source !== 'local_library' && !track.localFilePath) return track;

  const { localFilePath: _removed, ...rest } = track;
  return {
    ...rest,
    id: ytId,
    source: 'youtube',
    uri: buildYouTubeWatchUri(ytId),
    isEmbeddable: true
  };
}

/** Map helper: revert any matching tracks in a result list. */
export function revertLibraryMembershipInTrackList(
  tracks: KaraokeMediaTrack[],
  deleted: DeletedLibraryIdentity
): KaraokeMediaTrack[] {
  const keys = collectDeletedLibraryMatchKeys(deleted);
  if (keys.size === 0) return tracks;
  let changed = false;
  const next = tracks.map((track) => {
    const reverted = revertLibraryMembershipOnTrack(track, deleted);
    if (reverted !== track) changed = true;
    return reverted;
  });
  return changed ? next : tracks;
}
