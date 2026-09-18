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
import {
  findSiblingSubtitle,
  processInstrumentalVideo
} from './InstrumentalProcessor';
import { killProcessTree } from './processKill';
import type { OfflineVocalModelManager } from './OfflineVocalModelManager';
import type { OrtWasmManager } from './OrtWasmManager';
import type { Logger } from './Logger';
import { buildKaraokeLocalUri } from '../../shared/karaokeLocalPath';
import { findMediaMatchInTree } from '../../shared/libraryScanner';
import {
  YTDLP_INSTRUMENTAL_SUB_LANGS,
  buildYtDlpOutputTemplate,
  isYtDlpTransientMediaName,
  parseYtDlpOutputPath,
  resolveDownloadedMediaPath as resolveDownloadedMediaInTemp,
  resolvePathAgainstTempDir
} from './downloadStaging';

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

// Re-export staging helpers for tests / diagnostics
export {
  YTDLP_INSTRUMENTAL_SUB_LANGS,
  buildYtDlpOutputTemplate,
  isYtDlpTransientMediaName,
  parseYtDlpOutputPath,
  resolvePathAgainstTempDir
};
export { resolveDownloadedMediaInTemp as resolveDownloadedMediaPath };

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
  /**
   * When true: after download, demux audio, apply vocal removal (AI or algorithmic),
   * remux video with instrumental audio (optional lyric burn-in), then complete.
   */
  instrumental?: boolean;
  /** Vocal-remover method for instrumental post-process (AI or algorithmic) */
  vocalRemoverAlgorithm?: string;
  /** MDX-only advanced knobs — omit for non-MDX methods */
  mdxSegmentSize?: number;
  mdxOverlap?: number;
  mdxEnableOrt?: boolean;
}

/**
 * Callback function listening for live download progress updates.
 */
export type DownloadProgressCallback = (payload: DownloadProgressPayload) => void;

type PendingDownloadJob = {
  downloadId: string;
  options: DownloadOptions;
  payload: DownloadProgressPayload;
  dedupUrlKey: string;
};

/**
 * Tracks a download for its full lifetime — including instrumental post-process
 * after yt-dlp exits — so cancel works from the Download menu at any phase.
 */
