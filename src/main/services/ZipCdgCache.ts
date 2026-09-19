/**
 * On-demand ZIP CD+G extract cache under `userData/temp/zip_cache/<trackId>/`.
 *
 * Why: catalog keeps the `.zip` as `localFilePath`; playback serves extracted
 * MP3/WAV + CDG via `karaoke://local/`. Cleanup on dequeue / app quit only
 * touches this temp subtree (Safety-First — never libraryPath).
 */

import fs from 'fs';
import path from 'path';
import { extractZipCdgPair, inspectZipForCdgPair, type ZipCdgPair } from '../../shared/zipCdg';

export type ZipPlaybackPaths = {
  trackId: string;
  zipPath: string;
  audioPath: string;
  cdgPath: string;
  audioExt: '.mp3' | '.wav';
  cacheDir: string;
};

export class ZipCdgCache {
  private readonly cacheRoot: string;
  /** In-flight extracts — coalesce concurrent play requests for the same track. */
  private readonly inflight = new Map<string, Promise<ZipPlaybackPaths>>();

  constructor(tempDir: string) {
    this.cacheRoot = path.join(tempDir, 'zip_cache');
  }

  getCacheRoot(): string {
    return this.cacheRoot;
  }

  private cacheDirFor(trackId: string): string {
    // Sanitize trackId for filesystem (YouTube ids / base64url are already safe)
    const safe = String(trackId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
    return path.join(this.cacheRoot, safe || 'unknown');
  }

  /**
   * Ensure the CD+G pair is extracted. Reuses cache when both files exist.
   * Yields to the event loop before heavy inflate work so Regia stays responsive.
   */
  async ensureExtracted(trackId: string, zipPath: string): Promise<ZipPlaybackPaths> {
    const existing = this.inflight.get(trackId);
    if (existing) return existing;

    const job = this.extractJob(trackId, zipPath).finally(() => {
      this.inflight.delete(trackId);
    });
    this.inflight.set(trackId, job);
    return job;
  }

  private async extractJob(trackId: string, zipPath: string): Promise<ZipPlaybackPaths> {
    // Non-blocking yield before sync inflate (large packs)
    await new Promise<void>((r) => setImmediate(r));

    if (!fs.existsSync(zipPath)) {
      throw new Error(`ZIP missing on disk: ${zipPath}`);
    }

    const pair: ZipCdgPair | null = inspectZipForCdgPair(zipPath);
    if (!pair) {
      throw new Error(`Not a karaoke CD+G ZIP: ${zipPath}`);
    }

    const cacheDir = this.cacheDirFor(trackId);
    const audioPath = path.join(cacheDir, `track${pair.audioExt}`);
    const cdgPath = path.join(cacheDir, 'track.cdg');

    if (fs.existsSync(audioPath) && fs.existsSync(cdgPath)) {
      return { trackId, zipPath, audioPath, cdgPath, audioExt: pair.audioExt, cacheDir };
    }

    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    await new Promise<void>((r) => setImmediate(r));
    const extracted = extractZipCdgPair(zipPath, cacheDir, pair);

    return {
      trackId,
      zipPath,
      audioPath: extracted.audioPath,
      cdgPath: extracted.cdgPath,
      audioExt: extracted.audioExt,
      cacheDir
    };
  }

  /** Remove one track's extract directory (dequeue / replace). */
  releaseTrack(trackId: string): void {
    const dir = this.cacheDirFor(trackId);
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch (err) {
      console.warn('ZipCdgCache: failed releasing track cache', trackId, err);
    }
  }

  /** Wipe entire zip_cache tree (app quit). */
  cleanupAll(): void {
    try {
      if (fs.existsSync(this.cacheRoot)) {
        fs.rmSync(this.cacheRoot, { recursive: true, force: true });
      }
    } catch (err) {
      console.warn('ZipCdgCache: failed cleanupAll', err);
    }
  }
}
