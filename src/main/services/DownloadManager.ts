import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import {
  DownloadProgressPayload,
  ExistingLocalMedia,
  KaraokeMediaTrack,
  StartDownloadResult
} from '../../shared/types';
import { resolveFfmpegPath, resolveYtDlpPath } from './BinaryResolver';

/** Media extensions considered when matching existing local karaoke files. */
const MEDIA_EXTENSIONS = new Set([
  '.mp4',
  '.webm',
  '.mkv',
  '.mp3',
  '.m4a',
  '.wav',
  '.ogg',
  '.mid',
  '.kar'
]);

/**
 * Options passed to start a media download via yt-dlp.
 */
export interface DownloadOptions {
  /** Remote URL to download (e.g. YouTube video URL) */
  url: string;
  /** If true, extracts and converts audio to MP3 */
  isAudioOnly?: boolean;
  /** Preferred video quality or resolution constraint */
  preferredQuality?: string;
  /** Hint for track title */
  titleHint?: string;
  /** Hint for artist name */
  artistHint?: string;
  /** Stable track id (often the YouTube video id) */
  trackId?: string;
  /** User-configured permanent library directory used for dedup lookups */
  libraryPath?: string;
  /** Optional catalog snapshot used for id/path deduplication */
  catalogTracks?: KaraokeMediaTrack[];
}

/**
 * Callback function listening for live download progress updates.
 */
export type DownloadProgressCallback = (payload: DownloadProgressPayload) => void;

/**
 * Background Download Manager wrapping yt-dlp child processes.
 * Handles progress parsing, audio conversion via ffmpeg, download cancellation,
 * local-file deduplication, and moving files to the karaoke library / queue cache.
 */
export class DownloadManager {
  private tempDir: string;
  private queueCacheDir: string;
  private ffmpegPath: string;
  private ytdlpPath: string;
  private activeProcesses: Map<string, { process: ChildProcess; payload: DownloadProgressPayload; url: string }> =
    new Map();
  private activeUrls: Map<string, string> = new Map();
  private progressListeners: Set<DownloadProgressCallback> = new Set();

  constructor(tempDir: string, queueCacheDir?: string) {
    this.tempDir = tempDir;
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    this.queueCacheDir = queueCacheDir || path.join(path.dirname(this.tempDir), 'queue_cache');
    if (!fs.existsSync(this.queueCacheDir)) {
      fs.mkdirSync(this.queueCacheDir, { recursive: true });
    }

    this.ffmpegPath = resolveFfmpegPath();
    this.ytdlpPath = resolveYtDlpPath();
  }

  public subscribeProgress(cb: DownloadProgressCallback): () => void {
    this.progressListeners.add(cb);
    return () => {
      this.progressListeners.delete(cb);
    };
  }

  private emitProgress(payload: DownloadProgressPayload): void {
    for (const listener of this.progressListeners) {
      try {
        listener(payload);
      } catch (err) {
        console.error('Error in progress listener:', err);
      }
    }
  }

  /** Extracts a YouTube video id from common URL forms, or returns null. */
  public static extractYouTubeId(urlOrId?: string): string | null {
    if (!urlOrId || typeof urlOrId !== 'string') return null;
    const trimmed = urlOrId.trim();
    if (/^[\w-]{11}$/.test(trimmed)) return trimmed;

    try {
      const parsed = new URL(trimmed);
      if (parsed.hostname.includes('youtu.be')) {
        const id = parsed.pathname.replace(/^\//, '').slice(0, 11);
        return /^[\w-]{11}$/.test(id) ? id : null;
      }
      const v = parsed.searchParams.get('v');
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const shorts = parsed.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{11})/);
      if (shorts) return shorts[1];
    } catch {
      // Not a URL
    }