type ActiveDownloadJob = {
  /** yt-dlp child while downloading; null during instrumental conversion. */
  process: ChildProcess | null;
  payload: DownloadProgressPayload;
  url: string;
  abortController: AbortController;
};

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
  private activeJobs: Map<string, ActiveDownloadJob> = new Map();
  private activeUrls: Map<string, string> = new Map();
  private progressListeners: Set<DownloadProgressCallback> = new Set();
  /** Shared pool limit for normal + instrumental yt-dlp children. */
  private maxSimultaneousDownloads = 2;
  private pendingQueue: PendingDownloadJob[] = [];
  private vocalModelManager?: OfflineVocalModelManager;
  private ortWasmManager?: OrtWasmManager;
  private logger?: Logger;

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

  public setMaxSimultaneousDownloads(n: number): void {
    const clamped = Math.max(1, Math.min(8, Math.floor(Number(n)) || 1));
    this.maxSimultaneousDownloads = clamped;
    this.pumpQueue();
  }

  public setInstrumentalAiDeps(deps: {
    vocalModelManager: OfflineVocalModelManager;
    ortWasmManager: OrtWasmManager;
    logger: Logger;
  }): void {
    this.vocalModelManager = deps.vocalModelManager;
    this.ortWasmManager = deps.ortWasmManager;
    this.logger = deps.logger;
  }

  /**
   * Staging directory for yt-dlp originals and instrumental remuxes before
   * library/queue promotion. Always under Electron userData (AppImage-safe),
   * never the user library folder and never OS /tmp as the durable home.
   */
  public getTempDir(): string {
    return this.tempDir;
  }

  /**
   * Resolve a yt-dlp-reported path against {@link tempDir} when relative
   * (Electron main cwd is not the download folder).
   */
  private resolvePathAgainstTemp(candidate: string | null | undefined): string | null {
    return resolvePathAgainstTempDir(this.tempDir, candidate);
  }

  /**
   * Pick the final muxed media for a downloadId after yt-dlp exits.
   * Prefers a non-transient hint when it exists; otherwise scans tempDir for
   * `${downloadId}.ext` media, ignoring fragments / .part / sidecars.
   */
  public resolveDownloadedMediaPath(
    downloadId: string,
    detectedHint?: string | null
  ): string | null {
    return resolveDownloadedMediaInTemp(this.tempDir, downloadId, detectedHint);
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

  /**
   * Persist a download failure to the structured logger (disk), not only the UI panel.
   * Always ERROR; when log level is `debug`, attach argv / recent yt-dlp output.
   */
  private logDownloadFailure(
    message: string,
    data: Record<string, unknown>,
    debugExtras?: Record<string, unknown>
  ): void {
    const payload: Record<string, unknown> = { ...data };
    if (this.logger?.getLogLevel() === 'debug' && debugExtras) {
      Object.assign(payload, debugExtras);
    }
    this.logger?.error('DownloadManager', message, payload);
  }

  /** Count of active yt-dlp children (instrumental conversion does not hold a pool slot). */
  private getRunningCount(): number {
    let count = 0;
    for (const entry of this.activeJobs.values()) {
      if (entry.process && entry.payload.status !== 'queued') count++;
    }
    return count;
  }

  /** Starts the next pending job(s) while slots remain under the shared pool limit. */
  private pumpQueue(): void {
    while (this.getRunningCount() < this.maxSimultaneousDownloads && this.pendingQueue.length > 0) {
      const next = this.pendingQueue.shift();
      if (!next) break;
      if (next.payload.status === 'cancelled') continue;
      next.payload.status = 'downloading';
      next.payload.percent = 0;
      this.emitProgress({ ...next.payload });
      this.launchDownload(next.downloadId, next.options, next.payload, next.dedupUrlKey);
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
   *
   * Why this runs before any network I/O: live karaoke nights re-request the same
   * YouTube karaoke frequently. Dedup against library + queue_cache prevents duplicate
   * multi-hundred-MB files and keeps preview/cover URIs stable when re-queueing.
   * Directory scans are last-resort after the in-memory catalogTracks list misses,
   * so the common path is O(n catalog) with cheap string compares, not disk thrash.
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
            uri: buildKaraokeLocalUri(resolved),
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
          uri: buildKaraokeLocalUri(libHit.localFilePath),
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
        uri: buildKaraokeLocalUri(cacheHit.localFilePath),
        location: 'queue_cache',
        matchedBy: cacheHit.matchedBy
      };
    }

    return null;
  }

  /**
   * Recursive match under a library / cache root so media in relative subfolders
   * is found the same way as top-level files (avoids re-download / double catalog).
   */
  private scanDirectoryForMatch(
    directory: string,
    keys: { ytId: string | null; fingerprint: string; expectedBase: string | null }
  ): { localFilePath: string; matchedBy: ExistingLocalMedia['matchedBy'] } | null {
    return findMediaMatchInTree(directory, keys, MEDIA_EXTENSIONS);
  }

  /**
   * Starts a download, or immediately reuses an existing local file when dedup finds a match.
   * Excess jobs beyond {@link maxSimultaneousDownloads} are queued until a yt-dlp slot frees.
   */
  public async startDownload(options: DownloadOptions): Promise<StartDownloadResult> {
    this.ytdlpPath = resolveYtDlpPath();
    this.ffmpegPath = resolveFfmpegPath();

    const instrumental = options.instrumental === true;
    // Instrumental library entries use a distinct title so they do not collide with
    // a normal karaoke download of the same YouTube id.
    const effectiveTitle = instrumental
      ? this.ensureInstrumentalTitle(options.titleHint || 'Unknown')
      : options.titleHint;
    const dedupUrlKey = instrumental ? `${options.url}::instrumental` : options.url;

    const catalogForDedup = instrumental
      ? (options.catalogTracks || []).filter(
          (t) =>
            /instrumental/i.test(t.title || '') || /instrumental/i.test(t.localFilePath || '')
        )
      : options.catalogTracks;

    const existing = this.findExistingLocalMedia({
      url: options.url,
      trackId: options.trackId,
      title: effectiveTitle,
      artist: options.artistHint,
      libraryPath: options.libraryPath,
      catalogTracks: catalogForDedup
    });

    const existingUsable =
      existing &&
      (!instrumental ||
        /instrumental/i.test(existing.localFilePath) ||
        /instrumental/i.test(path.basename(existing.localFilePath)))
        ? existing
        : null;

    if (existingUsable) {
      const downloadId = `dl_reuse_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const payload: DownloadProgressPayload = {
        downloadId,
        percent: 100,
        speed: '0 KiB/s',
        eta: '00:00',
        downloadedBytes: 0,
        totalBytes: 0,
        status: 'completed',
        outputFilePath: existingUsable.localFilePath,
        alreadyExists: true,
        existingLocation: existingUsable.location,
        instrumental,
        titleHint: effectiveTitle
      };
      this.emitProgress(payload);
      return {
        downloadId,
        alreadyExists: true,
        localFilePath: existingUsable.localFilePath,
        uri: existingUsable.uri,
        location: existingUsable.location
      };
    }

    const existingDownloadId = this.activeUrls.get(dedupUrlKey);
    if (existingDownloadId) {
      const active = this.activeJobs.get(existingDownloadId);
      if (active) {
        this.emitProgress({ ...active.payload });
        return { downloadId: existingDownloadId, alreadyExists: false };
      }
      const pending = this.pendingQueue.find((job) => job.downloadId === existingDownloadId);
      if (pending) {
        this.emitProgress({ ...pending.payload });
        return { downloadId: existingDownloadId, alreadyExists: false };
      }
    }

    const downloadId = `dl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    this.activeUrls.set(dedupUrlKey, downloadId);

    const payload: DownloadProgressPayload = {
      downloadId,
      percent: 0,
      speed: '',
      eta: '--:--',
      downloadedBytes: 0,
      totalBytes: 0,
      status: 'downloading',
      instrumental,
      titleHint: effectiveTitle
    };

    const launchOptions: DownloadOptions = {
      ...options,
      titleHint: effectiveTitle
    };

    if (this.getRunningCount() >= this.maxSimultaneousDownloads) {
      payload.status = 'queued';
      this.pendingQueue.push({
        downloadId,
        options: launchOptions,
        payload,
        dedupUrlKey
      });
      this.emitProgress({ ...payload });
      return { downloadId, alreadyExists: false };
    }

    this.emitProgress(payload);
    this.launchDownload(downloadId, launchOptions, payload, dedupUrlKey);
    return { downloadId, alreadyExists: false };
  }

  /**
   * Spawns yt-dlp for a download that already owns a pool slot (or was just dequeued).
   */
  private launchDownload(
    downloadId: string,
    options: DownloadOptions,
    payload: DownloadProgressPayload,
    dedupUrlKey: string
  ): void {
    const instrumental = options.instrumental === true;
    // Relative -o + cwd=tempDir (same staging files as absolute join). Avoids
    // Windows drive-letter / TYPES: colon edge cases on absolute -o paths.
    const outputTemplate = buildYtDlpOutputTemplate(downloadId);

    const args: string[] = [
      options.url,
      '--ffmpeg-location',
      this.ffmpegPath,
      // Force progress when stdout/stderr are pipes (non-TTY Electron spawn)
      '--progress',
      '--newline',
      '--no-playlist',
      '--no-mtime',
      '-o',
      outputTemplate,
      // yt-dlp treats `download:` as the template TYPE key, not output text.
      // Literal marker `KLSPROG|` must be inside the template body so lines match.
      '--progress-template',
      'download:KLSPROG|%(progress.status)s|%(progress._percent_str)s|%(progress.speed)s|%(progress.eta)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s'
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

    // Best-effort auto-subs for optional lyric burn-in on instrumental remux.
    // --sub-langs tokens are Python regexes; a leading "*" quantifier is invalid.
    if (instrumental && !options.isAudioOnly) {
      args.push(
        '--write-auto-sub',
        '--sub-langs',
        YTDLP_INSTRUMENTAL_SUB_LANGS,
        '--convert-subs',
        'srt'
      );
    }

    const child = spawn(this.ytdlpPath, args, {
      cwd: this.tempDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group on Unix so cancel can SIGKILL yt-dlp + nested ffmpeg.
      detached: process.platform !== 'win32'
    });

    this.logger?.debug('DownloadManager', 'Spawning yt-dlp', {
      downloadId,
      instrumental,
      isAudioOnly: options.isAudioOnly === true,
      ytdlpPath: this.ytdlpPath,
      cwd: this.tempDir,
      args
    });

    const abortController = new AbortController();
    this.activeJobs.set(downloadId, {
      process: child,
      payload,
      url: dedupUrlKey,
      abortController
    });

    let detectedOutputFile: string | null = null;
    // Chunk boundaries can split mid-line — buffer until newline/CR
    let lineBuffer = '';
    /** Set when spawn itself fails (ENOENT/EPERM/…); close must not clobber that message. */
    let spawnFailed = false;
    /** Last yt-dlp `ERROR:` line for opaque non-zero exits (e.g. code 1). */
    let lastYtDlpErrorLine = '';
    /** Recent non-progress yt-dlp lines for debug dumps on failure. */
    const recentYtDlpLines: string[] = [];
    const RECENT_YTDLP_LINE_CAP = 40;

    const debugSpawnExtras = () => ({
      ytdlpPath: this.ytdlpPath,
      cwd: this.tempDir,
      args: [...args],
      recentOutput: [...recentYtDlpLines]
    });

    const ingestYtDlpLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const isProgressTemplate =
        /^KLSPROG\|/i.test(trimmed) ||
        /^download:/i.test(trimmed) ||
        /\[download\]\s+\d/i.test(trimmed);

      if (!isProgressTemplate) {
        recentYtDlpLines.push(trimmed.slice(0, 500));
        if (recentYtDlpLines.length > RECENT_YTDLP_LINE_CAP) {
          recentYtDlpLines.shift();
        }
      }

      if (/^ERROR:/i.test(trimmed) || /\bERROR:\s/i.test(trimmed)) {
        lastYtDlpErrorLine = trimmed.slice(0, 500);
        // Surface yt-dlp ERROR lines to disk even before process exit (UI alone is not enough).
        this.logger?.warn('DownloadManager', lastYtDlpErrorLine, {
          downloadId,
          instrumental
        });
      }

      if (
        trimmed.includes('[download] Destination:') ||
        trimmed.includes('[Merger] Merging formats into') ||
        /Destination:/i.test(trimmed)
      ) {
        const parsed = parseYtDlpOutputPath(trimmed);
        if (parsed) {
          const resolved = this.resolvePathAgainstTemp(parsed);
          if (resolved) detectedOutputFile = resolved;
        }
      }

      // Preferred: structured --progress-template lines
      // Current: KLSPROG|status|percent|speedBps|etaSec|downloaded|total
      // Legacy mistakes: download:status|…  OR bare status|… (TYPE key swallowed)
      const structured =
        trimmed.match(
          /^KLSPROG\|([^|]+)\|([^|]*)\|([^|]*)\|([^|]*)(?:\|([^|]*)\|([^|]*))?$/i
        ) ||
        trimmed.match(
          /^download:([^|]+)\|([^|]*)\|([^|]*)\|([^|]*)(?:\|([^|]*)\|([^|]*))?$/i
        ) ||
        trimmed.match(
          /^(downloading|finished)\|([^|]*)\|([^|]*)\|([^|]*)(?:\|([^|]*)\|([^|]*))?$/i
        );
      if (structured) {
        const progressStatus = structured[1].trim().toLowerCase();
        const percentMatch = structured[2].match(/([0-9.]+)\s*%?/);
        const speedField = structured[3].trim();
        const etaField = structured[4].trim();
        const downloadedField = structured[5]?.trim();
        const totalField = structured[6]?.trim();

        if (percentMatch) {
          const p = parseFloat(percentMatch[1]);
          if (Number.isFinite(p)) payload.percent = Math.max(0, Math.min(100, p));
        }

        const speedNum = parseFloat(speedField);
        if (Number.isFinite(speedNum) && speedNum > 0) {
          payload.speed = DownloadManager.formatBytesPerSecond(speedNum);
        } else {
          payload.speed = DownloadManager.sanitizeDownloadSpeed(speedField);
        }

        const etaSec = parseInt(etaField, 10);
        if (Number.isFinite(etaSec) && etaSec >= 0 && !/^n\/?a$/i.test(etaField)) {
          payload.eta = DownloadManager.formatEtaSeconds(etaSec);
        } else if (/^\d+:\d+/.test(etaField)) {
          payload.eta = etaField.trim();
        } else if (/^(n\/?a|na|none|-|unknown)?$/i.test(etaField)) {
          // Keep prior ETA when yt-dlp reports NA (common at start / finish)
        }

        const downloaded = downloadedField ? parseFloat(downloadedField) : NaN;
        const total = totalField ? parseFloat(totalField) : NaN;
        if (Number.isFinite(downloaded) && downloaded >= 0) {
          payload.downloadedBytes = downloaded;
        }
        if (Number.isFinite(total) && total > 0) {
          payload.totalBytes = total;
        }

        if (progressStatus === 'finished') {
          payload.speed = '';
          payload.percent = 100;
        } else {
          payload.status = 'downloading';
        }
        this.emitProgress({ ...payload });
        return;
      }

      // Fallback: default yt-dlp [download] progress (usually stdout/stderr)
      const isProgress =
        trimmed.startsWith('download:[download]') ||
        /^\[download\]\s+[0-9.]+%/.test(trimmed) ||
        /^download:\[download\]/.test(trimmed);
      if (isProgress) {
        const percentMatch = trimmed.match(/([0-9.]+)\s*%/);
        // Speed sits between "at" and "ETA" — may include spaces ("1.23 MiB/s")
        const speedMatch = trimmed.match(/\bat\s+(.+?)\s+ETA\b/i);
        const etaMatch = trimmed.match(/\bETA\s+([0-9:]+)/i);
        if (percentMatch) {
          const p = parseFloat(percentMatch[1]);
          if (Number.isFinite(p)) payload.percent = Math.max(0, Math.min(100, p));
        }
        if (speedMatch) {
          const raw = speedMatch[1].trim().replace(/\s+/g, ' ');
          payload.speed = DownloadManager.sanitizeDownloadSpeed(raw);
        }
        if (etaMatch) payload.eta = etaMatch[1];
        payload.status = 'downloading';
        this.emitProgress({ ...payload });
        return;
      }

      if (
        /\[ExtractAudio\]/i.test(trimmed) ||
        /\[Merger\]/i.test(trimmed) ||
        /\[ffmpeg\]/i.test(trimmed)
      ) {
        payload.status = 'converting';
        // Mux/convert has no reliable byte speed from yt-dlp — clear stale download speed
        payload.speed = '';
        this.emitProgress({ ...payload });
      }
    };

    const feed = (chunk: Buffer) => {
      lineBuffer += chunk.toString('utf8');
      const parts = lineBuffer.split(/\r\n|\n|\r/);
      lineBuffer = parts.pop() ?? '';
      for (const part of parts) {
        ingestYtDlpLine(part);
      }
    };

    // yt-dlp writes progress to stderr by default; destination/merger may appear on either stream
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);

    child.on('close', (code: number | null) => {
      void (async () => {
        // Spawn `error` already emitted a real OS message (ENOENT/EPERM/…).
        // libuv then delivers close with a negative errno (EPERM → -1); do not
        // replace that with the opaque "yt-dlp exited with error code -1".
        if (spawnFailed) {
          return;
        }

        const job = this.activeJobs.get(downloadId);
        if (job) job.process = null;

        // Cancel already cleaned up and emitted — do not continue post-process.
        if (payload.status === 'cancelled') {
          this.activeJobs.delete(downloadId);
          this.activeUrls.delete(dedupUrlKey);
          this.pumpQueue();
          return;
        }

        // Free the yt-dlp pool slot while instrumental conversion may still run.
        this.pumpQueue();

        if (code === 0) {
          // Always re-resolve against userData/temp: yt-dlp may report relative
          // paths or leave format-fragment Destination lines before Merger.
          detectedOutputFile = this.resolveDownloadedMediaPath(
            downloadId,
            detectedOutputFile
          );

          if (instrumental) {
            if (!detectedOutputFile || !fs.existsSync(detectedOutputFile)) {
              payload.status = 'error';
              payload.errorMessage =
                `Downloaded video not found in staging folder after yt-dlp ` +
                `(expected under ${this.tempDir} for ${downloadId}). ` +
                `Instrumental AI cannot run without the original MP4.`;
              this.logDownloadFailure(
                payload.errorMessage,
                {
                  downloadId,
                  tempDir: this.tempDir,
                  detectedHint: detectedOutputFile,
                  exitCode: code,
                  instrumental: true
                },
                debugSpawnExtras()
              );
              this.emitProgress({ ...payload });
              this.activeJobs.delete(downloadId);
              this.activeUrls.delete(dedupUrlKey);
              return;
            }

            const originalVideoPath = detectedOutputFile;
            const instrumentalOut = path.join(this.tempDir, `${downloadId}.instrumental.mp4`);
            const extractWavPath = path.join(this.tempDir, `${downloadId}.extract.wav`);
            const aiOutputWavPath = path.join(
              this.tempDir,
              `${downloadId}.instrumental.extract.wav`
            );
            const subtitlePath = findSiblingSubtitle(originalVideoPath);

            // Delete only this downloadId's conversion temps (never wipe unrelated temp files).
            const cleanupInstrumentalRunTemps = (keepRemuxArtifact: boolean) => {
              // Only this downloadId's conversion temps — never wipe unrelated files in temp.
              const victims = [
                originalVideoPath,
                extractWavPath,
                aiOutputWavPath,
                `${instrumentalOut}.partial.mp4`,
                // Legacy misnamed sidecars from older builds (safe no-op if absent).
                path.join(this.tempDir, `${downloadId}.instrumental.wav`),
                path.join(this.tempDir, `${downloadId}.instrumental.instrumental.wav`)
              ];
              if (!keepRemuxArtifact) {
                victims.push(instrumentalOut);
              }
              const removed: string[] = [];
              const seen = new Set<string>();
              for (const p of victims) {
                if (!p) continue;
                const resolved = path.resolve(p);
                if (seen.has(resolved)) continue;
                seen.add(resolved);
                try {
                  if (fs.existsSync(resolved)) {
                    fs.unlinkSync(resolved);
                    removed.push(resolved);
                  }
                } catch {
                  /* ignore cleanup races */
                }
              }
              this.logger?.debug('DownloadManager', 'Instrumental run temp cleanup', {
                downloadId,
                keepRemuxArtifact,
                removed,
                extractWavPath,
                aiOutputWavPath,
                sourceMp4: originalVideoPath
              });
            };

            this.logger?.info(
              'DownloadManager',
              `Instrumental staging: original=${originalVideoPath} → remux=${instrumentalOut}`,
              {
                downloadId,
                tempDir: this.tempDir,
                sourceMp4: originalVideoPath,
                extractWav: extractWavPath,
                aiOutputWav: aiOutputWavPath,
                vocalRemoverAlgorithm: options.vocalRemoverAlgorithm || null
              }
            );

            // Conversion bar replaces the download bar (fresh 0→100%) for instrumental only
            payload.status = 'processing';
            payload.percent = 0;
            payload.speed = '';
            payload.eta = '--:--';
            this.emitProgress({ ...payload });

            const signal = job?.abortController.signal;
            const result = await processInstrumentalVideo({
              inputVideoPath: originalVideoPath,
              outputPath: instrumentalOut,
              algorithm: options.vocalRemoverAlgorithm,
              subtitlePath,
              vocalModelManager: this.vocalModelManager,
              ortWasmManager: this.ortWasmManager,
              logger: this.logger,
              signal,
              mdxSegmentSize: options.mdxSegmentSize,
              mdxOverlap: options.mdxOverlap,
              mdxEnableOrt: options.mdxEnableOrt,
              onProgress: (phase, percent) => {
                if (payload.status === 'cancelled') return;
                if (phase === 'ensuring_model') {
                  payload.status = 'downloading_model';
                } else if (phase === 'removing_vocals') {
                  payload.status = 'removing_vocals';
                } else if (phase === 'remuxing') {
                  payload.status = 'remuxing';
                  payload.eta = '--:--';
                } else {
                  payload.status = 'processing';
                }
                // InstrumentalProcessor reports 0–100 within the conversion pipeline
                const p = Number.isFinite(percent) ? percent : 0;
                payload.percent = Math.max(0, Math.min(100, p));
                payload.speed = '';
                this.emitProgress({ ...payload });
              },
              onAiEta: (etaSec) => {
                if (payload.status === 'cancelled') return;
                if (payload.status !== 'removing_vocals') return;
                payload.eta = DownloadManager.formatEtaSeconds(etaSec);
                this.emitProgress({ ...payload });
              }
            });

            // Cancel may have flipped status while ffmpeg/AI ran
            if ((payload.status as DownloadProgressPayload['status']) === 'cancelled') {
              cleanupInstrumentalRunTemps(false);
              this.activeJobs.delete(downloadId);
              this.activeUrls.delete(dedupUrlKey);
              return;
            }

            if (result.cancelled) {
              cleanupInstrumentalRunTemps(false);
              payload.status = 'cancelled';
              payload.errorMessage = 'Download cancelled by user';
              this.emitProgress({ ...payload });
              this.activeJobs.delete(downloadId);
              this.activeUrls.delete(dedupUrlKey);
              return;
            }

            if (!result.success || !result.outputPath || !fs.existsSync(result.outputPath)) {
              cleanupInstrumentalRunTemps(false);
              payload.status = 'error';
              payload.errorMessage =
                result.error || `Instrumental processing failed for ${downloadId}`;
              this.logDownloadFailure(
                payload.errorMessage,
                {
                  downloadId,
                  instrumental: true,
                  sourceMp4: originalVideoPath,
                  exitCode: code
                },
                debugSpawnExtras()
              );
              this.emitProgress({ ...payload });
              this.activeJobs.delete(downloadId);
              this.activeUrls.delete(dedupUrlKey);
              return;
            }

            // Success: keep `${downloadId}.instrumental.mp4`; drop source MP4 + WAV temps.
            cleanupInstrumentalRunTemps(true);
            detectedOutputFile = result.outputPath;
          } else if (!detectedOutputFile) {
            payload.status = 'error';
            payload.errorMessage =
              `Download finished but no media file was found under ${this.tempDir}`;
            this.logDownloadFailure(
              payload.errorMessage,
              {
                downloadId,
                tempDir: this.tempDir,
                exitCode: code,
                instrumental: false
              },
              debugSpawnExtras()
            );
            this.emitProgress({ ...payload });
            this.activeJobs.delete(downloadId);
            this.activeUrls.delete(dedupUrlKey);
            return;
          }

          if ((payload.status as DownloadProgressPayload['status']) === 'cancelled') {
            this.activeJobs.delete(downloadId);
            this.activeUrls.delete(dedupUrlKey);
            return;
          }

          payload.status = 'completed';
          payload.percent = 100;
          payload.speed = '';
          payload.eta = '00:00';
          payload.outputFilePath = detectedOutputFile || undefined;
          this.emitProgress({ ...payload });
          this.activeJobs.delete(downloadId);
          this.activeUrls.delete(dedupUrlKey);
        } else if ((payload.status as DownloadProgressPayload['status']) !== 'cancelled') {
          payload.status = 'error';
          const errnoHint =
            typeof code === 'number' && code < 0
              ? ` (OS errno ${-code}; often spawn/permission — not a YouTube filename)`
              : '';
          const detail = lastYtDlpErrorLine ? `: ${lastYtDlpErrorLine}` : errnoHint;
          payload.errorMessage = `yt-dlp exited with error code ${code}${detail}`;
          this.logDownloadFailure(
            payload.errorMessage,
            {
              downloadId,
              exitCode: code,
              instrumental,
              url: options.url,
              lastYtDlpErrorLine: lastYtDlpErrorLine || undefined
            },
            debugSpawnExtras()
          );
          this.emitProgress({ ...payload });
          this.activeJobs.delete(downloadId);
          this.activeUrls.delete(dedupUrlKey);
        } else {
          this.activeJobs.delete(downloadId);
          this.activeUrls.delete(dedupUrlKey);
        }
      })();
    });

    child.on('error', (err: Error) => {
      spawnFailed = true;
      const job = this.activeJobs.get(downloadId);
      if (job) job.process = null;
      this.activeJobs.delete(downloadId);
      this.activeUrls.delete(dedupUrlKey);
      if (payload.status !== 'cancelled') {
        payload.status = 'error';
        payload.errorMessage = err.message;
        this.logDownloadFailure(
          `yt-dlp spawn failed: ${err.message}`,
          {
            downloadId,
            instrumental,
            url: options.url,
            spawnError: err.message
          },
          debugSpawnExtras()
        );
        this.emitProgress({ ...payload });
      }
      this.pumpQueue();
    });
  }

  /** Format raw bytes/s from yt-dlp `progress.speed` for the Download menu. */
  private static formatBytesPerSecond(bytesPerSec: number): string {
    if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '';
    const units = ['B/s', 'KiB/s', 'MiB/s', 'GiB/s'];
    let value = bytesPerSec;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(digits)} ${units[unit]}`;
  }

  /** Format ETA seconds as mm:ss (or h:mm:ss when ≥ 1 hour). */
  private static formatEtaSeconds(etaSec: number): string {
    if (!Number.isFinite(etaSec) || etaSec < 0) return '--:--';
    const total = Math.floor(etaSec);
    const hh = Math.floor(total / 3600);
    const mm = Math.floor((total % 3600) / 60);
    const ss = total % 60;
    if (hh > 0) {
      return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    }
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  /**
   * Normalize yt-dlp speed strings; hide unknown/placeholder values so the UI
   * does not show "N/A" or "UnknownB/s" as if they were real throughput.
   */
  private static sanitizeDownloadSpeed(raw: string): string {
    const s = (raw || '').trim().replace(/\s+/g, ' ');
    if (!s) return '';
    if (/^(n\/?a|na|none|-|~)$/i.test(s)) return '';
    if (/unknown/i.test(s)) return '';
    // Expect something like 1.2MiB/s, 320KiB/s, 1.23 MB/s
    if (!/[0-9]/.test(s) || !/\/s\b/i.test(s)) return '';
    return s;
  }

  /** Ensures library/display title marks instrumental versions distinctly. */
  private ensureInstrumentalTitle(title: string): string {
    const trimmed = (title || 'Unknown').trim() || 'Unknown';
    if (/instrumental/i.test(trimmed)) return trimmed;
    return `${trimmed} (Instrumental)`;
  }

  /**
   * Cancel a queued or in-flight download (traditional or instrumental).
   * Aborts yt-dlp process trees, ffmpeg remux, model download, and AI workers.
   */
  public cancelDownload(downloadId: string): boolean {
    const pendingIdx = this.pendingQueue.findIndex((job) => job.downloadId === downloadId);
    if (pendingIdx >= 0) {
      const [pending] = this.pendingQueue.splice(pendingIdx, 1);
      pending.payload.status = 'cancelled';
      pending.payload.errorMessage = 'Download cancelled by user';
      this.emitProgress({ ...pending.payload });
      this.activeUrls.delete(pending.dedupUrlKey);
      return true;
    }

    const active = this.activeJobs.get(downloadId);
    if (!active) return false;
    if (active.payload.status === 'cancelled') return true;

    active.payload.status = 'cancelled';
    active.payload.errorMessage = 'Download cancelled by user';
    this.emitProgress({ ...active.payload });

    try {
      active.abortController.abort();
    } catch {
      /* ignore */
    }

    if (active.process) {
      killProcessTree(active.process);
      active.process = null;
    }

    this.activeJobs.delete(downloadId);
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

    this.pumpQueue();
    return true;
  }

  /**
   * Cancel every queued and in-flight download (traditional + instrumental).
   * Used by the Download menu “clear queue” action.
   */
  public cancelAllDownloads(): { cancelledIds: string[] } {
    const ids = new Set<string>();
    for (const job of this.pendingQueue) ids.add(job.downloadId);
    for (const id of this.activeJobs.keys()) ids.add(id);
    const cancelledIds: string[] = [];
    for (const id of ids) {
      if (this.cancelDownload(id)) cancelledIds.push(id);
    }
    return { cancelledIds };
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
      uri: buildKaraokeLocalUri(destinationPath),
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
      uri: buildKaraokeLocalUri(destinationPath)
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
