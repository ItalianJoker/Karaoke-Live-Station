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
  private ffmpegPath: string;
  private ytdlpPath: string;
  private activeProcesses: Map<string, { process: ChildProcess; payload: DownloadProgressPayload; url: string }> = new Map();
  private activeUrls: Map<string, string> = new Map(); // url -> downloadId
  private progressListeners: Set<DownloadProgressCallback> = new Set();

  /**
   * Initializes the DownloadManager with a working temporary directory.
   *
   * @param tempDir - Absolute path to folder used for in-progress downloads
   */
  constructor(tempDir: string) {
    this.tempDir = tempDir;
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
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
    const sanitizedTitle = trackMetadata.title.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sanitizedArtist = trackMetadata.artist.replace(/[^a-zA-Z0-9_-]/g, '_');
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
