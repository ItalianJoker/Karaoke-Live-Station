import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { DownloadProgressPayload, KaraokeMediaTrack } from '../../shared/types';
import { resolveFfmpegPath, resolveYtDlpPath } from './BinaryResolver';

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
}

/**
 * Callback function listening for live download progress updates.
 */
export type DownloadProgressCallback = (payload: DownloadProgressPayload) => void;

/**
 * Background Download Manager wrapping yt-dlp child processes.
 * Handles progress parsing, audio conversion via ffmpeg, download cancellation,
 * and moving files to the local karaoke library.
 */
export class DownloadManager {
  private tempDir: string;
  private queueCacheDir: string;
  private ffmpegPath: string;
  private ytdlpPath: string;
  private activeProcesses: Map<string, { process: ChildProcess; payload: DownloadProgressPayload; url: string }> = new Map();
  private activeUrls: Map<string, string> = new Map(); // url -> downloadId
  private progressListeners: Set<DownloadProgressCallback> = new Set();

  /**
   * Initializes the DownloadManager with working temporary and persistent queue cache directories.
   *
   * @param tempDir - Absolute path to folder used for in-progress downloads
   * @param queueCacheDir - Optional absolute path to folder used for persistent queued tracks
   */
  constructor(tempDir: string, queueCacheDir?: string) {
    this.tempDir = tempDir;
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    this.queueCacheDir = queueCacheDir || path.join(path.dirname(this.tempDir), 'queue_cache');
    if (!fs.existsSync(this.queueCacheDir)) {
      fs.mkdirSync(this.queueCacheDir, { recursive: true });
    }

    // Resolve ffmpeg and yt-dlp binary paths (bundled or system PATH fallback)
    this.ffmpegPath = resolveFfmpegPath();
    this.ytdlpPath = resolveYtDlpPath();
  }

  /**
   * Subscribes a listener to download progress events.
   *
   * @returns Unsubscribe cleanup function
   */
  public subscribeProgress(cb: DownloadProgressCallback): () => void {
    this.progressListeners.add(cb);
    return () => {
      this.progressListeners.delete(cb);
    };
  }

  /**
   * Broadcasts a progress payload to all registered listeners.
   */
  private emitProgress(payload: DownloadProgressPayload): void {
    for (const listener of this.progressListeners) {
      try {
        listener(payload);
      } catch (err) {
        console.error('Error in progress listener:', err);
      }
    }
  }

