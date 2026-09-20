import { app, BrowserWindow, ipcMain, protocol, dialog, Menu, shell, session } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { Readable } from 'stream';
import { execFile, execFileSync, type ChildProcess } from 'child_process';
import crypto from 'crypto';
import { DatabaseManager } from './db/database';
import { GuestPortalServer } from './server/guestServer';
import { DownloadManager } from './services/DownloadManager';
import { Logger } from './services/Logger';
import { resolveFfmpegPath, resolveYtDlpPath } from './services/BinaryResolver';
import { YtDlpUpdater } from './services/YtDlpUpdater';
import { FirewallHelper } from './services/FirewallHelper';
import { OfflineVocalModelManager } from './services/OfflineVocalModelManager';
import { OrtWasmManager } from './services/OrtWasmManager';
import {
  SoundFontManager,
  isEphemeralSoundFontPath
} from './services/SoundFontManager';
import { killProcessTree } from './services/processKill';
import {
  ActivePlaybackState,
  AppSettings,
  KaraokeMediaTrack,
  QueueItem,
  GuestSongRequest,
  LogLevel
} from '../shared/types';
import {
  OFFLINE_VOCAL_MODELS,
  type OfflineVocalModelId
} from '../shared/vocalRemover';
import { ORT_WASM_ASSET_FILES } from '../shared/ortWasm';
import { resolveKaraokeLocalFilePath, buildKaraokeLocalUri } from '../shared/karaokeLocalPath';
import { discoverLibraryMedia, discoverLibraryFilesFromPaths } from '../shared/libraryScanner';
import { coerceAiCpuThreads, resolveAiCpuThreads } from '../shared/aiCpuThreads';
import { ZipCdgCache } from './services/ZipCdgCache';
import { TrackAnalysisService } from './services/TrackAnalysisService';
import { coerceAiEnableGpu } from '../shared/aiOrtProviders';
import { probeGpuStatus } from './ai/probeGpuStatus';
import { coerceDemucsOverlap, coerceDemucsSegmentSize, coerceDemucsShifts } from '../shared/demucsAdvancedSettings';
import { coerceMdxEnableOrt, coerceMdxOverlap, coerceMdxSegmentSize } from '../shared/mdxAdvancedSettings';
import { coerceInstrumentalVocalRemoverMethod } from '../shared/vocalRemover';

/** Launch prefs persisted for main-process boot (before Control sync:settings). */
type LaunchPrefs = {
  autoMaximizeControlOnLaunch: boolean;
  autoOpenStageOnLaunch: boolean;
};

const DEFAULT_LAUNCH_PREFS: LaunchPrefs = {
  autoMaximizeControlOnLaunch: true,
  autoOpenStageOnLaunch: true
};
/**
 * Returns the corresponding MIME content-type for audio/video media files.
 *
 * @param filePath - Path to the media file on disk
 * @returns Standard MIME type string
 */
function getMediaMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mkv':
      return 'video/x-matroska';
    case '.avi':
      return 'video/x-msvideo';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.ogg':
      return 'audio/ogg';
    case '.mid':
    case '.kar':
      return 'audio/midi';
    case '.sf2':
      return 'application/octet-stream';
    case '.cdg':
      return 'application/octet-stream';
    case '.wasm':
      return 'application/wasm';
    case '.mjs':
    case '.js':
      return 'text/javascript';
    case '.json':
      return 'application/json';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

/**
 * OS-provided General MIDI banks when the bundled GeneralUser GS bank is unavailable.
 * Bundled resolution (extraResources → userData seed) is handled by SoundFontManager.
 */
function getOsFallbackSoundFont(): string | null {
  const candidates =
    process.platform === 'win32'
      ? [path.join(process.env.WINDIR || 'C:\\Windows', 'System32\\drivers\\gm.dls')]
      : process.platform === 'darwin'
        ? [
            '/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls',
            '/Library/Audio/Sounds/Banks/default.sf2'
          ]
        : [
            '/usr/share/sounds/sf2/default-GM.sf2',
            '/usr/share/sounds/sf2/FluidR3_GM.sf2',
            '/usr/share/soundfonts/default.sf2',
            '/usr/share/sounds/sf2/TimGM6mb.sf2',
            '/usr/share/soundfonts/FluidR3_GM.sf2'
          ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Ignore filesystem access errors and check next candidate
    }
  }
  return null;
}

// Register custom protocol 'karaoke://' as privileged before Electron boots
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'karaoke',
    privileges: {
      secure: true,
      bypassCSP: true,
      supportFetchAPI: true,
      stream: true,
      standard: true
    }
  }
]);

// Allow background and stage windows to play media without requiring direct user click gestures
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Best-effort WebGPU for Hidden Renderer AI (utilityProcess never gets navigator.gpu).
app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'Vulkan,SharedArrayBuffer');
}

/**
 * Main application coordinator orchestrating Electron windows, SQLite database,
 * embedded LAN guest server, background download processes, and zero-latency IPC relays.
 */
class KaraokeMainProcess {
  private controlWindow: BrowserWindow | null = null;
  private stageWindow: BrowserWindow | null = null;
  private logger: Logger;
  private db: DatabaseManager;
  private downloadManager: DownloadManager;
  private ytDlpUpdater: YtDlpUpdater;
  private vocalModelManager: OfflineVocalModelManager;
  private ortWasmManager: OrtWasmManager;
  private soundFontManager: SoundFontManager;
  private guestServer: GuestPortalServer | null = null;
  private currentMasterState: ActivePlaybackState | null = null;
  private currentQueue: QueueItem[] = [];
  private currentSettings: AppSettings | null = null;
  /** In-flight yt-dlp web search process (single slot; cancel kills it). */
  private youtubeSearchChild: ChildProcess | null = null;
  private youtubeSearchCancelled = false;
  /** Track ids waiting for async FFmpeg thumbnail generation (scan does not block on FFmpeg). */
  private thumbnailBackfillQueue: string[] = [];
  private thumbnailBackfillRunning = false;
  /** Paths already attempted this session — avoid infinite retry on decode failures. */
  private thumbnailBackfillAttempted = new Set<string>();
  private libraryReindexNotifyTimer: ReturnType<typeof setTimeout> | null = null;
  /** Coalesced track patches for thumbnail backfill (avoids full catalog re-fetch every 750ms). */
  private pendingTrackUpdates = new Map<string, KaraokeMediaTrack>();
  private libraryTrackUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  /** On-demand ZIP CD+G extract cache under userData/temp/zip_cache. */
  private zipCdgCache: ZipCdgCache;
  /** Async key/BPM analysis (never blocks play-start). */
  private trackAnalysis: TrackAnalysisService;

  /** userData/launch-prefs.json — readable at boot before Control hydrates localStorage. */
  private getLaunchPrefsPath(): string {
    return path.join(app.getPath('userData'), 'launch-prefs.json');
  }

  private readLaunchPrefs(): LaunchPrefs {
    try {
      const raw = fs.readFileSync(this.getLaunchPrefsPath(), 'utf8');
      const parsed = JSON.parse(raw) as Partial<LaunchPrefs>;
      return {
        autoMaximizeControlOnLaunch:
          typeof parsed.autoMaximizeControlOnLaunch === 'boolean'
            ? parsed.autoMaximizeControlOnLaunch
            : DEFAULT_LAUNCH_PREFS.autoMaximizeControlOnLaunch,
        autoOpenStageOnLaunch:
          typeof parsed.autoOpenStageOnLaunch === 'boolean'
            ? parsed.autoOpenStageOnLaunch
            : DEFAULT_LAUNCH_PREFS.autoOpenStageOnLaunch
      };
    } catch {
      return { ...DEFAULT_LAUNCH_PREFS };
    }
  }

  private writeLaunchPrefs(settings: AppSettings | null | undefined): void {
    if (!settings) return;
    const prefs: LaunchPrefs = {
      autoMaximizeControlOnLaunch:
        typeof settings.autoMaximizeControlOnLaunch === 'boolean'
          ? settings.autoMaximizeControlOnLaunch
          : true,
      autoOpenStageOnLaunch:
        typeof settings.autoOpenStageOnLaunch === 'boolean'
          ? settings.autoOpenStageOnLaunch
          : true
    };
    try {
      fs.writeFileSync(this.getLaunchPrefsPath(), JSON.stringify(prefs, null, 2), 'utf8');
    } catch (err) {
      this.logger.warn('MainProcess', 'Failed to persist launch prefs', err);
    }
  }

  constructor() {
    const userDataPath = app.getPath('userData');
    const tempDownloadDir = path.join(userDataPath, 'temp');
    const queueCacheDir = path.join(userDataPath, 'queue_cache');

    this.logger = new Logger(userDataPath, 'info');
    this.setupGlobalAnomalyHandlers();

    this.db = new DatabaseManager(userDataPath);
    this.downloadManager = new DownloadManager(tempDownloadDir, queueCacheDir);
    this.zipCdgCache = new ZipCdgCache(tempDownloadDir);
    this.trackAnalysis = new TrackAnalysisService(
      this.db,
      tempDownloadDir,
      resolveFfmpegPath()
    );
    this.ytDlpUpdater = new YtDlpUpdater(userDataPath, this.logger);
    this.vocalModelManager = new OfflineVocalModelManager(this.logger);
    this.ortWasmManager = new OrtWasmManager(this.logger);
    this.soundFontManager = new SoundFontManager(this.logger);
    this.downloadManager.setInstrumentalAiDeps({
      vocalModelManager: this.vocalModelManager,
      ortWasmManager: this.ortWasmManager,
      logger: this.logger
    });

    this.setupAppLifecycle();
    this.setupCustomProtocol();
    this.setupIpcHandlers();
    this.setupDownloadBridge();
  }

