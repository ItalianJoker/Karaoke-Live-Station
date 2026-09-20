import type { KaraokeMediaTrack, MediaSource } from '../../shared/types';

/**
 * Payload for queue → local-library reveal (short-lived store request).
 * Why: ControlWindow switches the right tab; LibraryPanel scrolls/highlights the row.
 */
export interface LibraryRevealRequest {
  /** Monotonic nonce so rapid clicks supersede stale async resolve work. */
  requestId: number;
  trackId: string;
  title: string;
  artist: string;
  source: MediaSource;
  localFilePath?: string;
  uri?: string;
}

/** Fields needed to enqueue a reveal (store assigns `requestId`). */
export type LibraryRevealRequestInput = Omit<LibraryRevealRequest, 'requestId'>;

/**
 * Whether the queue row should show “reveal in library”.
 * Pure YouTube/web entries without a local path cannot map to Libreria Locale.
 */
export function canRevealTrackInLibrary(
  track: Pick<KaraokeMediaTrack, 'source' | 'localFilePath'>
): boolean {
  if (track.source === 'local_library' || track.source === 'midi') return true;
  return Boolean(track.localFilePath?.trim());
}

/**
 * Prefer title, then artist, for FTS / local filter seed on large catalogs.
 * Empty seed keeps browse mode (first loaded pages only).
 */
export function buildLibraryRevealSearchSeed(
  req: Pick<LibraryRevealRequest, 'title' | 'artist'>
): string {
  const title = (req.title || '').trim();
  if (title) return title;
  return (req.artist || '').trim();
}

/**
 * Locate a catalog row by track id, then by absolute local path.
 * @returns Index in `tracks`, or -1 when not present in the current list window.
 */
export function findTrackRevealIndex(
  tracks: ReadonlyArray<Pick<KaraokeMediaTrack, 'id' | 'localFilePath'>>,
  req: Pick<LibraryRevealRequest, 'trackId' | 'localFilePath'>
): number {
  if (!tracks.length || !req.trackId) return -1;
  const byId = tracks.findIndex((t) => t.id === req.trackId);
  if (byId >= 0) return byId;
  const path = (req.localFilePath || '').trim();
  if (!path) return -1;
  return tracks.findIndex((t) => (t.localFilePath || '').trim() === path);
}