  /**
   * Spawns a background yt-dlp child process to download and optionally transcode audio.
   *
   * @param options - Download settings including URL and format constraints
   * @returns Generated download task ID
   */
  public async startDownload(options: DownloadOptions): Promise<string> {
    // Dynamically refresh binary paths to immediately use updated executables
    this.ytdlpPath = resolveYtDlpPath();
    this.ffmpegPath = resolveFfmpegPath();

    // If there is already an active download for this exact URL, reuse it to prevent duplicates
    const existingDownloadId = this.activeUrls.get(options.url);
    if (existingDownloadId && this.activeProcesses.has(existingDownloadId)) {
      const active = this.activeProcesses.get(existingDownloadId);
      if (active) {
        this.emitProgress({ ...active.payload });
      }
      return existingDownloadId;
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
      '--ffmpeg-location', this.ffmpegPath,
      '--newline',
      '--no-playlist',
      '--no-mtime',
      '-o', outputTemplate,
      '--progress-template',
      'download:[%(progress.status)s] %(progress._percent_str)s of %(progress._total_bytes_str)s at %(progress._speed_str)s ETA %(progress._eta_str)s'
    ];

    if (options.isAudioOnly) {
      args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
    } else {
      args.push(
        '-f', 'bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--merge-output-format', 'mp4'
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
      const lines = text.split(/\r?\n/);

      for (const line of lines) {
        if (!line.trim()) continue;

        // Extract destination output file
        if (line.includes('[download] Destination:') || line.includes('[Merger] Merging formats into')) {
          const match = line.match(/(?:Destination: |Merging formats into ")([^"]+)/);
          if (match && match[1]) {
            detectedOutputFile = match[1].trim();
          }
        }

        // Parse custom progress line
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
      const errStr = chunk.toString('utf8');
      console.warn(`[yt-dlp stderr ${downloadId}]: ${errStr}`);
    });

    child.on('close', (code: number | null) => {
      this.activeProcesses.delete(downloadId);
      this.activeUrls.delete(options.url);

      if (code === 0) {
        // If detectedOutputFile was not matched, find file starting with downloadId in temp
        if (!detectedOutputFile || !fs.existsSync(detectedOutputFile)) {
          const found = fs.readdirSync(this.tempDir).find(f => f.startsWith(downloadId));
          if (found) {
            detectedOutputFile = path.join(this.tempDir, found);
          }
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

    return downloadId;
  }

  /**
   * Cancels an ongoing download process and deletes temporary partial files.
   *
   * @param downloadId - Task ID to cancel
   * @returns True if successfully cancelled
   */
  public cancelDownload(downloadId: string): boolean {
    const active = this.activeProcesses.get(downloadId);
    if (!active) return false;

    active.payload.status = 'cancelled';
    active.payload.errorMessage = 'Download cancelled by user';
    this.emitProgress({ ...active.payload });

    active.process.kill('SIGTERM');
    this.activeProcesses.delete(downloadId);
    this.activeUrls.delete(active.url);

    // Clean up partial files
    try {
      const files = fs.readdirSync(this.tempDir);
      for (const file of files) {
        if (file.startsWith(downloadId)) {
          fs.unlinkSync(path.join(this.tempDir, file));
        }
      }
    } catch (err) {
      console.warn('Failed to clean partial download files:', err);
    }

    return true;
  }

  /**
   * Moves a completed download file to the user's permanent karaoke library directory.
   *
   * @param tempFilePath - Downloaded media file path in temp directory
   * @param targetLibraryDirectory - Permanent library directory
   * @param trackMetadata - Song title, artist, and duration
   * @returns Persisted KaraokeMediaTrack
   */
  /**
   * Sanitizes a string for safe filesystem usage across Windows, macOS, and Linux.
   * Preserves accented characters (à, è, é, ì, ò, ù, ñ, etc.), spaces, and hyphens,
   * while stripping filesystem-reserved characters (/\?%*:|"<>).
   *
   * @param name - Raw track title or artist string
   * @returns Clean, valid filename component
   */
  public static sanitizeFilenamePart(name: string): string {
    return (name || '')
      .replace(/[/\\?%*:|"<>]/g, '')
      .replace(/[\x00-\x1f\x7f]/g, '')
      .trim() || 'Unknown';
  }

  public async saveToLibrary(
    tempFilePath: string,
    targetLibraryDirectory: string,
    trackMetadata: { title: string; artist: string; durationSec: number }
  ): Promise<KaraokeMediaTrack> {
    if (!fs.existsSync(tempFilePath)) {
      throw new Error(`Temp file not found: ${tempFilePath}`);
    }

    if (!fs.existsSync(targetLibraryDirectory)) {
      fs.mkdirSync(targetLibraryDirectory, { recursive: true });
    }

    const ext = path.extname(tempFilePath);
    const sanitizedTitle = DownloadManager.sanitizeFilenamePart(trackMetadata.title);
    const sanitizedArtist = DownloadManager.sanitizeFilenamePart(trackMetadata.artist);
    const finalFileName = `${sanitizedArtist} - ${sanitizedTitle}${ext}`;
    const destinationPath = path.join(targetLibraryDirectory, finalFileName);

    // Move file atomically or copy & delete
    try {
      await fs.promises.rename(tempFilePath, destinationPath);
    } catch {
      await fs.promises.copyFile(tempFilePath, destinationPath);
      await fs.promises.unlink(tempFilePath);
    }

    const track: KaraokeMediaTrack = {
      id: `track_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
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

    return track;
  }

  /**
   * Moves a downloaded media file to the dedicated persistent queue cache directory.
   * Unlike temp files, queue cache files persist across app restarts until the track is dequeued.
   *
   * @param tempFilePath - Downloaded file path in temp directory
   * @param trackMetadata - Song title, artist, and duration
   * @returns Local filesystem destination path and karaoke://local/ URI
   */
  public async saveToQueueCache(
    tempFilePath: string,
    trackMetadata: { title: string; artist: string; durationSec: number }
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
    const cacheFileName = `qc_${Date.now()}_${sanitizedArtist} - ${sanitizedTitle}${ext}`;
    const destinationPath = path.join(this.queueCacheDir, cacheFileName);

    try {
      await fs.promises.rename(tempFilePath, destinationPath);
    } catch {
      await fs.promises.copyFile(tempFilePath, destinationPath);
      try {
        await fs.promises.unlink(tempFilePath);
      } catch {}
    }

    return {
      localFilePath: destinationPath,
      uri: `karaoke://local/${encodeURIComponent(destinationPath)}`
    };
  }

  /**
   * Safely deletes a cached media file if and only if it resides within
   * the persistent queue cache directory or temporary download directory.
   * Prevents deletion of user files outside managed cache folders.
   *
   * @param filePath - Absolute path to cached media file
   * @returns Success boolean
   */
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

  /**
   * Scans the persistent queue cache directory and removes any orphaned media files
   * that are no longer referenced in the active playback queue.
   *
   * @param activeFilePaths - Array of file paths currently referenced in the queue
   * @returns Number of orphaned files pruned
   */
  public async cleanupUnreferencedCache(activeFilePaths: string[]): Promise<{ deletedCount: number }> {
    let deletedCount = 0;
    try {
      if (!fs.existsSync(this.queueCacheDir)) return { deletedCount: 0 };

      const activeNormalized = new Set(
        activeFilePaths
          .filter(Boolean)
          .map((p) => path.resolve(p).toLowerCase())
      );

      const files = await fs.promises.readdir(this.queueCacheDir);
      for (const file of files) {
        const fullPath = path.join(this.queueCacheDir, file);
        const resolved = path.resolve(fullPath);
        if (!activeNormalized.has(resolved.toLowerCase())) {
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

  /**
   * Purges all residual files in the temporary download directory.
   */
  public cleanupTempFiles(): void {
    try {
      const files = fs.readdirSync(this.tempDir);
      for (const file of files) {
        fs.unlinkSync(path.join(this.tempDir, file));
      }
    } catch (err) {
      console.warn('Failed to cleanup temp directory:', err);
    }
  }
}