    const loose = trimmed.match(/(?:v=|\/)([\w-]{11})(?:[^\w-]|$)/);
    return loose ? loose[1] : null;
  }

  /** Builds a stable fingerprint from id / URL / artist+title for dedup matching. */
  public static mediaFingerprint(parts: {
    id?: string;
    url?: string;
    title?: string;
    artist?: string;
  }): string {
    const ytId =
      DownloadManager.extractYouTubeId(parts.url) || DownloadManager.extractYouTubeId(parts.id);
    if (ytId) return `yt:${ytId.toLowerCase()}`;
    const norm = `${(parts.artist || '').trim().toLowerCase()}|${(parts.title || '').trim().toLowerCase()}`;
    return crypto.createHash('sha1').update(norm).digest('hex');
  }

  public static sanitizeFilenamePart(name: string): string {
    return (
      (name || '')
        .replace(/[/\\?%*:|"<>]/g, '')
        .replace(/[\x00-\x1f\x7f]/g, '')
        .trim() || 'Unknown'
    );
  }

  public static buildExpectedBasename(artist?: string, title?: string): string | null {
    const a = DownloadManager.sanitizeFilenamePart(artist || '');
    const t = DownloadManager.sanitizeFilenamePart(title || '');
    if (a === 'Unknown' && t === 'Unknown') return null;
    return `${a} - ${t}`;
  }

  /**
   * Locates an already-downloaded copy in the library, queue cache, or catalog DB.
   * Matching order: id → fingerprint/hash token in filename → Artist - Title filename.
   */
  public findExistingLocalMedia(options: {
    url?: string;
    trackId?: string;
    title?: string;
    artist?: string;
    libraryPath?: string;
    catalogTracks?: KaraokeMediaTrack[];
  }): ExistingLocalMedia | null {
    const ytId =
      DownloadManager.extractYouTubeId(options.trackId) ||
      DownloadManager.extractYouTubeId(options.url) ||
      null;
    const fingerprint = DownloadManager.mediaFingerprint({
      id: options.trackId,
      url: options.url,
      title: options.title,
      artist: options.artist
    });
    const expectedBase = DownloadManager.buildExpectedBasename(options.artist, options.title);

    const tryPath = (
      filePath: string | undefined,
      location: ExistingLocalMedia['location'],
      matchedBy: ExistingLocalMedia['matchedBy']
    ): ExistingLocalMedia | null => {
      if (!filePath) return null;
      try {
        const resolved = path.resolve(filePath);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
          return {
            localFilePath: resolved,
            uri: `karaoke://local/${encodeURIComponent(resolved)}`,
            location,
            matchedBy
          };
        }
      } catch {
        // ignore inaccessible paths
      }
      return null;
    };

    for (const track of options.catalogTracks || []) {
      if (!track?.localFilePath) continue;
      if (ytId && (track.id === ytId || track.id?.includes(ytId) || track.uri?.includes(ytId))) {
        const hit = tryPath(track.localFilePath, 'database', 'id');
        if (hit) return hit;
      }
      if (
        options.title &&
        options.artist &&
        track.title?.trim().toLowerCase() === options.title.trim().toLowerCase() &&
        track.artist?.trim().toLowerCase() === options.artist.trim().toLowerCase()
      ) {
        const hit = tryPath(track.localFilePath, 'database', 'filename');
        if (hit) return hit;
      }
    }

    if (options.libraryPath) {
      const libHit = this.scanDirectoryForMatch(options.libraryPath, {
        ytId,
        fingerprint,
        expectedBase
      });
      if (libHit) {
        return {
          localFilePath: libHit.localFilePath,
          uri: `karaoke://local/${encodeURIComponent(libHit.localFilePath)}`,
          location: 'library',
          matchedBy: libHit.matchedBy
        };
      }
    }

    const cacheHit = this.scanDirectoryForMatch(this.queueCacheDir, {
      ytId,
      fingerprint,
      expectedBase
    });
    if (cacheHit) {
      return {
        localFilePath: cacheHit.localFilePath,
        uri: `karaoke://local/${encodeURIComponent(cacheHit.localFilePath)}`,
        location: 'queue_cache',
        matchedBy: cacheHit.matchedBy
      };
    }

    return null;
  }

  private scanDirectoryForMatch(
    directory: string,
    keys: { ytId: string | null; fingerprint: string; expectedBase: string | null }
  ): { localFilePath: string; matchedBy: ExistingLocalMedia['matchedBy'] } | null {
    try {
      if (!directory || !fs.existsSync(directory)) return null;
      const entries = fs.readdirSync(directory, { withFileTypes: true });
      const expectedLower = keys.expectedBase?.toLowerCase() || null;
      const fpToken = keys.fingerprint.startsWith('yt:')
        ? keys.fingerprint.slice(3)
        : keys.fingerprint.slice(0, 12);

      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!MEDIA_EXTENSIONS.has(ext)) continue;
        const fullPath = path.join(directory, entry.name);
        const nameLower = entry.name.toLowerCase();
        const baseLower = path.basename(entry.name, ext).toLowerCase();

        if (keys.ytId && nameLower.includes(keys.ytId.toLowerCase())) {
          return { localFilePath: path.resolve(fullPath), matchedBy: 'id' };
        }
        if (fpToken && nameLower.includes(fpToken.toLowerCase())) {
          return { localFilePath: path.resolve(fullPath), matchedBy: 'hash' };
        }
        if (expectedLower && (baseLower === expectedLower || baseLower.endsWith(expectedLower))) {
          return { localFilePath: path.resolve(fullPath), matchedBy: 'filename' };
        }
        if (expectedLower && baseLower.includes(expectedLower)) {
          return { localFilePath: path.resolve(fullPath), matchedBy: 'filename' };
        }
      }
    } catch (err) {
      console.warn('Failed scanning directory for existing media:', directory, err);
    }
    return null;
  }

  /**
   * Starts a download, or immediately reuses an existing local file when dedup finds a match.
   */
  public async startDownload(options: DownloadOptions): Promise<StartDownloadResult> {
    this.ytdlpPath = resolveYtDlpPath();
    this.ffmpegPath = resolveFfmpegPath();

    const existing = this.findExistingLocalMedia({
      url: options.url,
      trackId: options.trackId,
      title: options.titleHint,
      artist: options.artistHint,
      libraryPath: options.libraryPath,
      catalogTracks: options.catalogTracks
    });

    if (existing) {
      const downloadId = `dl_reuse_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const payload: DownloadProgressPayload = {
        downloadId,
        percent: 100,
        speed: '0 KiB/s',
        eta: '00:00',
        downloadedBytes: 0,
        totalBytes: 0,
        status: 'completed',
        outputFilePath: existing.localFilePath,
        alreadyExists: true,
        existingLocation: existing.location
      };
      this.emitProgress(payload);
      return {
        downloadId,
        alreadyExists: true,
        localFilePath: existing.localFilePath,
        uri: existing.uri,
        location: existing.location
      };
    }

    const existingDownloadId = this.activeUrls.get(options.url);
    if (existingDownloadId && this.activeProcesses.has(existingDownloadId)) {
      const active = this.activeProcesses.get(existingDownloadId);
      if (active) this.emitProgress({ ...active.payload });
      return { downloadId: existingDownloadId, alreadyExists: false };
    }

    const downloadId = `dl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    this.activeUrls.set(options.url, downloadId);
    const outputTemplate = path.join(this.tempDir, `${downloadId}.%(ext)s`);

    const payload: DownloadProgressPayload = {
      downloadId,
      percent: 0,
      speed: '0 KiB/s',
      eta: '--:--',
      downloadedBytes: 0,
      totalBytes: 0,
      status: 'downloading'
    };
    this.emitProgress(payload);

    const args: string[] = [
      options.url,
      '--ffmpeg-location',
      this.ffmpegPath,
      '--newline',
      '--no-playlist',
      '--no-mtime',
      '-o',
      outputTemplate,
      '--progress-template',
      'download:[%(progress.status)s] %(progress._percent_str)s of %(progress._total_bytes_str)s at %(progress._speed_str)s ETA %(progress._eta_str)s'
    ];

    if (options.isAudioOnly) {
      args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
    } else {
      args.push(
        '-f',
        'bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--merge-output-format',
        'mp4'
      );
    }

    const child = spawn(this.ytdlpPath, args, {
      cwd: this.tempDir,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.activeProcesses.set(downloadId, { process: child, payload, url: options.url });

    let detectedOutputFile: string | null = null;

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;

        if (line.includes('[download] Destination:') || line.includes('[Merger] Merging formats into')) {
          const match = line.match(/(?:Destination: |Merging formats into ")([^"]+)/);
          if (match?.[1]) detectedOutputFile = match[1].trim();
        }

        if (line.startsWith('download:[download]')) {
          const percentMatch = line.match(/([0-9.]+)%/);
          const speedMatch = line.match(/at\s+([^\s]+)/);
          const etaMatch = line.match(/ETA\s+([0-9:]+)/);
          if (percentMatch) payload.percent = parseFloat(percentMatch[1]);
          if (speedMatch) payload.speed = speedMatch[1];
          if (etaMatch) payload.eta = etaMatch[1];
          payload.status = 'downloading';
          this.emitProgress({ ...payload });
        } else if (line.includes('[ExtractAudio]') || line.includes('[ffmpeg]')) {
          payload.status = 'converting';
          this.emitProgress({ ...payload });
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      console.warn(`[yt-dlp stderr ${downloadId}]: ${chunk.toString('utf8')}`);
    });

    child.on('close', (code: number | null) => {
      this.activeProcesses.delete(downloadId);
      this.activeUrls.delete(options.url);

      if (code === 0) {
        if (!detectedOutputFile || !fs.existsSync(detectedOutputFile)) {
          const found = fs.readdirSync(this.tempDir).find((f) => f.startsWith(downloadId));
          if (found) detectedOutputFile = path.join(this.tempDir, found);
        }
        payload.status = 'completed';
        payload.percent = 100;
        payload.eta = '00:00';
        payload.outputFilePath = detectedOutputFile || undefined;
        this.emitProgress({ ...payload });
      } else if (payload.status !== 'cancelled') {
        payload.status = 'error';
        payload.errorMessage = `yt-dlp exited with error code ${code}`;
        this.emitProgress({ ...payload });
      }
    });

    child.on('error', (err: Error) => {
      this.activeProcesses.delete(downloadId);
      this.activeUrls.delete(options.url);
      payload.status = 'error';
      payload.errorMessage = err.message;
      this.emitProgress({ ...payload });
    });

    return { downloadId, alreadyExists: false };
  }

  public cancelDownload(downloadId: string): boolean {
    const active = this.activeProcesses.get(downloadId);
    if (!active) return false;

    active.payload.status = 'cancelled';
    active.payload.errorMessage = 'Download cancelled by user';
    this.emitProgress({ ...active.payload });

    active.process.kill('SIGTERM');
    this.activeProcesses.delete(downloadId);
    this.activeUrls.delete(active.url);

    try {
      for (const file of fs.readdirSync(this.tempDir)) {
        if (file.startsWith(downloadId)) {
          fs.unlinkSync(path.join(this.tempDir, file));
        }
      }
    } catch (err) {
      console.warn('Failed to clean partial download files:', err);
    }

    return true;
  }

  public async saveToLibrary(
    tempFilePath: string,
    targetLibraryDirectory: string,
    trackMetadata: { title: string; artist: string; durationSec: number; trackId?: string }
  ): Promise<KaraokeMediaTrack> {
    if (!targetLibraryDirectory?.trim()) {
      throw new Error('Library path is not configured');
    }
    if (!fs.existsSync(tempFilePath)) {
      throw new Error(`Temp file not found: ${tempFilePath}`);
    }
    if (!fs.existsSync(targetLibraryDirectory)) {
      fs.mkdirSync(targetLibraryDirectory, { recursive: true });
    }

    const ext = path.extname(tempFilePath);
    const sanitizedTitle = DownloadManager.sanitizeFilenamePart(trackMetadata.title);
    const sanitizedArtist = DownloadManager.sanitizeFilenamePart(trackMetadata.artist);
    const ytId = DownloadManager.extractYouTubeId(trackMetadata.trackId);
    const idToken = ytId ? `${ytId}_` : '';
    const finalFileName = `${idToken}${sanitizedArtist} - ${sanitizedTitle}${ext}`;
    const destinationPath = path.join(targetLibraryDirectory, finalFileName);

    if (fs.existsSync(destinationPath) && path.resolve(tempFilePath) !== path.resolve(destinationPath)) {
      // Prefer existing permanent file; drop temp/cache source when promoting
      try {
        if (tempFilePath.includes('queue_cache') || tempFilePath.includes(this.tempDir)) {
          await fs.promises.unlink(tempFilePath);
        }
      } catch {
        // ignore
      }
    } else if (path.resolve(tempFilePath) !== path.resolve(destinationPath)) {
      try {
        await fs.promises.rename(tempFilePath, destinationPath);
      } catch {
        await fs.promises.copyFile(tempFilePath, destinationPath);
        await fs.promises.unlink(tempFilePath);
      }
    }

    return {
      id: trackMetadata.trackId || `track_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      source: 'local_library',
      title: trackMetadata.title,
      artist: trackMetadata.artist,
      durationSec: trackMetadata.durationSec || 0,
      uri: `karaoke://local/${encodeURIComponent(destinationPath)}`,
      localFilePath: destinationPath,
      hasEmbeddedLyrics: false,
      isMultiplex: false,
      isEmbeddable: true
    };
  }

  public async saveToQueueCache(
    tempFilePath: string,
    trackMetadata: { title: string; artist: string; durationSec: number; trackId?: string }
  ): Promise<{ localFilePath: string; uri: string }> {
    if (!fs.existsSync(tempFilePath)) {
      throw new Error(`Temp file not found: ${tempFilePath}`);
    }
    if (!fs.existsSync(this.queueCacheDir)) {
      fs.mkdirSync(this.queueCacheDir, { recursive: true });
    }

    const ext = path.extname(tempFilePath);
    const sanitizedTitle = DownloadManager.sanitizeFilenamePart(trackMetadata.title);
    const sanitizedArtist = DownloadManager.sanitizeFilenamePart(trackMetadata.artist);
    const ytId = DownloadManager.extractYouTubeId(trackMetadata.trackId);
    const idToken = ytId || DownloadManager.mediaFingerprint({
      id: trackMetadata.trackId,
      title: trackMetadata.title,
      artist: trackMetadata.artist
    }).slice(0, 12);
    const cacheFileName = `qc_${idToken}_${sanitizedArtist} - ${sanitizedTitle}${ext}`;
    const destinationPath = path.join(this.queueCacheDir, cacheFileName);

    if (fs.existsSync(destinationPath) && path.resolve(tempFilePath) !== path.resolve(destinationPath)) {
      try {
        await fs.promises.unlink(tempFilePath);
      } catch {
        // ignore
      }
    } else if (path.resolve(tempFilePath) !== path.resolve(destinationPath)) {
      try {
        await fs.promises.rename(tempFilePath, destinationPath);
      } catch {
        await fs.promises.copyFile(tempFilePath, destinationPath);
        try {
          await fs.promises.unlink(tempFilePath);
        } catch {
          // ignore
        }
      }
    }

    return {
      localFilePath: destinationPath,
      uri: `karaoke://local/${encodeURIComponent(destinationPath)}`
    };
  }

  public async deleteCachedFile(filePath: string): Promise<{ success: boolean }> {
    if (!filePath || typeof filePath !== 'string') return { success: false };

    try {
      const resolvedPath = path.resolve(filePath);
      const resolvedCache = path.resolve(this.queueCacheDir);
      const resolvedTemp = path.resolve(this.tempDir);
      const isInCache = resolvedPath.startsWith(resolvedCache + path.sep);
      const isInTemp = resolvedPath.startsWith(resolvedTemp + path.sep);

      if (!isInCache && !isInTemp) {
        console.warn('Security guard: Refused deletion of file outside queue_cache/temp:', filePath);
        return { success: false };
      }

      if (fs.existsSync(resolvedPath)) {
        await fs.promises.unlink(resolvedPath);
        return { success: true };
      }
    } catch (err) {
      console.warn('Failed to delete cached file:', filePath, err);
    }
    return { success: false };
  }

  public async cleanupUnreferencedCache(activeFilePaths: string[]): Promise<{ deletedCount: number }> {
    let deletedCount = 0;
    try {
      if (!fs.existsSync(this.queueCacheDir)) return { deletedCount: 0 };

      const activeNormalized = new Set(
        activeFilePaths.filter(Boolean).map((p) => path.resolve(p).toLowerCase())
      );

      const files = await fs.promises.readdir(this.queueCacheDir);
      for (const file of files) {
        const fullPath = path.join(this.queueCacheDir, file);
        if (!activeNormalized.has(path.resolve(fullPath).toLowerCase())) {
          try {
            await fs.promises.unlink(fullPath);
            deletedCount++;
          } catch (delErr) {
            console.warn('Failed to delete orphaned queue cache file:', fullPath, delErr);
          }
        }
      }
    } catch (err) {
      console.warn('Failed to cleanup unreferenced cache:', err);
    }
    return { deletedCount };
  }

  public cleanupTempFiles(): void {
    try {
      for (const file of fs.readdirSync(this.tempDir)) {
        fs.unlinkSync(path.join(this.tempDir, file));
      }
    } catch (err) {
      console.warn('Failed to cleanup temp directory:', err);
    }
  }
}
