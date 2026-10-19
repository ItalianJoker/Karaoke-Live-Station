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
import type { WhisperCppManager } from './WhisperCppManager';
import { processKaraokeSttOverlay } from './KaraokeSttProcessor';
import { coerceWhisperModelId } from '../../shared/whisperStt';
import { buildKaraokeLocalUri } from '../../shared/karaokeLocalPath';
import { findMediaMatchInTree } from '../../shared/libraryScanner';
import {
  YTDLP_INSTRUMENTAL_SUB_LANGS,
  buildYtDlpOutputTemplate,
  isYtDlpTransientMediaName,
  parseYtDlpOutputPath,
  resolveDownloadedMediaPath as resolveDownloadedMediaInTemp,
  resolvePathAgainstTempDir,
  shouldWriteInstrumentalAutoSubs
} from './downloadStaging';
import type { YouTubeCookieBridge } from './youtubeCookies';
import { isYtDlpYouTubeAuthError, isYouTubeUrl } from './youtubeCookies';

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
  resolvePathAgainstTempDir,
  shouldWriteInstrumentalAutoSubs
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
  /** Demucs-only advanced knobs — omit for non-Demucs methods */
  demucsShifts?: number;
  demucsSegmentSize?: number;
  demucsOverlap?: number;
  /** Resolved ORT WASM thread count for AI instrumental (omit for DSP). */
  aiCpuThreads?: number;
  /** GPU-First toggle + probe snapshot for AI instrumental. */
  aiEnableGpu?: boolean;
  aiGpuSupported?: boolean;
  /** Discrete / high-performance preference for ORT/WebGPU hint. */
  aiGpuPreference?: 'high-performance' | 'low-power' | 'system';
  /**
   * When true (and instrumental + video): request yt-dlp auto-subs for lyric burn-in.
   * Default / omitted = false (no `--write-auto-sub`). Missing subs never fail the job.
   */
  includeSubtitles?: boolean;
  /**
   * When true: after instrumental remux, run karaoke STT (whisper.cpp) on the original mix.
   * Failure is best-effort — does not invalidate the instrumental file.
   */
  generateKaraokeStt?: boolean;
  sttModelId?: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3';
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
  /** FIFO drain order for queued downloads. */
  private pendingQueue: PendingDownloadJob[] = [];
  /** O(1) pending lookup by downloadId (mirrors TrackAnalysisService.queuedTrackIds). */
  private pendingById = new Map<string, PendingDownloadJob>();
  private vocalModelManager?: OfflineVocalModelManager;
  private ortWasmManager?: OrtWasmManager;
  private whisperManager?: WhisperCppManager;
  private logger?: Logger;
  /** Optional YouTube cookie auth (login window + Netscape cookies.txt for yt-dlp). */
  private youtubeCookies?: YouTubeCookieBridge;

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
    whisperManager?: WhisperCppManager;
  }): void {
    this.vocalModelManager = deps.vocalModelManager;
    this.ortWasmManager = deps.ortWasmManager;
    this.logger = deps.logger;
    if (deps.whisperManager) this.whisperManager = deps.whisperManager;
  }

  public setWhisperManager(manager: WhisperCppManager): void {
    this.whisperManager = manager;
  }

  /**
   * Wire automated YouTube cookie login / `--cookies` injection.
   * Safe to call once after construction from Main Process.
   */
  public setYouTubeCookieBridge(bridge: YouTubeCookieBridge): void {
    this.youtubeCookies = bridge;
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

  /**
   * Snapshot of queued + in-flight download payloads for Control Room remount.
   * Terminal statuses (completed/error/cancelled) are not retained in maps.
   */
  public getActiveDownloadSnapshot(): DownloadProgressPayload[] {
    const out: DownloadProgressPayload[] = [];
    const seen = new Set<string>();
    for (const job of this.pendingQueue) {
      if (seen.has(job.downloadId)) continue;
      seen.add(job.downloadId);
      out.push({ ...job.payload });
    }
    for (const job of this.activeJobs.values()) {
      if (seen.has(job.payload.downloadId)) continue;
      seen.add(job.payload.downloadId);
      out.push({ ...job.payload });
    }
    return out;
  }

  private emitProgress(payload: DownloadProgressPayload): void {
    for (const listener of this.progressListeners) {
      try {
        listener(payload);
      } catch (err) {
        this.logger?.error('DownloadManager', 'Error in progress listener', err);
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
      this.pendingById.delete(next.downloadId);
      if (next.payload.status === 'cancelled') continue;
      next.payload.status = 'downloading';
      next.payload.percent = 0;
      this.emitProgress({ ...next.payload });
      void this.launchDownload(
        next.downloadId,
        next.options,
        next.payload,
        next.dedupUrlKey,
        false
      );
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

  /**
   * Move/copy karaoke sidecars (`.karaoke.json`, optional `.ass`) from beside
   * `sourceMediaPath` to beside `destMediaPath`. Used after instrumental remux
   * and when promoting temp media into library / queue cache so Stage can find lyrics.
   */
  public static promoteKaraokeSidecars(
    sourceMediaPath: string,
    destMediaPath: string
  ): void {
    if (!sourceMediaPath || !destMediaPath) return;
    if (path.resolve(sourceMediaPath) === path.resolve(destMediaPath)) return;
    for (const suffix of ['.karaoke.json', '.ass'] as const) {
      const from = `${sourceMediaPath}${suffix}`;
      const to = `${destMediaPath}${suffix}`;
      try {
        if (!fs.existsSync(from)) continue;
        if (fs.existsSync(to) && path.resolve(from) === path.resolve(to)) continue;
        try {
          fs.renameSync(from, to);
        } catch {
          fs.copyFileSync(from, to);
          try {
            fs.unlinkSync(from);
          } catch {
            /* ignore unlink races */
          }
        }
      } catch {
        /* ignore sidecar races */
      }
    }
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
   * Prefer SQL-targeted `catalogTracks` candidates from DatabaseManager (O(k));
   * in-memory Maps make id / artist+title lookup O(1). Directory scans are last-resort.
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

    // Index candidates once — O(k) build, O(1) id / artist+title probes.
    const byExactId = new Map<string, KaraokeMediaTrack>();
    const byArtistTitle = new Map<string, KaraokeMediaTrack>();
    const ytIdHits: KaraokeMediaTrack[] = [];
    for (const track of options.catalogTracks || []) {
      if (!track?.localFilePath) continue;
      if (track.id) byExactId.set(track.id, track);
      if (track.title && track.artist) {
        const key = `${track.artist.trim().toLowerCase()}\0${track.title.trim().toLowerCase()}`;
        byArtistTitle.set(key, track);
      }
      if (
        ytId &&
        (track.id === ytId || track.id?.includes(ytId) || track.uri?.includes(ytId))
      ) {
        ytIdHits.push(track);
      }
    }

    if (ytId) {
      const exact = byExactId.get(ytId);
      if (exact) {
        const hit = tryPath(exact.localFilePath, 'database', 'id');
        if (hit) return hit;
      }
      for (const track of ytIdHits) {
        const hit = tryPath(track.localFilePath, 'database', 'id');
        if (hit) return hit;
      }
    }

    if (options.title && options.artist) {
      const key = `${options.artist.trim().toLowerCase()}\0${options.title.trim().toLowerCase()}`;
      const named = byArtistTitle.get(key);
      if (named) {
        const hit = tryPath(named.localFilePath, 'database', 'filename');
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
      const pending = this.pendingById.get(existingDownloadId);
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
      const pendingJob: PendingDownloadJob = {
        downloadId,
        options: launchOptions,
        payload,
        dedupUrlKey
      };
      this.pendingQueue.push(pendingJob);
      this.pendingById.set(downloadId, pendingJob);
      this.emitProgress({ ...payload });
      return { downloadId, alreadyExists: false };
    }

    this.emitProgress(payload);
    void this.launchDownload(downloadId, launchOptions, payload, dedupUrlKey, false);
    return { downloadId, alreadyExists: false };
  }

  /**
   * Spawns yt-dlp for a download that already owns a pool slot (or was just dequeued).
   * For YouTube URLs: ensures cookies.txt (login window if needed) and passes `--cookies`.
   * On auth errors, refreshes cookies once and retries.
   *
   * Registers the job in {@link activeJobs} *before* cookie ensure so Cancel works
   * during `awaiting_auth` (process is null until yt-dlp spawns).
   */
  private async launchDownload(
    downloadId: string,
    options: DownloadOptions,
    payload: DownloadProgressPayload,
    dedupUrlKey: string,
    authRetried: boolean
  ): Promise<void> {
    const instrumental = options.instrumental === true;
    // Relative -o + cwd=tempDir (same staging files as absolute join). Avoids
    // Windows drive-letter / TYPES: colon edge cases on absolute -o paths.
    const outputTemplate = buildYtDlpOutputTemplate(downloadId);

    // Pre-register so Cancel / Clear-all can find this job during cookie login.
    const abortController = new AbortController();
    this.activeJobs.set(downloadId, {
      process: null,
      payload,
      url: dedupUrlKey,
      abortController
    });

    // YouTube: open login when cookies missing/invalid before the first spawn.
    if (this.youtubeCookies && isYouTubeUrl(options.url)) {
      const cookiesReady = Boolean(this.youtubeCookies.getValidCookiesPath());
      if (!cookiesReady) {
        payload.status = 'awaiting_auth';
        this.emitProgress({ ...payload });
        // Bring auth UI forward if a sibling download already opened it.
        this.youtubeCookies.focusLoginWindow();
      }

      const ensured = await this.youtubeCookies.ensureForYouTubeDownload(options.url);
      if (!ensured.ok) {
        // Cancel may have raced while the login window was open.
        if (payload.status === 'cancelled') {
          this.activeJobs.delete(downloadId);
          this.activeUrls.delete(dedupUrlKey);
          this.pumpQueue();
          return;
        }
        payload.status = 'error';
        // Stable i18n keys — renderer maps via t(); raw text kept for log/fallback.
        payload.errorMessage = ensured.cancelled
          ? 'errors.youtubeLoginCancelled'
          : ensured.error
            ? `errors.youtubeLoginFailed:${ensured.error}`
            : 'errors.youtubeLoginFailed';
        this.logDownloadFailure(
          ensured.cancelled
            ? 'YouTube login cancelled — cookies are required for this download'
            : ensured.error || 'YouTube login failed — cannot download without cookies',
          { downloadId, instrumental, url: options.url, cancelled: ensured.cancelled },
          undefined
        );
        this.emitProgress({ ...payload });
        this.activeJobs.delete(downloadId);
        this.activeUrls.delete(dedupUrlKey);
        this.pumpQueue();
        return;
      }

      // Login succeeded (or cookies were already valid) — resume download phase.
      if (payload.status === 'awaiting_auth') {
        payload.status = 'downloading';
        this.emitProgress({ ...payload });
      }
    }

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

    const cookiesPath = this.youtubeCookies?.getValidCookiesPath() ?? null;
    if (cookiesPath) {
      args.push('--cookies', cookiesPath);
    }

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
    // Opt-in only (includeSubtitles === true). --sub-langs: .*-orig,default (never bare all).
    if (shouldWriteInstrumentalAutoSubs({ ...options, instrumental })) {
      args.push(
        '--write-auto-sub',
        '--sub-langs',
        YTDLP_INSTRUMENTAL_SUB_LANGS,
        '--convert-subs',
        'srt'
      );
    }

    // Mask cookie path contents in debug — path is OK; never dump file body.
    const debugArgs = args.map((a, i) =>
      args[i - 1] === '--cookies' ? '[COOKIES_FILE]' : a
    );

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
      hasCookies: Boolean(cookiesPath),
      authRetried,
      args: debugArgs
    });

    // Attach yt-dlp to the pre-registered job (created before cookie ensure).
    const activeJob = this.activeJobs.get(downloadId);
    if (activeJob) {
      // Cancel raced after ensure but before spawn — do not keep the child.
      if (activeJob.payload.status === 'cancelled' || activeJob.abortController.signal.aborted) {
        killProcessTree(child);
        this.activeJobs.delete(downloadId);
        this.activeUrls.delete(dedupUrlKey);
        this.pumpQueue();
        return;
      }
      activeJob.process = child;
      activeJob.payload = payload;
    } else {
      this.activeJobs.set(downloadId, {
        process: child,
        payload,
        url: dedupUrlKey,
        abortController: new AbortController()
      });
    }

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
      hasCookies: Boolean(cookiesPath),
      authRetried,
      args: [...debugArgs],
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

        // Peek auth failure before freeing the pool slot — retry reuses this slot.
        const peekAuthFailure =
          code !== 0 &&
          !authRetried &&
          isYouTubeUrl(options.url) &&
          Boolean(this.youtubeCookies) &&
          (isYtDlpYouTubeAuthError(lastYtDlpErrorLine) ||
            isYtDlpYouTubeAuthError(
              `yt-dlp exited with error code ${code}${
                lastYtDlpErrorLine ? `: ${lastYtDlpErrorLine}` : ''
              }`
            ));

        // Free the yt-dlp pool slot while instrumental conversion may still run.
        // Skip when we will reopen login + retry so concurrency stays correct.
        if (!peekAuthFailure) {
          this.pumpQueue();
        }

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
                // STT sidecar written beside original before remux (promoted to instrumental first).
                `${originalVideoPath}.karaoke.json`,
                `${originalVideoPath}.ass`,
                extractWavPath,
                aiOutputWavPath,
                `${instrumentalOut}.partial.mp4`,
                // Legacy misnamed sidecars from older builds (safe no-op if absent).
                path.join(this.tempDir, `${downloadId}.instrumental.wav`),
                path.join(this.tempDir, `${downloadId}.instrumental.instrumental.wav`)
              ];
              if (!keepRemuxArtifact) {
                victims.push(instrumentalOut);
                // Drop instrumental sidecars only on cancel/error (success keeps them for Stage).
                victims.push(`${instrumentalOut}.karaoke.json`, `${instrumentalOut}.ass`);
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

            const signal = job?.abortController.signal;
            const willRunStt =
              options.generateKaraokeStt === true && Boolean(this.whisperManager) && Boolean(options.trackId);
            // Script path from Whisper on original — promoted beside instrumental after remux.
            let sttScriptPath: string | null = null;

            // Pipeline order (Luca): download original → Whisper STT → remove vocals → remux
            // instrumental → attach/promote sidecar onto final instrumental.
            // Invariant (#86): never pass instrumentalOut / aiOutputWavPath as Whisper audio.
            if (
              willRunStt &&
              this.whisperManager &&
              options.trackId &&
              originalVideoPath &&
              fs.existsSync(originalVideoPath)
            ) {
              try {
                const sttSignal = job?.abortController.signal;
                if ((payload.status as DownloadProgressPayload['status']) !== 'cancelled') {
                  payload.status = 'stt_ensuring';
                  payload.percent = 0;
                  payload.speed = '';
                  payload.eta = '--:--';
                  this.emitProgress({ ...payload });
                }
                // Whisper on original video (speech-bearing). Never instrumentalOut.
                const sttInputPath = originalVideoPath;
                this.logger?.info(
                  'DownloadManager',
                  `Karaoke STT before instrumental: input=${sttInputPath} (never instrumentalOut)`,
                  {
                    downloadId,
                    originalVideoPath,
                    instrumentalOut,
                    aiOutputWavPath
                  }
                );
                const sttResult = await processKaraokeSttOverlay({
                  inputVideoPath: sttInputPath,
                  trackId: String(options.trackId),
                  libraryPath: options.libraryPath,
                  modelId: coerceWhisperModelId(options.sttModelId),
                  // Vocal stem export not wired yet — do not pass instrumental extract.
                  vocalStemPath: null,
                  // Instrumental remux does not exist yet — promote sidecar after remux.
                  whisperManager: this.whisperManager,
                  signal: sttSignal,
                  logger: this.logger,
                  onProgress: (phase, percent) => {
                    if (payload.status === 'cancelled') return;
                    if (phase === 'ensuring_engine') {
                      payload.status = 'stt_ensuring';
                    } else {
                      payload.status = 'stt_transcribing';
                    }
                    payload.percent = Math.max(0, Math.min(100, percent));
                    payload.speed = '';
                    this.emitProgress({ ...payload });
                  }
                });
                if (sttResult.cancelled) {
                  cleanupInstrumentalRunTemps(false);
                  payload.status = 'cancelled';
                  payload.errorMessage = 'Download cancelled by user';
                  this.emitProgress({ ...payload });
                  this.activeJobs.delete(downloadId);
                  this.activeUrls.delete(dedupUrlKey);
                  return;
                }
                if (!sttResult.success) {
                  // Best-effort: continue vocal removal + remux without lyrics.
                  this.logger?.warn(
                    'DownloadManager',
                    `Karaoke STT failed (continuing instrumental): ${sttResult.error || 'unknown'}`,
                    { downloadId }
                  );
                } else if (sttResult.scriptPath && fs.existsSync(sttResult.scriptPath)) {
                  sttScriptPath = sttResult.scriptPath;
                }
              } catch (sttErr) {
                this.logger?.warn(
                  'DownloadManager',
                  `Karaoke STT threw (continuing instrumental): ${
                    sttErr instanceof Error ? sttErr.message : String(sttErr)
                  }`,
                  { downloadId }
                );
              }
            }

            // Cancel may have flipped status during STT
            if ((payload.status as DownloadProgressPayload['status']) === 'cancelled') {
              cleanupInstrumentalRunTemps(false);
              this.activeJobs.delete(downloadId);
              this.activeUrls.delete(dedupUrlKey);
              return;
            }

            // Conversion bar replaces the download bar (fresh 0→100%) for instrumental only
            payload.status = 'processing';
            payload.percent = 0;
            payload.speed = '';
            payload.eta = '--:--';
            this.emitProgress({ ...payload });

            // STT already finished on original — no retainWorkWavs needed for Whisper.
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
              demucsShifts: options.demucsShifts,
              demucsSegmentSize: options.demucsSegmentSize,
              demucsOverlap: options.demucsOverlap,
              aiCpuThreads: options.aiCpuThreads,
              aiEnableGpu: options.aiEnableGpu,
              aiGpuSupported: options.aiGpuSupported,
              aiGpuPreference: options.aiGpuPreference,
              onProgress: (phase, percent, meta) => {
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
                // Session-truth ORT backend (distinct from Settings capability badge).
                if (meta?.ortBackend === 'webgpu' || meta?.ortBackend === 'wasm' || meta?.ortBackend === 'pending') {
                  payload.ortBackend = meta.ortBackend;
                }
                if (typeof meta?.ortNumThreads === 'number' && Number.isFinite(meta.ortNumThreads)) {
                  payload.ortNumThreads = meta.ortNumThreads;
                }
                if (typeof meta?.ortFallbackReason === 'string' && meta.ortFallbackReason) {
                  payload.ortFallbackReason = meta.ortFallbackReason;
                }
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

            // Apply STT onto final instrumental: promote sidecar (+ ASS if any) beside remux.
            if (result.outputPath) {
              try {
                DownloadManager.promoteKaraokeSidecars(originalVideoPath, result.outputPath);
                if (
                  sttScriptPath &&
                  fs.existsSync(sttScriptPath)
                ) {
                  const sibling = `${result.outputPath}.karaoke.json`;
                  if (path.resolve(sttScriptPath) !== path.resolve(sibling)) {
                    fs.copyFileSync(sttScriptPath, sibling);
                  }
                }
                // Durable library store when path + trackId are known (Stage `.kls-karaoke` lookup).
                if (
                  options.libraryPath &&
                  options.trackId &&
                  fs.existsSync(`${result.outputPath}.karaoke.json`)
                ) {
                  const klsDir = path.join(options.libraryPath, '.kls-karaoke');
                  const klsPath = path.join(klsDir, `${options.trackId}.karaoke.json`);
                  fs.mkdirSync(klsDir, { recursive: true });
                  fs.copyFileSync(`${result.outputPath}.karaoke.json`, klsPath);
                }
              } catch {
                /* ignore sidecar promote races */
              }
            }

            // Success: keep `${downloadId}.instrumental.mp4` (+ sidecar); drop source MP4 + WAV temps.
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
          const errnoHint =
            typeof code === 'number' && code < 0
              ? ` (OS errno ${-code}; often spawn/permission — not a YouTube filename)`
              : '';
          const detail = lastYtDlpErrorLine ? `: ${lastYtDlpErrorLine}` : errnoHint;
          const failureText = `yt-dlp exited with error code ${code}${detail}`;

          // Auth / bot-check: reopen login once, then retry the same downloadId.
          const authFailure =
            !authRetried &&
            isYouTubeUrl(options.url) &&
            Boolean(this.youtubeCookies) &&
            (isYtDlpYouTubeAuthError(lastYtDlpErrorLine) ||
              isYtDlpYouTubeAuthError(failureText));

          if (authFailure && this.youtubeCookies) {
            this.logger?.warn(
              'DownloadManager',
              'yt-dlp YouTube auth failure — opening login and retrying once',
              { downloadId, exitCode: code }
            );
            // Keep job registered (process null) so Cancel works during re-login.
            const retryJob = this.activeJobs.get(downloadId);
            if (retryJob) {
              retryJob.process = null;
            } else {
              this.activeJobs.set(downloadId, {
                process: null,
                payload,
                url: dedupUrlKey,
                abortController: new AbortController()
              });
            }
            payload.status = 'awaiting_auth';
            payload.percent = 0;
            payload.speed = '';
            payload.eta = '--:--';
            payload.errorMessage = undefined;
            this.emitProgress({ ...payload });
            this.youtubeCookies.focusLoginWindow();

            const refreshed = await this.youtubeCookies.refreshAfterAuthFailure(options.url);
            if ((payload.status as DownloadProgressPayload['status']) === 'cancelled') {
              this.activeJobs.delete(downloadId);
              this.activeUrls.delete(dedupUrlKey);
              this.pumpQueue();
              return;
            }
            if (refreshed) {
              // Drop pre-retry placeholder; launchDownload re-registers before spawn.
              this.activeJobs.delete(downloadId);
              void this.launchDownload(
                downloadId,
                options,
                payload,
                dedupUrlKey,
                true
              );
              return;
            }

            payload.status = 'error';
            payload.errorMessage = 'errors.youtubeLoginRequiredAfterAuth';
            this.logDownloadFailure(
              'YouTube login required after auth error, but login did not complete',
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
            return;
          }

          payload.status = 'error';
          payload.errorMessage = failureText;
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
    const pending = this.pendingById.get(downloadId);
    if (pending) {
      this.pendingById.delete(downloadId);
      const pendingIdx = this.pendingQueue.findIndex((job) => job.downloadId === downloadId);
      if (pendingIdx >= 0) this.pendingQueue.splice(pendingIdx, 1);
      pending.payload.status = 'cancelled';
      pending.payload.errorMessage = 'Download cancelled by user';
      this.emitProgress({ ...pending.payload });
      this.activeUrls.delete(pending.dedupUrlKey);
      return true;
    }

    const active = this.activeJobs.get(downloadId);
    if (!active) return false;
    if (active.payload.status === 'cancelled') return true;

    const wasAwaitingAuth = active.payload.status === 'awaiting_auth';
    active.payload.status = 'cancelled';
    active.payload.errorMessage = 'Download cancelled by user';
    this.emitProgress({ ...active.payload });

    try {
      active.abortController.abort();
    } catch {
      /* ignore */
    }

    // Close YouTube login only when no sibling job still needs the auth window.
    if (wasAwaitingAuth) {
      let othersAwaiting = false;
      for (const [id, job] of this.activeJobs) {
        if (id !== downloadId && job.payload.status === 'awaiting_auth') {
          othersAwaiting = true;
          break;
        }
      }
      if (!othersAwaiting) {
        try {
          this.youtubeCookies?.cancelLogin();
        } catch {
          /* ignore */
        }
      }
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
      this.logger?.warn('DownloadManager', 'Failed to clean partial download files', {
        downloadId,
        err: err instanceof Error ? err.message : String(err)
      });
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

    // Keep STT / ASS sidecars with the media so Stage finds lyrics after archive.
    DownloadManager.promoteKaraokeSidecars(tempFilePath, destinationPath);
    if (trackMetadata.trackId) {
      try {
        const sibling = `${destinationPath}.karaoke.json`;
        if (fs.existsSync(sibling)) {
          const klsDir = path.join(targetLibraryDirectory, '.kls-karaoke');
          const klsPath = path.join(klsDir, `${trackMetadata.trackId}.karaoke.json`);
          fs.mkdirSync(klsDir, { recursive: true });
          if (!fs.existsSync(klsPath) || path.resolve(sibling) !== path.resolve(klsPath)) {
            fs.copyFileSync(sibling, klsPath);
          }
        }
      } catch {
        /* ignore .kls-karaoke promote races */
      }
    }

    const isMidi = ext.toLowerCase() === '.mid' || ext.toLowerCase() === '.kar';
    return {
      id: trackMetadata.trackId || `track_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      source: isMidi ? 'midi' : 'local_library',
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

    // Sidecar must follow queue-cache media (Stage overlay beside cached instrumental).
    DownloadManager.promoteKaraokeSidecars(tempFilePath, destinationPath);

    return {
      localFilePath: destinationPath,
      uri: buildKaraokeLocalUri(destinationPath)
    };
  }

  /**
   * Deletes a file under `queue_cache/` or `temp/` only.
   *
   * **Critical invariant (Safety-First):** refuses any path outside those roots —
   * never deletes permanent `libraryPath` media. Paired with renderer
   * `cleanupQueueCacheFileIfUnreferenced` path-string guard.
   *
   * @param filePath - Absolute path candidate
   * @returns `{ success: true }` only when unlink ran under an allowed root
   */
  public async deleteCachedFile(filePath: string): Promise<{ success: boolean }> {
    if (!filePath || typeof filePath !== 'string') return { success: false };

    try {
      const resolvedPath = path.resolve(filePath);
      const resolvedCache = path.resolve(this.queueCacheDir);
      const resolvedTemp = path.resolve(this.tempDir);
      const isInCache = resolvedPath.startsWith(resolvedCache + path.sep);
      const isInTemp = resolvedPath.startsWith(resolvedTemp + path.sep);

      // INVARIANT: libraryPath and other user media are never deletable here
      if (!isInCache && !isInTemp) {
        this.logger?.warn(
          'DownloadManager',
          'Security guard: Refused deletion of file outside queue_cache/temp',
          { filePath: resolvedPath }
        );
        return { success: false };
      }

      if (fs.existsSync(resolvedPath)) {
        await fs.promises.unlink(resolvedPath);
        return { success: true };
      }
    } catch (err) {
      this.logger?.warn('DownloadManager', 'Failed to delete cached file', {
        filePath,
        err: err instanceof Error ? err.message : String(err)
      });
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
            this.logger?.warn('DownloadManager', 'Failed to delete orphaned queue cache file', {
              fullPath,
              err: delErr instanceof Error ? delErr.message : String(delErr)
            });
          }
        }
      }
    } catch (err) {
      this.logger?.warn('DownloadManager', 'Failed to cleanup unreferenced cache', err);
    }
    return { deletedCount };
  }

  public cleanupTempFiles(): void {
    try {
      for (const file of fs.readdirSync(this.tempDir)) {
        fs.unlinkSync(path.join(this.tempDir, file));
      }
    } catch (err) {
      this.logger?.warn('DownloadManager', 'Failed to cleanup temp directory', err);
    }
  }
}
