import type { KaraokeMediaTrack } from '../../shared/types';
import { checkTrackLocalFileExists } from './localFileCheck';

/**
 * Re-check session `missingTrackIds` after a library refresh / rescan.
 *
 * Why: Aggiorna Libreria updates SQLite + Local pages but historically left
 * sticky rose “missing” flags even when the USB/file was back on disk.
 * Safety-First: never auto-deletes rows — only clears false-positive UI marks.
 *
 * @param missingTrackIds - Current session missing ids from karaokeStore
 * @param resolveTrack - Lookup local path (Local list, queue, or db.getTrackById)
 * @param clearMissingTrackIds - Batch store clearer
 * @returns Cleared vs still-missing ids for tests / logging
 */
export async function reconcileMissingTrackFlags(options: {
  missingTrackIds: readonly string[];
  resolveTrack: (
    trackId: string
  ) =>
    | Promise<Pick<KaraokeMediaTrack, 'localFilePath' | 'source' | 'uri'> | null | undefined>
    | Pick<KaraokeMediaTrack, 'localFilePath' | 'source' | 'uri'>
    | null
    | undefined;
  clearMissingTrackIds: (trackIds: string[]) => void;
}): Promise<{ cleared: string[]; stillMissing: string[] }> {
  const cleared: string[] = [];
  const stillMissing: string[] = [];
  const ids = Array.from(new Set(options.missingTrackIds.filter(Boolean)));

  for (const trackId of ids) {
    let track: Pick<KaraokeMediaTrack, 'localFilePath' | 'source' | 'uri'> | null | undefined;
    try {
      track = await options.resolveTrack(trackId);
    } catch {
      track = null;
    }

    // Orphan UI flag: track gone from catalog and not resolvable → drop stale mark.
    if (!track) {
      cleared.push(trackId);
      continue;
    }

    const probe = await checkTrackLocalFileExists(track);
    if (probe.exists) {
      cleared.push(trackId);
    } else {
      stillMissing.push(trackId);
    }
  }

  if (cleared.length) {
    options.clearMissingTrackIds(cleared);
  }

  return { cleared, stillMissing };
}

/**
 * Build a resolver that prefers in-memory Local/queue rows, then optional DB lookup.
 * Time: O(N + M) to index maps once, then O(1) / IPC per missing id.
 */
export function createMissingTrackResolver(options: {
  localTracks: readonly KaraokeMediaTrack[];
  queueTracks: readonly Pick<KaraokeMediaTrack, 'id' | 'localFilePath' | 'source' | 'uri'>[];
  getTrackById?: (
    trackId: string
  ) => Promise<Pick<KaraokeMediaTrack, 'localFilePath' | 'source' | 'uri'> | null | undefined>;
}): (
  trackId: string
) => Promise<Pick<KaraokeMediaTrack, 'localFilePath' | 'source' | 'uri'> | null> {
  const byId = new Map<string, Pick<KaraokeMediaTrack, 'localFilePath' | 'source' | 'uri'>>();
  for (const t of options.localTracks) {
    if (t?.id) byId.set(t.id, t);
  }
  for (const t of options.queueTracks) {
    if (t?.id && !byId.has(t.id)) byId.set(t.id, t);
  }

  return async (trackId: string) => {
    const cached = byId.get(trackId);
    if (cached) return cached;
    if (!options.getTrackById) return null;
    try {
      const row = await options.getTrackById(trackId);
      return row ?? null;
    } catch {
      return null;
    }
  };
}
