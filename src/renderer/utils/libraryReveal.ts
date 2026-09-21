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
 * Locate a catalog row by track id, then by normalized local path, and finally by title & artist.
 * @returns Index in `tracks`, or -1 when not present in the current list window.
 */
export function findTrackRevealIndex(
  tracks: ReadonlyArray<
    Pick<KaraokeMediaTrack, 'id' | 'localFilePath'> & Partial<Pick<KaraokeMediaTrack, 'title' | 'artist'>>
  >,
  req: Pick<LibraryRevealRequest, 'trackId' | 'localFilePath'> &
    Partial<Pick<LibraryRevealRequest, 'title' | 'artist'>>
): number {
  if (!tracks.length) return -1;
  if (req.trackId) {
    const byId = tracks.findIndex((t) => t.id === req.trackId);
    if (byId >= 0) return byId;
  }
  const normPath = (p?: string) => (p || '').trim().toLowerCase().replace(/\\/g, '/');
  const pathNorm = normPath(req.localFilePath);
  if (pathNorm) {
    const byPath = tracks.findIndex((t) => normPath(t.localFilePath) === pathNorm);
    if (byPath >= 0) return byPath;
  }
  if (req.title) {
    const tNorm = req.title.trim().toLowerCase();
    const aNorm = (req.artist || '').trim().toLowerCase();
    const byMeta = tracks.findIndex(
      (t) =>
        (t.title || '').trim().toLowerCase() === tNorm &&
        (!aNorm || (t.artist || '').trim().toLowerCase() === aNorm)
    );
    if (byMeta >= 0) return byMeta;
  }
  return -1;
}