  /**
   * Catches uncaught exceptions and unhandled promise rejections across Node.js runtime.
   */
  private setupGlobalAnomalyHandlers(): void {
    process.on('uncaughtException', (err) => {
      this.logger.error('MainProcess:UncaughtException', err?.message || String(err), err);
    });

    process.on('unhandledRejection', (reason) => {
      this.logger.error('MainProcess:UnhandledRejection', String(reason), reason);
    });
  }

  /**
   * Configures the custom 'karaoke://local/' protocol handler.
   * Implements HTTP 206 Partial Content byte-range streaming to allow seeking in Chromium.
   */

  /**
   * Injects a https Referer for YouTube embed/player requests that would otherwise
   * ship without one from Electron file:// documents (Error 153).
   * Does not overwrite an existing http(s) Referer (e.g. Vite dev server).
   */
  private setupYouTubeEmbedReferer(): void {
    const referer = 'https://localhost/';
    const filter = {
      urls: [
        '*://www.youtube.com/*',
        '*://www.youtube-nocookie.com/*',
        '*://*.youtube.com/*',
        '*://*.youtube-nocookie.com/*',
        '*://*.googlevideo.com/*'
      ]
    };
    session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
      const headers = { ...details.requestHeaders };
      const existingKey = Object.keys(headers).find((k) => k.toLowerCase() === 'referer');
      const existing = existingKey ? String(headers[existingKey] || '') : '';
      if (!/^https?:\/\//i.test(existing)) {
        if (existingKey) delete headers[existingKey];
        headers['Referer'] = referer;
      }
      callback({ requestHeaders: headers });
    });
  }

  private setupCustomProtocol(): void {
    app.whenReady().then(() => {
      protocol.handle('karaoke', async (request) => {
        try {
          const url = new URL(request.url);
          // Durable ORT WASM/MJS under userData/ort — never OS Temp
          if (url.hostname === 'ort') {
            const rawName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
            const filePath = this.ortWasmManager.resolveServableAsset(rawName);
            if (!filePath) {
              this.logger.warn('Protocol', 'ORT asset not found', { rawName });
              return new Response('ORT asset not found', { status: 404 });
            }
            const stat = await fs.promises.stat(filePath);
            const stream = fs.createReadStream(filePath);
            return new Response(Readable.toWeb(stream) as any, {
              status: 200,
              headers: {
                'Content-Length': String(stat.size),
                'Content-Type': getMediaMimeType(filePath),
                'Cache-Control': 'public, max-age=31536000, immutable',
                'Cross-Origin-Resource-Policy': 'cross-origin'
              }
            });
          }

          // Durable ONNX models under userData/models
          if (url.hostname === 'models') {
            const rawName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
            const filePath = this.vocalModelManager.resolveServableModel(rawName);
            if (!filePath) {
              this.logger.warn('Protocol', 'Vocal model asset not found', { rawName });
              return new Response('Vocal model not found', { status: 404 });
            }
            const stat = await fs.promises.stat(filePath);
            const stream = fs.createReadStream(filePath);
            return new Response(Readable.toWeb(stream) as any, {
              status: 200,
              headers: {
                'Content-Length': String(stat.size),
                'Content-Type': 'application/octet-stream',
                'Cache-Control': 'no-cache',
                'Cross-Origin-Resource-Policy': 'cross-origin'
              }
            });
          }

          // Format expected: karaoke://local/${encodeURIComponent(absolutePath)}
          // URL pathname always has a leading "/", so POSIX "/home/..." becomes "//home/..."
          // after decode — normalize via shared helper (also handles Windows drives / UNC).
          if (url.hostname === 'local') {
            const filePath = resolveKaraokeLocalFilePath(url.pathname);

            if (!fs.existsSync(filePath)) {
              this.logger.warn('Protocol', 'Media file not found on disk', { filePath });
              return new Response('Media file not found on disk', { status: 404 });
            }

            const stat = await fs.promises.stat(filePath);
            const totalSize = stat.size;
            const mimeType = getMediaMimeType(filePath);
            const rangeHeader = request.headers.get('range');

            if (rangeHeader) {
              const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
              if (match) {
                const start = parseInt(match[1], 10);
                const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;

                if (start >= totalSize || end >= totalSize || start > end) {
                  this.logger.warn('Protocol', 'Range Not Satisfiable', { filePath, rangeHeader, totalSize });
                  return new Response(null, {
                    status: 416,
                    statusText: 'Range Not Satisfiable',
                    headers: {
                      'Content-Range': `bytes */${totalSize}`
                    }
                  });
                }

                const chunkSize = end - start + 1;
                const stream = fs.createReadStream(filePath, { start, end });
                return new Response(Readable.toWeb(stream) as any, {
                  status: 206,
                  statusText: 'Partial Content',
                  headers: {
                    'Content-Range': `bytes ${start}-${end}/${totalSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': String(chunkSize),
                    'Content-Type': mimeType
                  }
                });
              }
            }

            const stream = fs.createReadStream(filePath);
            return new Response(Readable.toWeb(stream) as any, {
              status: 200,
              headers: {
                'Accept-Ranges': 'bytes',
                'Content-Length': String(totalSize),
                'Content-Type': mimeType
              }
            });
          }

          return new Response('Invalid karaoke:// host', { status: 400 });
        } catch (err) {
          this.logger.error('Protocol', 'Error streaming media via karaoke:// protocol', err);
          return new Response(`Protocol Error: ${err}`, { status: 500 });
        }
      });
    });
  }

  /**
   * Binds application lifecycle handlers for window closure, cleanup, and bootstrap.
   */
  private setupAppLifecycle(): void {
    app.on('second-instance', () => {
      // Focus existing Control Window when a second application instance is launched
      if (this.controlWindow) {
        if (this.controlWindow.isMinimized()) {
          this.controlWindow.restore();
        }
        this.controlWindow.show();
        this.controlWindow.focus();
      }
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('before-quit', async () => {
      // Stop orphans first: yt-dlp downloads/search, Hidden Renderer GPU window,
      // then guest HTTP, caches, and SQLite — so Node/GPU processes cannot linger.
      try {
        this.downloadManager.cancelAllDownloads();
      } catch {
        /* ignore cancel races on quit */
      }
      try {
        this.cancelYouTubeSearch();
      } catch {
        /* ignore */
      }
      try {
        const { getInstrumentalAiHiddenRenderer } = await import(
          './services/InstrumentalAiHiddenRenderer'
        );
        getInstrumentalAiHiddenRenderer(this.logger).dispose();
      } catch {
        /* ignore dispose errors on quit */
      }
      if (this.guestServer) {
        await this.guestServer.stop();
      }
      this.downloadManager.cleanupTempFiles();
      this.zipCdgCache.cleanupAll();
      this.db.close();
    });

    app.whenReady().then(async () => {
      Menu.setApplicationMenu(null);
      this.setupYouTubeEmbedReferer();
      // Seed ORT WASM into userData/ort for Download Instrumental AI (not live Separazione)
      try {
        await this.ortWasmManager.ensureOrtWasm();
      } catch (err) {
        this.logger.error(
          'OrtWasmManager',
          `Failed to seed ORT WASM under userData/ort: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      // Seed bundled GeneralUser GS into userData/soundfonts (stable path for AppImage remounts)
      try {
        this.soundFontManager.ensureBundledSoundFont();
      } catch (err) {
        this.logger.error(
          'SoundFontManager',
          `Failed to seed SoundFont under userData/soundfonts: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
      await this.initWindows();
      this.initGuestServer();
      setTimeout(() => {
        this.ensureLocalThumbnails();
      }, 1500);
      setTimeout(() => {
        this.ytDlpUpdater.checkAndAutoUpdateOnStartup();
      }, 4000);
    });
  }

  /**
   * Initializes the primary Control Window (Regia) and optionally Stage Window (Palco).
   * Launch prefs (maximize Regia / open Stage) come from userData/launch-prefs.json
   * so boot works before Control sync:settings hydrates currentSettings.
   */
  private async initWindows(): Promise<void> {
    const preloadPath = path.join(__dirname, '../preload/index.js');
    const launchPrefs = this.readLaunchPrefs();

    // 1. Create Control Window (Master / Regia)
    const windowIcon = this.getWindowIcon();
    this.controlWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1024,
      minHeight: 700,
      title: 'Karaoke Live Station - Regia',
      backgroundColor: '#090d16',
      icon: windowIcon,
      autoHideMenuBar: true,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    });

    this.controlWindow.removeMenu();
    this.controlWindow.setMenu(null);
    this.controlWindow.setMenuBarVisibility(false);

    // Maximize Regia only — never exclusive fullscreen; does not touch Stage placement.
    if (launchPrefs.autoMaximizeControlOnLaunch) {
      this.controlWindow.maximize();
    }

    // 2. Create Stage Window (Slave / View) unless operator disabled auto-open
    if (launchPrefs.autoOpenStageOnLaunch) {
      this.createStageWindow(preloadPath);
    } else {
      this.logger.info(
        'StageWindow',
        'Skipping Stage on launch (autoOpenStageOnLaunch=false); reopen via UI / F2 / stage:open'
      );
    }

    // Load URL from Vite dev server if running, or bundled index.html
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    if (devServerUrl) {
      await this.controlWindow.loadURL(`${devServerUrl}?window=control`);
    } else {
      await this.controlWindow.loadFile(this.getRendererHtmlPath(), {
        query: { window: 'control' }
      });
    }

    this.controlWindow.on('closed', () => {
      this.logger.info('ControlWindow', 'Control window closed — quitting to avoid orphan processes');
      this.controlWindow = null;
      // Stage alone is not enough: Hidden Renderer stays open → window-all-closed
      // never fires → before-quit skipped → guestServer + GPU keep Node alive.
      if (this.stageWindow && !this.stageWindow.isDestroyed()) {
        this.stageWindow.close();
      }
      try {
        // Sync dispose so the hidden GPU window is gone before app.quit().
        const { getInstrumentalAiHiddenRenderer } = require('./services/InstrumentalAiHiddenRenderer');
        getInstrumentalAiHiddenRenderer(this.logger).dispose();
      } catch {
        /* ignore dispose errors on Control close */
      }
      try {
        this.downloadManager.cancelAllDownloads();
      } catch {
        /* ignore */
      }
      try {
        this.cancelYouTubeSearch();
      } catch {
        /* ignore */
      }
      app.quit();
    });

    this.controlWindow.webContents.on('render-process-gone', (_event, details) => {
      this.logger.error('ControlWindow', 'Control window renderer process crashed', details);
    });

    this.controlWindow.webContents.on('unresponsive', () => {
      this.logger.warn('ControlWindow', 'Control window became unresponsive');
    });
  }

  /**
   * Resolves the filesystem path to the compiled renderer index.html file.
   */
  private getRendererHtmlPath(): string {
    const p1 = path.join(app.getAppPath(), 'dist/index.html');
    if (fs.existsSync(p1)) return p1;
    const p2 = path.join(__dirname, '../../dist/index.html');
    if (fs.existsSync(p2)) return p2;
    return path.join(__dirname, '../renderer/index.html');
  }

  /**
   * Resolves the application window icon path for window titlebars and system taskbars.
   */
  /**
   * Bundled GeneralUser GS (seeded under userData/soundfonts) then OS GM fallbacks.
   * Never returns a bare asar-only path for protocol streaming.
   */
  private resolveDefaultSoundFont(): string | null {
    const bundled = this.soundFontManager.ensureBundledSoundFont();
    if (bundled) return bundled;
    return getOsFallbackSoundFont();
  }

  private getWindowIcon(): string | undefined {
    const candidates = [
      path.join(app.getAppPath(), 'build/icon.png'),
      path.join(app.getAppPath(), 'public/logo.png'),
      path.join(__dirname, '../../build/icon.png'),
      path.join(__dirname, '../../public/logo.png'),
      process.resourcesPath ? path.join(process.resourcesPath, 'build/icon.png') : '',
      process.resourcesPath ? path.join(process.resourcesPath, 'public/logo.png') : '',
      process.resourcesPath ? path.join(process.resourcesPath, 'logo.png') : ''
    ].filter(Boolean);

    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return undefined;
  }

  /**
   * Creates or focuses the Stage Window (Palco) with auto-recovery and handshake synchronization.
   *
   * @param preloadPath - Path to preload script
   */
  private createStageWindow(preloadPath: string): void {
    if (this.stageWindow && !this.stageWindow.isDestroyed()) {
      this.stageWindow.focus();
      return;
    }

    this.logger.info('StageWindow', 'Creating stage window (Palco)');

    this.stageWindow = new BrowserWindow({
      width: 1280,
      height: 720,
      title: 'Karaoke Live Station - Palco',
      backgroundColor: '#000000',
      show: false,
      icon: this.getWindowIcon(),
      autoHideMenuBar: true,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    });

    // Safety fallback: reveal window after ready-to-show if stage:ready handshake is delayed
    this.stageWindow.once('ready-to-show', () => {
      setTimeout(() => {
        if (this.stageWindow && !this.stageWindow.isDestroyed() && !this.stageWindow.isVisible()) {
          this.logger.info('StageWindow', 'Stage window revealed via safety fallback timer');
          this.stageWindow.show();
        }
      }, 1200);
    });

    this.stageWindow.removeMenu();
    this.stageWindow.setMenu(null);
    this.stageWindow.setMenuBarVisibility(false);

    this.stageWindow.on('enter-full-screen', () => {
      if (this.stageWindow && !this.stageWindow.isDestroyed()) {
        this.stageWindow.removeMenu();
        this.stageWindow.setMenu(null);
        this.stageWindow.setMenuBarVisibility(false);
      }
    });

    this.stageWindow.on('leave-full-screen', () => {
      if (this.stageWindow && !this.stageWindow.isDestroyed()) {
        this.stageWindow.removeMenu();
        this.stageWindow.setMenu(null);
        this.stageWindow.setMenuBarVisibility(false);
      }
    });

    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    if (devServerUrl) {
      this.stageWindow.loadURL(`${devServerUrl}?window=stage`);
    } else {
      this.stageWindow.loadFile(this.getRendererHtmlPath(), {
        query: { window: 'stage' }
      });
    }

    // Handshake and state restoration when stage window finishes loading
    this.stageWindow.webContents.on('did-finish-load', () => {
      this.logger.info('StageWindow', 'Stage window loaded successfully');
      if (this.stageWindow && !this.stageWindow.isDestroyed()) {
        if (this.currentMasterState) {
          this.stageWindow.webContents.send('playback:state-sync', this.currentMasterState);
        }
        if (this.currentQueue) {
          this.stageWindow.webContents.send('playback:command', {
            action: 'sync:queue',
            payload: this.currentQueue
          });
        }
        if (this.currentSettings) {
          this.stageWindow.webContents.send('playback:command', {
            action: 'sync:settings',
            payload: this.currentSettings
          });
        }
      }
      if (this.controlWindow && !this.controlWindow.isDestroyed()) {
        this.controlWindow.webContents.send('window:stage-status', { isOpen: true });
      }
    });

    this.stageWindow.on('closed', () => {
      this.logger.info('StageWindow', 'Stage window closed');
      this.stageWindow = null;
      if (this.controlWindow && !this.controlWindow.isDestroyed()) {
        this.controlWindow.webContents.send('window:stage-status', { isOpen: false });
      }
    });

    // Auto-Recovery notification if stage window renderer process crashes
    this.stageWindow.webContents.on('render-process-gone', (_event, details) => {
      this.logger.error('StageWindow', 'Stage window renderer process crashed', details);
      this.stageWindow = null;
      if (this.controlWindow && !this.controlWindow.isDestroyed()) {
        this.controlWindow.webContents.send('window:stage-crashed', details);
      }
    });
  }

  /**
   * Initializes the embedded LAN Guest Portal server on the specified port.
   */
  private initGuestServer(): void {
    const port = 3000;
    this.guestServer = new GuestPortalServer(port, {
      onRequestReceived: (request: GuestSongRequest) => {
        this.logger.info('GuestServer', 'Guest song request received', request);
        if (this.controlWindow && !this.controlWindow.isDestroyed()) {
          this.controlWindow.webContents.send('guest:request-received', request);
        }
      },
      getPublicQueue: () => this.currentQueue,
      getPlaybackState: () => {
        return (
          this.currentMasterState || {
            isPlaying: false,
            currentTime: 0,
            duration: 0,
            livePitchOffset: 0,
            playbackSpeed: 1,
            mutedMidiChannels: [],
            isVocalRemoverActive: false,
            isDuckingActive: false,
            masterVolume: 1,
            isMuted: false
          }
        );
      },
      getLibraryTracks: () => this.db.getAllTracks()
    });

    this.guestServer.start().then(() => {
      const actualPort = this.guestServer?.getActualPort() || port;
      const localIp = this.guestServer?.getLocalIp() || '127.0.0.1';
      this.logger.info('GuestServer', `Guest portal running on http://${localIp}:${actualPort}`);
    }).catch((err) => {
      this.logger.error('GuestServer', 'Failed to start guest portal', err);
    });
  }

  /**
   * Registers all Inter-Process Communication (IPC) handlers for:
   * - Master-to-Slave zero-latency playback state & queue synchronization
   * - Stage window controls & auto-recovery
   * - Guest portal network information
   * - SQLite database queries & mutations (tracks, singers, SIAE logs)
   * - yt-dlp download management
   */
  private setupIpcHandlers(): void {
    // 1. Zero-latency State Relay from Control (Master) to Stage (Slave)
    ipcMain.on('playback:state-sync', (_event, state: ActivePlaybackState) => {
      this.currentMasterState = state;
      if (this.stageWindow && !this.stageWindow.isDestroyed()) {
        this.stageWindow.webContents.send('playback:state-sync', state);
      }
    });

    ipcMain.on('playback:command', (_event, command: { action: string; payload?: unknown }) => {
      if (command.action === 'sync:settings' && command.payload) {
        this.currentSettings = command.payload as AppSettings;
        this.writeLaunchPrefs(this.currentSettings);
        if (this.currentSettings.logLevel) {
          this.logger.setLogLevel(this.currentSettings.logLevel);
        }
        if (typeof this.currentSettings.maxSimultaneousDownloads === 'number') {
          this.downloadManager.setMaxSimultaneousDownloads(
            this.currentSettings.maxSimultaneousDownloads
          );
        }
      }
      if (command.action === 'sync:queue' && command.payload) {
        const nextQueue = command.payload as QueueItem[];
        this.releaseZipCacheForDequeued(this.currentQueue, nextQueue);
        this.currentQueue = nextQueue;
      }
      if (this.stageWindow && !this.stageWindow.isDestroyed()) {
        this.stageWindow.webContents.send('playback:command', command);
      }
    });

    ipcMain.on('queue:update-cache', (_event, queue: QueueItem[]) => {
      this.releaseZipCacheForDequeued(this.currentQueue, queue);
      this.currentQueue = queue;
      if (this.guestServer) {
        this.guestServer.notifyQueueChanged();
      }
      if (this.stageWindow && !this.stageWindow.isDestroyed()) {
        this.stageWindow.webContents.send('playback:command', {
          action: 'sync:queue',
          payload: queue
        });
      }
    });

    // 2. Window Management & Auto-Recovery
    ipcMain.handle('stage:get-initial-state', () => {
      return {
        playback: this.currentMasterState,
        queue: this.currentQueue,
        settings: this.currentSettings
      };
    });

    ipcMain.handle('window:reopen-stage', () => {
      const preloadPath = path.join(__dirname, '../preload/index.js');
      this.createStageWindow(preloadPath);
      return { success: true };
    });

    // Alias for reopen Stage (spec / product wording). Same as window:reopen-stage.
    ipcMain.handle('stage:open', () => {
      const preloadPath = path.join(__dirname, '../preload/index.js');
      this.createStageWindow(preloadPath);
      return { success: true };
    });

    ipcMain.handle('system:get-cpu-core-count', () => {
      return Math.max(1, os.cpus()?.length || 1);
    });

    ipcMain.handle('system:get-gpu-status', async () => {
      return await probeGpuStatus();
    });

    ipcMain.handle('system:get-app-version', () => {
      return app.getVersion() || '1.4.0';
    });

    ipcMain.handle('window:toggle-stage-fullscreen', () => {
      if (this.stageWindow && !this.stageWindow.isDestroyed()) {
        const isFull = this.stageWindow.isFullScreen();
        const nextState = !isFull;
        this.stageWindow.removeMenu();
        this.stageWindow.setMenu(null);
        this.stageWindow.setMenuBarVisibility(false);
        this.stageWindow.setFullScreen(nextState);
        return { isFullScreen: nextState };
      }
      return { isFullScreen: false };
    });

    ipcMain.on('stage:ready', () => {
      if (this.stageWindow && !this.stageWindow.isDestroyed()) {
        this.logger.info('StageWindow', 'Stage window renderer signaled readiness handshake. Displaying stage window.');
        this.stageWindow.show();
      }
    });

    // 3. Guest Server info & QR Code
    ipcMain.handle('guest:get-portal-info', async () => {
      if (!this.guestServer) {
        return { enabled: false, url: '', qrCode: '', port: 0, ip: '' };
      }
      const url = this.guestServer.getPortalUrl();
      const qrCode = await this.guestServer.getQrCode();
      const port = this.guestServer.getActualPort();
      const ip = this.guestServer.getLocalIp();
      return { enabled: true, url, qrCode, port, ip };
    });

    // 4. Native Dialogs
    ipcMain.handle('dialog:open-file', async (_event, filters: Electron.FileFilter[]) => {
      // Intentionally omit parent window so the dialog is non-modal to the
      // control renderer — prevents Chromium from suspending media/Web Audio.
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    });

    ipcMain.handle('dialog:open-directory', async () => {
      // Non-modal (no parent) so library/settings folder pickers never pause playback.
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory']
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    });

    // 4b. System Defaults — always re-resolve bundled bank (never trust AppImage /tmp/.mount_* paths)
    ipcMain.handle('system:get-default-soundfont', () => {
      return this.resolveDefaultSoundFont();
    });

    ipcMain.handle('system:list-soundfonts', () => {
      return this.soundFontManager.listCatalog();
    });

    ipcMain.handle('system:open-external', async (_event, url: string) => {
      if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
        await shell.openExternal(url);
        return { success: true };
      }
      return { success: false };
    });

    ipcMain.handle('system:check-firewall', () => {
      const port = this.guestServer ? this.guestServer.getActualPort() : 3000;
      const ip = this.guestServer ? this.guestServer.getLocalIp() : '127.0.0.1';
      return FirewallHelper.checkFirewall(port, ip);
    });

    ipcMain.handle(
      'system:init-paths',
      async (_event, clientSettings: { libraryPath?: string; midiSoundFontPath?: string }) => {
        let resolvedSoundFont = clientSettings?.midiSoundFontPath;
        // Missing, deleted, or ephemeral AppImage/portable mount paths must be re-seeded.
        if (
          !resolvedSoundFont ||
          !fs.existsSync(resolvedSoundFont) ||
          isEphemeralSoundFontPath(resolvedSoundFont)
        ) {
          resolvedSoundFont = this.resolveDefaultSoundFont() || '';
        }

        let resolvedLibrary = clientSettings?.libraryPath;
        let wasPrompted = false;

        // If libraryPath is missing or does not exist on disk, prompt user on first launch to choose between default folder or browsing
        if (!resolvedLibrary || !fs.existsSync(resolvedLibrary)) {
          const defaultKaraokeDir = path.join(app.getPath('home'), 'Karaoke');
          const isItalian = (app.getLocale() || '').toLowerCase().startsWith('it');

          try {
            // Intentionally omit parent BrowserWindow so this first-run prompt is
            // non-modal to Control — a parented MessageBox can suspend Chromium
            // media/Web Audio during live setup on secondary monitors.
            {
              const choice = await dialog.showMessageBox({
                type: 'question',
                title: isItalian
                  ? 'Karaoke Live Station - Configurazione Libreria'
                  : 'Karaoke Live Station - Media Library Setup',
                message: isItalian
                  ? 'Benvenuto in Karaoke Live Station!'
                  : 'Welcome to Karaoke Live Station!',
                detail: isItalian
                  ? `Come desideri configurare la tua libreria di brani karaoke?\n\nPuoi usare la cartella predefinita "Karaoke" nella tua cartella utente:\n${defaultKaraokeDir}\n\noppure selezionare una cartella già esistente sul computer.`
                  : `How would you like to set up your karaoke music library?\n\nYou can use the default "Karaoke" folder in your user home directory:\n${defaultKaraokeDir}\n\nor browse and select an existing folder on your computer.`,
                buttons: isItalian
                  ? ['Usa cartella predefinita', 'Seleziona cartella...']
                  : ['Use Default Folder', 'Browse Folder...'],
                defaultId: 0,
                cancelId: 0,
                noLink: true
              });

              if (choice.response === 1) {
                // User chose to browse for a custom folder
                const result = await dialog.showOpenDialog({
                  title: isItalian
                    ? 'Seleziona la cartella della Libreria Karaoke'
                    : 'Select your Karaoke Library Folder',
                  buttonLabel: isItalian ? 'Seleziona Cartella' : 'Select Folder',
                  properties: ['openDirectory', 'createDirectory']
                });

                if (!result.canceled && result.filePaths.length > 0) {
                  resolvedLibrary = result.filePaths[0];
                } else {
                  // If cancelled, fall back to default folder
                  resolvedLibrary = defaultKaraokeDir;
                }
              } else {
                // User chose default folder
                resolvedLibrary = defaultKaraokeDir;
              }
            }
          } catch {
            resolvedLibrary = defaultKaraokeDir;
          }

          // Ensure chosen directory exists on disk
          if (!fs.existsSync(resolvedLibrary)) {
            try {
              fs.mkdirSync(resolvedLibrary, { recursive: true });
              this.logger.info('MainProcess', 'Created Karaoke library directory', { resolvedLibrary });
            } catch (err) {
              this.logger.error('MainProcess', 'Failed to create library folder', err);
            }
          }

          wasPrompted = true;
        }

        return {
          libraryPath: resolvedLibrary,
          midiSoundFontPath: resolvedSoundFont,
          wasPrompted
        };
      }
    );

    // 5. Library Scanner & YouTube Search
    ipcMain.handle('library:scan-folder', async (_event, folderPath: string) => {
      return this.scanFolder(folderPath);
    });

    /**
     * Catalog absolute filesystem paths from OS drag-and-drop (or equivalent).
     * Why: extends the library surface without changing scanFolder contracts.
     */
    ipcMain.handle('library:import-files', async (_event, filePaths: string[]) => {
      return this.importFiles(Array.isArray(filePaths) ? filePaths : []);
    });

    /**
     * Extract a karaoke CD+G ZIP on demand into temp/zip_cache/<trackId>/.
     * Async + setImmediate yields so Regia stays responsive during inflate.
     */
    ipcMain.handle(
      'library:ensure-zip-playback',
      async (_event, payload: { trackId: string; zipPath: string }) => {
        try {
          const trackId = (payload?.trackId || '').trim();
          const zipPath = (payload?.zipPath || '').trim();
          if (!trackId || !zipPath) {
            return { success: false, error: 'trackId and zipPath required' };
          }
          const extracted = await this.zipCdgCache.ensureExtracted(trackId, zipPath);
          const catalog = this.db.getTrackById(trackId);
          if (catalog) this.trackAnalysis.enqueue(catalog);
          return {
            success: true,
            audioPath: extracted.audioPath,
            cdgPath: extracted.cdgPath,
            audioUri: buildKaraokeLocalUri(extracted.audioPath),
            cdgUri: buildKaraokeLocalUri(extracted.cdgPath),
            audioExt: extracted.audioExt
          };
        } catch (err) {
          this.logger.warn('ZipCdg', 'ensure-zip-playback failed', err);
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err)
          };
        }
      }
    );

    /** Release one track's zip extract cache (optional renderer hint). */
    ipcMain.handle('library:release-zip-cache', (_event, trackId: string) => {
      if (trackId) this.zipCdgCache.releaseTrack(trackId);
      return { success: true };
    });

    ipcMain.handle(
      'search:youtube',
      async (
        _event,
        query: string,
        options?: { offset?: number; limit?: number }
      ) => {
        return this.searchYouTube(query, options);
      }
    );

    /** Abort in-flight YouTube/web search; safe no-op when idle. */
    ipcMain.handle('search:youtube:cancel', () => {
      return this.cancelYouTubeSearch();
    });

    ipcMain.handle('library:get-track-thumbnail', (_event, filePath: string) => {
      return this.getOrGenerateThumbnail(filePath);
    });

    /**
     * Probe whether a local media path still exists on disk (USB unplugged / moved / deleted).
     * Why: additive Safety-First channel — never auto-deletes catalog/queue rows.
     * Empty strings and remote/protocol URIs skip `fs` and report `exists: true`.
     *
     * @returns `{ exists: boolean, path: string }` — preload unwraps to boolean for renderer
     */
    ipcMain.handle('library:check-file-exists', (_event, filePath: string) => {
      const pathStr = typeof filePath === 'string' ? filePath.trim() : '';
      if (
        !pathStr ||
        /^https?:\/\//i.test(pathStr) ||
        /^(karaoke|blob|data):/i.test(pathStr)
      ) {
        return { exists: true, path: pathStr };
      }
      try {
        return { exists: fs.existsSync(pathStr), path: pathStr };
      } catch (err) {
        this.logger.warn('Library', 'check-file-exists probe failed', {
          path: pathStr,
          error: String(err)
        });
        return { exists: false, path: pathStr };
      }
    });

    // 6. Database IPC Bridge
    ipcMain.handle('db:get-tracks', () => {
      return this.db.getAllTracks();
    });

    // Bound LIKE search — keeps large catalogs off the IPC bus during live typing.
    ipcMain.handle('db:search-tracks', (_event, query: string, limit?: number) => {
      return this.db.searchTracks(query, limit);
    });

    ipcMain.handle('db:upsert-track', (_event, track: KaraokeMediaTrack) => {
      this.db.upsertTrack(track);
      return { success: true };
    });

    ipcMain.handle('db:delete-track', async (_event, trackId: string) => {
      try {
        const track = this.db.getTrackById(trackId);
        if (!track) {
          return { success: false, error: 'Track not found' };
        }
        const libraryPath = (this.currentSettings?.libraryPath || '').trim();
        let deletedFile = false;
        const filePath = track.localFilePath?.trim();
        if (filePath && libraryPath) {
          const resolvedFile = path.resolve(filePath);
          const resolvedLib = path.resolve(libraryPath);
          const underLibrary =
            resolvedFile === resolvedLib ||
            resolvedFile.startsWith(resolvedLib + path.sep);
          const lower = resolvedFile.toLowerCase();
          const isCacheOrTemp =
            lower.includes(`${path.sep}queue_cache${path.sep}`) ||
            lower.includes(`${path.sep}temp${path.sep}`) ||
            lower.includes(`${path.sep}incomplete`) ||
            lower.includes(`${path.sep}yt-dlp`);
          if (underLibrary && !isCacheOrTemp && fs.existsSync(resolvedFile)) {
            try {
              fs.unlinkSync(resolvedFile);
              deletedFile = true;
              // Companion karaoke graphics / stems next to the audio
              for (const ext of ['.cdg', '.CDG']) {
                if (resolvedFile.toLowerCase().endsWith('.mp3')) {
                  const companion = resolvedFile.slice(0, -4) + ext;
                  if (fs.existsSync(companion)) {
                    try { fs.unlinkSync(companion); } catch { /* ignore */ }
                  }
                }
              }
            } catch (err) {
              this.logger.warn('LibraryDelete', `Could not delete file ${resolvedFile}`, err);
            }
          }
        }
        this.db.deleteTrackById(trackId);
        return { success: true, deletedFile };
      } catch (err) {
        this.logger.error('LibraryDelete', 'db:delete-track failed', err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    });


    ipcMain.handle('db:get-singers', () => {
      return this.db.getAllSingers();
    });

    ipcMain.handle('db:get-or-create-singer', (_event, name: string) => {
      return this.db.getOrCreateSinger(name);
    });

    ipcMain.handle('db:set-singer-permanent', (_event, singerId: string, isPermanent: boolean) => {
      this.db.setSingerPermanentFavorite(singerId, isPermanent);
      return { success: true };
    });

    ipcMain.handle('db:delete-singer', (_event, singerId: string) => {
      this.db.deleteSinger(singerId);
      return { success: true };
    });

    ipcMain.handle('db:update-singer-pitch', (_event, singerId: string, pitchOffset: number) => {
      this.db.updateSingerPitch(singerId, pitchOffset);
      return { success: true };
    });

    ipcMain.handle('db:increment-singer-count', (_event, singerId: string) => {
      this.db.incrementSingerSongCount(singerId);
      return { success: true };
    });

    ipcMain.handle('db:log-siae', (_event, log: { title: string; artist: string; singer?: string; durationSec: number; executedAt?: number | string }) => {
      this.db.logSiaePerformance(log.title, log.artist, log.singer, log.durationSec, log.executedAt);
      return { success: true };
    });

    ipcMain.handle('siae:get-logs', () => {
      return this.db.getSiaeLogs();
    });

    ipcMain.handle('siae:export-csv', async () => {
      if (!this.controlWindow) return { success: false };
      const saveRes = await dialog.showSaveDialog(this.controlWindow, {
        title: 'Esporta Registro SIAE',
        defaultPath: `SIAE_Report_${new Date().toISOString().slice(0, 10)}.csv`,
        filters: [{ name: 'CSV (*.csv)', extensions: ['csv'] }]
      });
      if (saveRes.canceled || !saveRes.filePath) return { success: false };

      const logs = this.db.getSiaeLogs();
      const csvHeader = 'ID,Titolo,Artista,Cantante,Data e Ora (ISO 8601),Timestamp (Epoch ms),Data Locale,Durata (Sec)\n';
      const csvRows = logs.map(l => {
        const dateObj = new Date(l.executedAt);
        const isoStr = l.executedAtIso || dateObj.toISOString();
        const localStr = dateObj.toLocaleString('it-IT');
        return `"${l.id}","${l.trackTitle.replace(/"/g, '""')}","${l.trackArtist.replace(/"/g, '""')}","${(l.singerName || '').replace(/"/g, '""')}","${isoStr}","${l.executedAt}","${localStr}","${l.durationSec}"`;
      }).join('\n');

      await fs.promises.writeFile(saveRes.filePath, csvHeader + csvRows, 'utf8');
      return { success: true, filePath: saveRes.filePath };
    });

    ipcMain.handle('siae:clear-logs', () => {
      this.db.clearSiaeLogs();
      return { success: true };
    });

    // 7. Download Manager IPC Bridge
    ipcMain.handle(
      'download:start',
      async (
        _event,
        options: {
          url: string;
          isAudioOnly?: boolean;
          titleHint?: string;
          artistHint?: string;
          trackId?: string;
          libraryPath?: string;
          instrumental?: boolean;
          vocalRemoverAlgorithm?: string;
          mdxSegmentSize?: number;
          mdxOverlap?: number;
          mdxEnableOrt?: boolean;
          demucsShifts?: number;
          demucsSegmentSize?: number;
          demucsOverlap?: number;
          aiCpuThreads?: number | null;
          aiEnableGpu?: boolean;
          /** Opt-in yt-dlp auto-subs for instrumental lyric burn-in */
          includeSubtitles?: boolean;
        }
      ) => {
        const libraryPath =
          options.libraryPath?.trim() || this.currentSettings?.libraryPath?.trim() || undefined;
        let catalogTracks: KaraokeMediaTrack[] = [];
        try {
          catalogTracks = this.db.getAllTracks();
        } catch {
          catalogTracks = [];
        }
        const instrumental = options.instrumental === true;
        const titleHint = instrumental
          ? /instrumental/i.test(options.titleHint || '')
            ? options.titleHint
            : `${(options.titleHint || 'Unknown').trim()} (Instrumental)`
          : options.titleHint;
        const method = coerceInstrumentalVocalRemoverMethod(
          options.vocalRemoverAlgorithm ||
            this.currentSettings?.instrumentalVocalRemoverMethod ||
            undefined
        );
        // Prefer IPC-provided knobs; fall back to synced AppSettings by method.
        const isMdx = method === 'aiMdxKaraoke2';
        const isDemucs = method === 'aiHtDemucs';
        const isAi = isMdx || isDemucs;
        const totalCpus = Math.max(1, os.cpus()?.length || 1);
        const configuredThreads =
          options.aiCpuThreads !== undefined
            ? coerceAiCpuThreads(options.aiCpuThreads)
            : coerceAiCpuThreads(this.currentSettings?.aiCpuThreads);
        const aiEnableGpu = coerceAiEnableGpu(
          options.aiEnableGpu !== undefined
            ? options.aiEnableGpu
            : this.currentSettings?.aiEnableGpu
        );
        let aiGpuSupported = false;
        if (isAi && aiEnableGpu) {
          try {
            // Live Hidden Renderer probe (executeJavaScript) — not utilityProcess.
            const gpu = await probeGpuStatus();
            aiGpuSupported = gpu.isSupported === true || gpu.workerWebGpuAvailable === true;
            this.logger.info('Download', 'AI GPU probe for instrumental start', {
              aiEnableGpu,
              aiGpuSupported,
              workerWebGpuAvailable: gpu.workerWebGpuAvailable ?? null,
              hardwareGpuPresent: gpu.hardwareGpuPresent ?? null,
              workerOrtNote: gpu.workerOrtNote ?? null,
              gpuName: gpu.gpuName ?? null
            });
          } catch (err) {
            aiGpuSupported = false;
            this.logger.warn(
              'Download',
              `AI GPU probe failed — will re-probe at separate time: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }
        }
        return await this.downloadManager.startDownload({
          ...options,
          titleHint,
          instrumental,
          vocalRemoverAlgorithm: method,
          mdxSegmentSize: isMdx
            ? coerceMdxSegmentSize(
                options.mdxSegmentSize ?? this.currentSettings?.mdxSegmentSize
              )
            : undefined,
          mdxOverlap: isMdx
            ? coerceMdxOverlap(options.mdxOverlap ?? this.currentSettings?.mdxOverlap)
            : undefined,
          mdxEnableOrt: isMdx
            ? coerceMdxEnableOrt(options.mdxEnableOrt ?? this.currentSettings?.mdxEnableOrt)
            : undefined,
          demucsShifts: isDemucs
            ? coerceDemucsShifts(options.demucsShifts ?? this.currentSettings?.demucsShifts)
            : undefined,
          demucsSegmentSize: isDemucs
            ? coerceDemucsSegmentSize(
                options.demucsSegmentSize ?? this.currentSettings?.demucsSegmentSize
              )
            : undefined,
          demucsOverlap: isDemucs
            ? coerceDemucsOverlap(options.demucsOverlap ?? this.currentSettings?.demucsOverlap)
            : undefined,
          // AI paths (MDX + Demucs) get resolved thread count; DSP ignores it.
          aiCpuThreads: isAi ? resolveAiCpuThreads(configuredThreads, totalCpus) : undefined,
          aiEnableGpu: isAi ? aiEnableGpu : undefined,
          aiGpuSupported: isAi ? aiGpuSupported : undefined,
          libraryPath,
          catalogTracks
        });
      }
    );

    ipcMain.handle('download:cancel', (_event, downloadId: string) => {
      return this.downloadManager.cancelDownload(downloadId);
    });

    ipcMain.handle('download:cancel-all', () => {
      return this.downloadManager.cancelAllDownloads();
    });

    ipcMain.handle('download:find-existing', (_event, options: {
      url?: string;
      trackId?: string;
      title?: string;
      artist?: string;
      libraryPath?: string;
    }) => {
      const libraryPath =
        options.libraryPath?.trim() || this.currentSettings?.libraryPath?.trim() || undefined;
      let catalogTracks: KaraokeMediaTrack[] = [];
      try {
        catalogTracks = this.db.getAllTracks();
      } catch {
        catalogTracks = [];
      }
      return this.downloadManager.findExistingLocalMedia({
        ...options,
        libraryPath,
        catalogTracks
      });
    });

    ipcMain.handle('download:save-to-library', async (_event, payload: {
      tempFilePath: string;
      title: string;
      artist: string;
      durationSec: number;
      targetDirectory?: string;
      trackId?: string;
    }) => {
      const libraryDir =
        payload.targetDirectory?.trim() || this.currentSettings?.libraryPath?.trim() || '';
      if (!libraryDir) {
        throw new Error(
          'Percorso libreria non configurato. Imposta la cartella libreria nelle impostazioni prima di salvare.'
        );
      }
      const track = await this.downloadManager.saveToLibrary(payload.tempFilePath, libraryDir, {
        title: payload.title,
        artist: payload.artist,
        durationSec: payload.durationSec,
        trackId: payload.trackId
      });
      // Generate cover/thumb before upsert so Local library shows it without a manual refresh
      if (track.localFilePath && !track.thumbnailUrl) {
        const thumb = this.getOrGenerateThumbnail(track.localFilePath);
        if (thumb) track.thumbnailUrl = thumb;
      }
      this.db.upsertTrack(track);
      // Notify renderer windows to reindex/refresh library immediately
      this.scheduleLibraryReindexedNotify();
      return track;
    });

    ipcMain.handle('download:save-to-queue-cache', async (_event, payload: {
      tempFilePath: string;
      title: string;
      artist: string;
      durationSec: number;
    }) => {
      return await this.downloadManager.saveToQueueCache(payload.tempFilePath, payload);
    });

    ipcMain.handle('cache:delete-file', async (_event, filePath: string) => {
      return await this.downloadManager.deleteCachedFile(filePath);
    });

    ipcMain.handle('cache:cleanup-unreferenced', async (_event, activeFilePaths: string[]) => {
      return await this.downloadManager.cleanupUnreferencedCache(activeFilePaths);
    });

    // 8. Diagnostic Logging IPC Handlers
    ipcMain.on('logger:log', (_event, entry: { level: LogLevel; source: string; message: string; data?: unknown }) => {
      this.logger.log(entry.level, entry.source, entry.message, entry.data);
    });

    ipcMain.handle('logger:get-path', () => {
      return this.logger.getLogFilePath();
    });

    ipcMain.handle('logger:open-folder', async () => {
      await this.logger.openLogFolder();
      return { success: true };
    });

    ipcMain.handle('logger:open-file', async () => {
      await this.logger.openLogFile();
      return { success: true };
    });

    ipcMain.handle('logger:clear', async () => {
      const success = await this.logger.clearLogs();
      return { success };
    });

    ipcMain.handle('logger:set-level', (_event, level: LogLevel) => {
      this.logger.setLogLevel(level);
      return { success: true };
    });

    ipcMain.handle('logger:get-recent', async (_event, lines?: number) => {
      return await this.logger.getRecentLogs(lines);
    });

    ipcMain.handle('ytdlp:get-status', () => {
      return this.ytDlpUpdater.getStatus();
    });

    ipcMain.handle('ytdlp:check-update', async () => {
      return await this.ytDlpUpdater.checkForUpdates(true);
    });

    // Offline AI models for Download Instrumental (userData/models) — not live dual-stem
    ipcMain.handle('vocal-model:is-cached', async (_event, modelId: OfflineVocalModelId) => {
      if (!OFFLINE_VOCAL_MODELS[modelId]) return false;
      return this.vocalModelManager.isModelCached(modelId);
    });

    ipcMain.handle('vocal-model:ensure', async (_event, modelId: OfflineVocalModelId) => {
      if (!OFFLINE_VOCAL_MODELS[modelId]) {
        return { success: false, error: `Unknown vocal model id: ${modelId}` };
      }
      try {
        const modelPath = await this.vocalModelManager.ensureModel(modelId);
        return {
          success: true,
          modelPath,
          modelUrl: this.vocalModelManager.getModelFetchUrl(modelId)
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error('App', `vocal-model:ensure failed (${modelId}): ${message}`);
        return { success: false, error: message };
      }
    });

    ipcMain.handle('vocal-model:get-buffer', async (_event, modelId: OfflineVocalModelId) => {
      if (!OFFLINE_VOCAL_MODELS[modelId]) {
        return { success: false, error: `Unknown vocal model id: ${modelId}` };
      }
      try {
        const buffer = await this.vocalModelManager.readModelBuffer(modelId);
        return { success: true, buffer };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error('App', `vocal-model:get-buffer failed (${modelId}): ${message}`);
        return { success: false, error: message };
      }
    });

    ipcMain.handle('vocal-model:list', async () => {
      const entries = await Promise.all(
        Object.values(OFFLINE_VOCAL_MODELS).map(async (m) => ({
          id: m.id,
          label: m.label,
          approxSizeMb: m.approxSizeMb,
          filename: m.filename,
          version: m.version,
          cached: await this.vocalModelManager.isModelCached(m.id)
        }))
      );
      return entries;
    });

    ipcMain.handle('ort-wasm:ensure', async () => {
      try {
        const paths = await this.ortWasmManager.ensureOrtWasm();
        return { success: true, ...paths, assets: ORT_WASM_ASSET_FILES };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error('App', `ort-wasm:ensure failed: ${message}`);
        return { success: false, error: message };
      }
    });

    ipcMain.handle('ort-wasm:get-paths', async () => {
      try {
        const paths = await this.ortWasmManager.ensureOrtWasm();
        return { success: true, ...paths };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
      }
    });
  }

  /**
   * Recursively scans a filesystem directory (and all relative subfolders) for
   * karaoke files (.mp4, .webm, .mkv, .avi, .mp3+.cdg, .mid, .kar), extracts song
   * titles and artist names from filename patterns ("Artist - Title"), and
   * persists them to the SQLite library table. Discovery logic lives in
   * shared/libraryScanner so recursive coverage is unit-tested without Electron.
   *
   * Scan path is FFmpeg-free: reuses DB / disk cache thumbnails only, then batch-upserts
   * in one SQLite transaction. Missing video thumbs are filled by async backfill.
   *
   * @param folderPath - Library root directory path to scan
   * @returns Discovered tracks list
   */
  private scanFolder(folderPath: string): KaraokeMediaTrack[] {
    const discovered: KaraokeMediaTrack[] = [];
    const found = discoverLibraryMedia(folderPath);

    // Warm path: reuse thumbnailUrl already stored for the same local path (skip MD5/exists).
    const existingByPath = new Map<string, KaraokeMediaTrack>();
    try {
      for (const t of this.db.getAllTracks()) {
        if (t.localFilePath) {
          existingByPath.set(t.localFilePath.toLowerCase(), t);
        }
      }
    } catch (err) {
      this.logger.warn('LibraryScan', 'Failed loading existing catalog for thumb reuse', {
        error: String(err)
      });
    }

    const needThumbIds: string[] = [];

    for (const item of found) {
      const prev = existingByPath.get(item.absolutePath.toLowerCase());
      let thumb = prev?.thumbnailUrl;
      if (!thumb) {
        thumb = this.peekCachedThumbnail(item.absolutePath);
      }
      const track: KaraokeMediaTrack = {
        id: item.idHint,
        source: item.source,
        title: item.title,
        artist: item.artist,
        durationSec: 0,
        uri: buildKaraokeLocalUri(item.absolutePath),
        localFilePath: item.absolutePath,
        thumbnailUrl: thumb,
        hasEmbeddedLyrics: item.hasEmbeddedLyrics,
        isMultiplex: false,
        isEmbeddable: true,
        // Preserve prior async analysis across rescan upserts
        initialKey: prev?.initialKey,
        initialBpm: prev?.initialBpm
      };
      if (!thumb && track.localFilePath && this.isVideoThumbnailCandidate(track.localFilePath)) {
        needThumbIds.push(track.id);
      }
      discovered.push(track);
    }

    this.db.upsertTracksBatch(discovered);
    this.enqueueThumbnailBackfill(needThumbIds);
    // Background key/BPM — must not delay scan IPC return
    setImmediate(() => this.trackAnalysis.enqueueMany(discovered));
    return discovered;
  }

  /**
   * Drop zip_cache dirs for tracks that left the queue (dequeue / clear).
   * Safety-First: only touches temp/zip_cache via ZipCdgCache.
   */
  private releaseZipCacheForDequeued(prev: QueueItem[], next: QueueItem[]): void {
    try {
      const nextIds = new Set(next.map((q) => q.track.id));
      for (const item of prev) {
        const lp = item.track.localFilePath || '';
        if (!lp.toLowerCase().endsWith('.zip')) continue;
        if (!nextIds.has(item.track.id)) {
          this.zipCdgCache.releaseTrack(item.track.id);
        }
      }
    } catch (err) {
      this.logger.warn('ZipCdg', 'releaseZipCacheForDequeued failed', err);
    }
  }

  /** True when the file extension can yield an FFmpeg frame thumbnail. */
  private isVideoThumbnailCandidate(localFilePath: string): boolean {
    const ext = path.extname(localFilePath).toLowerCase();
    return ext === '.mp4' || ext === '.webm' || ext === '.mkv' || ext === '.avi';
  }

  /** Absolute JPEG path under userData/thumbnails for a media file (MD5 of path). */
  private thumbnailCacheFilePath(localFilePath: string): string {
    const thumbsDir = path.join(app.getPath('userData'), 'thumbnails');
    const hash = crypto.createHash('md5').update(localFilePath).digest('hex');
    return path.join(thumbsDir, `${hash}.jpg`);
  }

  /**
   * Returns a karaoke:// URI if a thumbnail JPEG already exists on disk — never runs FFmpeg.
   * Used by library scan so cold catalogs do not ANR the main process.
   */
  private peekCachedThumbnail(localFilePath: string): string | undefined {
    try {
      if (!this.isVideoThumbnailCandidate(localFilePath)) return undefined;
      const thumbPath = this.thumbnailCacheFilePath(localFilePath);
      if (fs.existsSync(thumbPath)) {
        return buildKaraokeLocalUri(thumbPath);
      }
    } catch (err) {
      this.logger.warn('Thumbnail', 'Failed peeking cached thumbnail', {
        localFilePath,
        error: String(err)
      });
    }
    return undefined;
  }

  /**
   * Ensures userData/thumbnails exists and returns the target JPEG path for generation.
   */
  private ensureThumbnailOutputPath(localFilePath: string): string | undefined {
    if (!this.isVideoThumbnailCandidate(localFilePath)) return undefined;
    if (!fs.existsSync(localFilePath)) return undefined;
    const thumbsDir = path.join(app.getPath('userData'), 'thumbnails');
    if (!fs.existsSync(thumbsDir)) {
      fs.mkdirSync(thumbsDir, { recursive: true });
    }
    return this.thumbnailCacheFilePath(localFilePath);
  }

  /**
   * Import absolute media paths (OS drag-and-drop) into the SQLite catalog.
   *
   * Why: multi-drop must stay responsive — reuse #46 scan pattern: peek cached
   * thumbs only on the hot path, batch upsert, then async FFmpeg backfill.
   * Does not alter scanFolder behavior.
   *
   * @param filePaths - Absolute filesystem paths from the renderer
   * @returns Catalogued tracks (cached thumbs when present; missing video thumbs backfilled async)
   */
  private async importFiles(filePaths: string[]): Promise<KaraokeMediaTrack[]> {
    const found = discoverLibraryFilesFromPaths(filePaths);
    if (!found.length) return [];

    // Targeted path lookup — never dump the full catalog for a small drop.
    const existingByPath = new Map<string, KaraokeMediaTrack>();
    try {
      const paths = found.map((f) => f.absolutePath);
      for (const t of this.db.getTracksByLocalPaths(paths)) {
        if (t.localFilePath) {
          existingByPath.set(t.localFilePath.toLowerCase(), t);
        }
      }
    } catch (err) {
      this.logger.warn('LibraryImport', 'Failed loading existing catalog for thumb reuse', {
        error: String(err)
      });
    }

    const needThumbIds: string[] = [];
    const tracks: KaraokeMediaTrack[] = [];

    for (const item of found) {
      const prev = existingByPath.get(item.absolutePath.toLowerCase());
      let thumb = prev?.thumbnailUrl;
      if (!thumb) {
        thumb = this.peekCachedThumbnail(item.absolutePath);
      }
      const track: KaraokeMediaTrack = {
        id: item.idHint,
        source: item.source,
        title: item.title,
        artist: item.artist,
        durationSec: 0,
        uri: buildKaraokeLocalUri(item.absolutePath),
        localFilePath: item.absolutePath,
        thumbnailUrl: thumb,
        hasEmbeddedLyrics: item.hasEmbeddedLyrics,
        isMultiplex: false,
        isEmbeddable: true,
        initialKey: prev?.initialKey,
        initialBpm: prev?.initialBpm
      };
      if (!thumb && track.localFilePath && this.isVideoThumbnailCandidate(track.localFilePath)) {
        needThumbIds.push(track.id);
      }
      tracks.push(track);
    }

    this.db.upsertTracksBatch(tracks);
    this.enqueueThumbnailBackfill(needThumbIds);
    setImmediate(() => this.trackAnalysis.enqueueMany(tracks));
    return tracks;
  }

  /**
   * Generates or retrieves a cached video thumbnail for local video tracks (.mp4, .webm).
   * Extracts a frame at 4 seconds (where the intro/karaoke title card typically resides)
   * using ffmpeg, scaling down to 320px width.
   *
   * Sync path kept for single-file flows (e.g. download:save-to-library). Library scan
   * must not call this — use peekCachedThumbnail + enqueueThumbnailBackfill instead.
   *
   * @param localFilePath - Physical path to video file
   * @returns karaoke://local/... URI to the cached JPEG thumbnail, or undefined
   */
  private getOrGenerateThumbnail(localFilePath: string): string | undefined {
    try {
      const cached = this.peekCachedThumbnail(localFilePath);
      if (cached) return cached;

      const thumbPath = this.ensureThumbnailOutputPath(localFilePath);
      if (!thumbPath) return undefined;

      const ffmpegBin = resolveFfmpegPath();

      // Try extraction at 4 seconds first (karaoke intro title card)
      try {
        execFileSync(
          ffmpegBin,
          [
            '-y',
            '-ss',
            '00:00:04',
            '-i',
            localFilePath,
            '-frames:v',
            '1',
            '-q:v',
            '3',
            '-vf',
            'scale=320:-1',
            thumbPath
          ],
          { timeout: 4000, stdio: 'ignore' }
        );

        if (fs.existsSync(thumbPath)) {
          return buildKaraokeLocalUri(thumbPath);
        }
      } catch {
        // If 4s failed (e.g. short file), try at 1 second
        try {
          execFileSync(
            ffmpegBin,
            [
              '-y',
              '-ss',
              '00:00:01',
              '-i',
              localFilePath,
              '-frames:v',
              '1',
              '-q:v',
              '3',
              '-vf',
              'scale=320:-1',
              thumbPath
            ],
            { timeout: 4000, stdio: 'ignore' }
          );

          if (fs.existsSync(thumbPath)) {
            return buildKaraokeLocalUri(thumbPath);
          }
        } catch {
          // ffmpeg unavailable or video decode error
        }
      }
    } catch (err) {
      this.logger.warn('Thumbnail', 'Failed to generate thumbnail', { localFilePath, error: String(err) });
    }
    return undefined;
  }

  /**
   * Async FFmpeg thumbnail generation (non-blocking). Used by background backfill after scan.
   */
  private generateThumbnailAsync(localFilePath: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      try {
        const cached = this.peekCachedThumbnail(localFilePath);
        if (cached) {
          resolve(cached);
          return;
        }
        const thumbPath = this.ensureThumbnailOutputPath(localFilePath);
        if (!thumbPath) {
          resolve(undefined);
          return;
        }
        const ffmpegBin = resolveFfmpegPath();
        const argsAt = (ss: string) => [
          '-y',
          '-ss',
          ss,
          '-i',
          localFilePath,
          '-frames:v',
          '1',
          '-q:v',
          '3',
          '-vf',
          'scale=320:-1',
          thumbPath
        ];

        execFile(ffmpegBin, argsAt('00:00:04'), { timeout: 4000 }, (err) => {
          if (!err && fs.existsSync(thumbPath)) {
            resolve(buildKaraokeLocalUri(thumbPath));
            return;
          }
          execFile(ffmpegBin, argsAt('00:00:01'), { timeout: 4000 }, (err2) => {
            if (!err2 && fs.existsSync(thumbPath)) {
              resolve(buildKaraokeLocalUri(thumbPath));
              return;
            }
            resolve(undefined);
          });
        });
      } catch (err) {
        this.logger.warn('Thumbnail', 'Async thumbnail generation failed', {
          localFilePath,
          error: String(err)
        });
        resolve(undefined);
      }
    });
  }

  /**
   * Queues track ids for async thumbnail backfill (deduped). Starts the pump if idle.
   */
  private enqueueThumbnailBackfill(trackIds: string[]): void {
    if (!trackIds.length) return;
    const seen = new Set(this.thumbnailBackfillQueue);
    for (const id of trackIds) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      this.thumbnailBackfillQueue.push(id);
    }
    this.pumpThumbnailBackfill();
  }

  /**
   * Processes one pending thumbnail at a time via async FFmpeg so the main process stays responsive.
   */
  private pumpThumbnailBackfill(): void {
    if (this.thumbnailBackfillRunning) return;
    this.thumbnailBackfillRunning = true;

    const step = () => {
      const id = this.thumbnailBackfillQueue.shift();
      if (!id) {
        this.thumbnailBackfillRunning = false;
        // Queue drained — allow a single throttled full reindex if anything still pending.
        if (this.pendingTrackUpdates.size) {
          // Flush coalesced patches immediately on drain.
          if (this.libraryTrackUpdateTimer) {
            clearTimeout(this.libraryTrackUpdateTimer);
            this.libraryTrackUpdateTimer = null;
          }
          const batch = Array.from(this.pendingTrackUpdates.values());
          this.pendingTrackUpdates.clear();
          if (batch.length && this.controlWindow && !this.controlWindow.isDestroyed()) {
            this.controlWindow.webContents.send('library:track-updated', batch);
          }
        }
        return;
      }

      const track = this.db.getTrackById(id);
      if (
        !track?.localFilePath ||
        track.thumbnailUrl ||
        !this.isVideoThumbnailCandidate(track.localFilePath) ||
        this.thumbnailBackfillAttempted.has(track.localFilePath)
      ) {
        setImmediate(step);
        return;
      }

      this.thumbnailBackfillAttempted.add(track.localFilePath);
      void this.generateThumbnailAsync(track.localFilePath).then((thumb) => {
        try {
          if (thumb) {
            track.thumbnailUrl = thumb;
            this.db.upsertTrack(track);
            // Patch Local list in-place — do not dump getAllTracks every 750ms.
            this.scheduleLibraryTrackUpdatedNotify(track);
          }
        } catch (err) {
          this.logger.warn('Thumbnail', 'Failed persisting async thumbnail', {
            id,
            error: String(err)
          });
        }
        setImmediate(step);
      });
    };

    setImmediate(step);
  }

  /**
   * Coalesce thumbnail/key patches onto the Control window without a full reindex.
   */
  private scheduleLibraryTrackUpdatedNotify(track: KaraokeMediaTrack): void {
    this.pendingTrackUpdates.set(track.id, track);
    if (this.libraryTrackUpdateTimer) return;
    this.libraryTrackUpdateTimer = setTimeout(() => {
      this.libraryTrackUpdateTimer = null;
      const batch = Array.from(this.pendingTrackUpdates.values());
      this.pendingTrackUpdates.clear();
      if (!batch.length) return;
      if (this.controlWindow && !this.controlWindow.isDestroyed()) {
        this.controlWindow.webContents.send('library:track-updated', batch);
      }
    }, 200);
  }

  /**
   * Throttled library:reindexed — used for one-shot saves; thumb backfill uses track-updated.
   * Skips while async thumb queue is still pumping to avoid the 750ms full-catalog storm.
   */
  private scheduleLibraryReindexedNotify(): void {
    if (this.libraryReindexNotifyTimer) return;
    this.libraryReindexNotifyTimer = setTimeout(() => {
      this.libraryReindexNotifyTimer = null;
      if (this.thumbnailBackfillQueue.length || this.thumbnailBackfillRunning) return;
      if (this.controlWindow && !this.controlWindow.isDestroyed()) {
        this.controlWindow.webContents.send('library:reindexed');
      }
    }, 750);
  }

  /**
   * Enqueues missing video thumbnails for async generation (startup / after scan).
   * Does not block the main thread with execFileSync loops.
   */
  private ensureLocalThumbnails(): void {
    try {
      const needIds: string[] = [];
      for (const t of this.db.getTracksMissingThumbnails()) {
        if (t.localFilePath && this.isVideoThumbnailCandidate(t.localFilePath)) {
          needIds.push(t.id);
        }
      }
      this.enqueueThumbnailBackfill(needIds);
    } catch (err) {
      this.logger.warn('Thumbnail', 'Error ensuring local thumbnails', { error: String(err) });
    }
  }

  /**
   * Kills any in-flight yt-dlp web search. Safe when idle (returns false).
   */
  private cancelYouTubeSearch(): boolean {
    const child = this.youtubeSearchChild;
    if (!child) return false;
    this.youtubeSearchCancelled = true;
    this.logger.info('YouTube', 'Cancelling in-flight web search');
    killProcessTree(child);
    this.youtubeSearchChild = null;
    return true;
  }

  /**
   * Performs an asynchronous YouTube search query using yt-dlp metadata extraction.
   * Appends 'karaoke' to the query to prioritize instrumental/backing video results.
   *
   * @param query - Search term entered by user
   * @returns Array of YouTube media track candidates (empty if cancelled or failed)
   */
  private searchYouTube(
    query: string,
    options?: { offset?: number; limit?: number }
  ): Promise<KaraokeMediaTrack[]> {
    return new Promise((resolve) => {
      // One search at a time: abort any previous yt-dlp so UI cannot stick forever.
      if (this.youtubeSearchChild) {
        this.cancelYouTubeSearch();
      }

      const sanitizedQuery = `${query.trim()} karaoke`;
      const pageSize =
        typeof options?.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
          ? Math.min(50, Math.floor(options.limit))
          : 10;
      const offset =
        typeof options?.offset === 'number' && Number.isFinite(options.offset) && options.offset > 0
          ? Math.floor(options.offset)
          : 0;
      const playlistEnd = offset + pageSize;
      const { spawn } = require('child_process');
      const ytdlpPath = resolveYtDlpPath();

      this.youtubeSearchCancelled = false;
      let child: ChildProcess;
      try {
        // yt-dlp search is a synthetic playlist of N items; window with playlist-start/end.
        child = spawn(
          ytdlpPath,
          [
            `ytsearch${playlistEnd}:${sanitizedQuery}`,
            '--playlist-start',
            String(offset + 1),
            '--playlist-end',
            String(playlistEnd),
            '--dump-json',
            '--flat-playlist',
            '--no-warnings'
          ],
          {
            stdio: ['ignore', 'pipe', 'pipe'],
            // Own process group on Unix so cancel can SIGKILL the tree cleanly.
            detached: process.platform !== 'win32'
          }
        );
      } catch (spawnErr) {
        this.logger.warn('YouTube', `yt-dlp could not be spawned at "${ytdlpPath}".`, { error: String(spawnErr) });
        resolve([]);
        return;
      }

      this.youtubeSearchChild = child;
      let stdout = '';
      let settled = false;
      const finish = (tracks: KaraokeMediaTrack[]) => {
        if (settled) return;
        settled = true;
        if (this.youtubeSearchChild === child) {
          this.youtubeSearchChild = null;
        }
        resolve(tracks);
      };

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });

      child.on('close', (code: number | null) => {
        if (this.youtubeSearchCancelled) {
          finish([]);
          return;
        }
        if (code !== 0 || !stdout.trim()) {
          finish([]);
          return;
        }

        const tracks: KaraokeMediaTrack[] = [];
        const lines = stdout.split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            let thumbnailUrl: string | undefined = undefined;
            if (data.thumbnails && Array.isArray(data.thumbnails) && data.thumbnails.length > 0) {
              thumbnailUrl = data.thumbnails[0].url;
            } else if (data.thumbnail) {
              thumbnailUrl = data.thumbnail;
            } else if (data.id) {
              thumbnailUrl = `https://i.ytimg.com/vi/${data.id}/mqdefault.jpg`;
            }

            tracks.push({
              id: data.id || `yt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              source: 'youtube',
              title: data.title || 'Unknown Title',
              artist: data.uploader || data.channel || 'YouTube',
              durationSec: data.duration || 0,
              uri: data.webpage_url || data.url || `https://www.youtube.com/watch?v=${data.id}`,
              thumbnailUrl,
              isEmbeddable: true
            });
          } catch {
            // Ignore malformed JSON line
          }
        }

        finish(tracks);
      });

      child.on('error', (err: Error) => {
        if (!this.youtubeSearchCancelled) {
          this.logger.warn('YouTube', `yt-dlp execution error: ${err.message}`, { error: String(err) });
        }
        finish([]);
      });
    });
  }

  /**
   * Subscribes to the DownloadManager progress stream and forwards events to the renderer window.
   */
  private setupDownloadBridge(): void {
    this.downloadManager.subscribeProgress((payload) => {
      if (this.controlWindow && !this.controlWindow.isDestroyed()) {
        this.controlWindow.webContents.send('download:progress', payload);
      }
    });
  }
}

// Enforce Single Application Instance Lock
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  new KaraokeMainProcess();
}
