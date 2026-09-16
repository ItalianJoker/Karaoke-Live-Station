import { app, BrowserWindow, ipcMain, protocol, dialog, Menu, shell, session } from 'electron';
import path from 'path';
import fs from 'fs';
import { Readable } from 'stream';
import { execFileSync } from 'child_process';
import crypto from 'crypto';
import { DatabaseManager } from './db/database';
import { GuestPortalServer } from './server/guestServer';
import { DownloadManager } from './services/DownloadManager';
import { Logger } from './services/Logger';
import { resolveFfmpegPath, resolveYtDlpPath } from './services/BinaryResolver';
import { YtDlpUpdater } from './services/YtDlpUpdater';
import { FirewallHelper } from './services/FirewallHelper';
import {
  ActivePlaybackState,
  AppSettings,
  KaraokeMediaTrack,
  QueueItem,
  GuestSongRequest,
  LogLevel
} from '../shared/types';

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
 * Searches common system directories for a default General MIDI SoundFont bank (.sf2 or .dls).
 * Provides zero-configuration MIDI/KAR playback out-of-the-box.
 *
 * @returns Absolute path to a valid system SoundFont bank if found, otherwise null
 */
function getDefaultSystemSoundFont(): string | null {
  // 1. Prioritize bundled GeneralUser GS SoundFont for pristine out-of-the-box MIDI/KAR playback
  const appPath = app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath();
  const bundledCandidates = [
    path.join(app.getAppPath(), 'public/soundfonts/GeneralUser-GS.sf2'),
    path.join(app.getAppPath(), 'dist/soundfonts/GeneralUser-GS.sf2'),
    path.join(process.resourcesPath || '', 'soundfonts/GeneralUser-GS.sf2'),
    path.join(appPath, 'soundfonts/GeneralUser-GS.sf2'),
    path.join(process.cwd(), 'public/soundfonts/GeneralUser-GS.sf2')
  ];

  for (const bCandidate of bundledCandidates) {
    try {
      if (bCandidate && fs.existsSync(bCandidate)) {
        return bCandidate;
      }
    } catch {
      // Check next candidate
    }
  }

  // 2. System fallbacks if bundled bank is missing
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
  private guestServer: GuestPortalServer | null = null;
  private currentMasterState: ActivePlaybackState | null = null;
  private currentQueue: QueueItem[] = [];
  private currentSettings: AppSettings | null = null;

  constructor() {
    const userDataPath = app.getPath('userData');
    const tempDownloadDir = path.join(userDataPath, 'temp');
    const queueCacheDir = path.join(userDataPath, 'queue_cache');

    this.logger = new Logger(userDataPath, 'info');
    this.setupGlobalAnomalyHandlers();

    this.db = new DatabaseManager(userDataPath);
    this.downloadManager = new DownloadManager(tempDownloadDir, queueCacheDir);
    this.ytDlpUpdater = new YtDlpUpdater(userDataPath, this.logger);

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
          // Format expected: karaoke://local/path/to/media.mp4
          if (url.hostname === 'local') {
            const rawPath = decodeURIComponent(url.pathname);
            // On Windows pathname starts with /C:/... so trim leading slash if needed
            const filePath =
              process.platform === 'win32' && rawPath.startsWith('/')
                ? rawPath.slice(1)
                : rawPath;

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
      if (this.guestServer) {
        await this.guestServer.stop();
      }
      this.downloadManager.cleanupTempFiles();
      this.db.close();
    });

    app.whenReady().then(async () => {
      Menu.setApplicationMenu(null);
      this.setupYouTubeEmbedReferer();
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
   * Initializes the primary Control Window (Regia) and Stage Window (Palco).
   */
  private async initWindows(): Promise<void> {
    const preloadPath = path.join(__dirname, '../preload/index.js');

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

    // 2. Create Stage Window (Slave / View)
    this.createStageWindow(preloadPath);

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
      this.logger.info('ControlWindow', 'Control window closed');
      this.controlWindow = null;
      if (this.stageWindow) {
        this.stageWindow.close();
      }
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
        if (this.currentSettings.logLevel) {
          this.logger.setLogLevel(this.currentSettings.logLevel);
        }
      }
      if (command.action === 'sync:queue' && command.payload) {
        this.currentQueue = command.payload as QueueItem[];
      }
      if (this.stageWindow && !this.stageWindow.isDestroyed()) {
        this.stageWindow.webContents.send('playback:command', command);
      }
    });

    ipcMain.on('queue:update-cache', (_event, queue: QueueItem[]) => {
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

    // 4b. System Defaults
    ipcMain.handle('system:get-default-soundfont', () => {
      return getDefaultSystemSoundFont();
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
        if (!resolvedSoundFont || !fs.existsSync(resolvedSoundFont)) {
          resolvedSoundFont = getDefaultSystemSoundFont() || '';
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

    ipcMain.handle('search:youtube', async (_event, query: string) => {
      return this.searchYouTube(query);
    });

    ipcMain.handle('library:get-track-thumbnail', (_event, filePath: string) => {
      return this.getOrGenerateThumbnail(filePath);
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
        return await this.downloadManager.startDownload({
          ...options,
          libraryPath,
          catalogTracks
        });
      }
    );

    ipcMain.handle('download:cancel', (_event, downloadId: string) => {
      return this.downloadManager.cancelDownload(downloadId);
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
      if (this.controlWindow && !this.controlWindow.isDestroyed()) {
        this.controlWindow.webContents.send('library:reindexed');
      }
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
  }

  /**
   * Recursively scans a filesystem directory for karaoke files (.mp4, .webm, .mp3+.cdg, .mid, .kar),
   * extracts song titles and artist names from filename patterns ("Artist - Title"),
   * and persists them to the SQLite library table.
   *
   * @param folderPath - Directory path to scan
   * @returns Discovered tracks list
   */
  private scanFolder(folderPath: string): KaraokeMediaTrack[] {
    const discovered: KaraokeMediaTrack[] = [];
    if (!fs.existsSync(folderPath)) return discovered;

    const walk = (dir: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const filesMap = new Map<string, string[]>();

        for (const entry of entries) {
          if (entry.isDirectory()) {
            walk(path.join(dir, entry.name));
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            const base = path.basename(entry.name, ext);
            if (!filesMap.has(base)) filesMap.set(base, []);
            filesMap.get(base)!.push(ext);
          }
        }

        for (const [baseName, exts] of filesMap.entries()) {
          // Skip incomplete / in-progress download artifacts
          const incompleteExt = exts.some((e) =>
            ['.part', '.ytdl', '.temp', '.tmp', '.download', '.crdownload'].includes(e)
          );
          if (incompleteExt || /\.part$/i.test(baseName)) {
            continue;
          }

          const hasCdg = exts.includes('.cdg');
          const hasMp3 = exts.includes('.mp3');
          const hasMp4 = exts.includes('.mp4');
          const hasWebm = exts.includes('.webm');
          const hasMid = exts.includes('.mid');
          const hasKar = exts.includes('.kar');

          let source: KaraokeMediaTrack['source'] = 'local_library';
          let targetExt = '';

          if (hasMid || hasKar) {
            source = 'midi';
            targetExt = hasKar ? '.kar' : '.mid';
          } else if (hasMp4) {
            targetExt = '.mp4';
          } else if (hasWebm) {
            targetExt = '.webm';
          } else if (hasMp3) {
            targetExt = '.mp3';
          }

          if (targetExt) {
            const fullFilePath = path.join(dir, `${baseName}${targetExt}`);

            // Ignore zero-byte / tiny incomplete files
            try {
              const st = fs.statSync(fullFilePath);
              if (!st.isFile() || st.size < 2048) continue;
            } catch {
              continue;
            }

            // Prefer stable YouTube id when filename is `${youtubeId}_Artist - Title`
            const ytPrefix = baseName.match(/^([\w-]{11})_(.+)$/);
            const stableYtId = ytPrefix ? ytPrefix[1] : null;
            const nameForMeta = ytPrefix ? ytPrefix[2] : baseName;
            const parts = nameForMeta.split(' - ');
            const artist = parts.length > 1 ? parts[0].trim() : 'Unknown Artist';
            const title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : nameForMeta.trim();

            const thumb = this.getOrGenerateThumbnail(fullFilePath);

            const track: KaraokeMediaTrack = {
              id: stableYtId || `track_${Buffer.from(fullFilePath).toString('base64url')}`,
              source,
              title,
              artist,
              durationSec: 0,
              uri: `karaoke://local/${encodeURIComponent(fullFilePath)}`,
              localFilePath: fullFilePath,
              thumbnailUrl: thumb,
              hasEmbeddedLyrics: hasCdg || hasKar,
              isMultiplex: false,
              isEmbeddable: true
            };

            this.db.upsertTrack(track);
            discovered.push(track);
          }
        }
      } catch (err) {
        console.warn(`Error scanning directory ${dir}:`, err);
      }
    };

    walk(folderPath);
    return discovered;
  }

  /**
   * Generates or retrieves a cached video thumbnail for local video tracks (.mp4, .webm).
   * Extracts a frame at 4 seconds (where the intro/karaoke title card typically resides)
   * using ffmpeg, scaling down to 320px width.
   *
   * @param localFilePath - Physical path to video file
   * @returns karaoke://local/... URI to the cached JPEG thumbnail, or undefined
   */
  private getOrGenerateThumbnail(localFilePath: string): string | undefined {
    try {
      const ext = path.extname(localFilePath).toLowerCase();
      if (ext !== '.mp4' && ext !== '.webm' && ext !== '.mkv' && ext !== '.avi') {
        return undefined;
      }

      if (!fs.existsSync(localFilePath)) return undefined;

      const thumbsDir = path.join(app.getPath('userData'), 'thumbnails');
      if (!fs.existsSync(thumbsDir)) {
        fs.mkdirSync(thumbsDir, { recursive: true });
      }

      const hash = crypto.createHash('md5').update(localFilePath).digest('hex');
      const thumbFileName = `${hash}.jpg`;
      const thumbPath = path.join(thumbsDir, thumbFileName);

      if (fs.existsSync(thumbPath)) {
        return `karaoke://local/${encodeURIComponent(thumbPath)}`;
      }

      const ffmpegBin = resolveFfmpegPath();

      // Try extraction at 4 seconds first (karaoke intro title card)
      try {
        execFileSync(ffmpegBin, [
          '-y',
          '-ss', '00:00:04',
          '-i', localFilePath,
          '-frames:v', '1',
          '-q:v', '3',
          '-vf', 'scale=320:-1',
          thumbPath
        ], { timeout: 4000, stdio: 'ignore' });

        if (fs.existsSync(thumbPath)) {
          return `karaoke://local/${encodeURIComponent(thumbPath)}`;
        }
      } catch {
        // If 4s failed (e.g. short file), try at 1 second
        try {
          execFileSync(ffmpegBin, [
            '-y',
            '-ss', '00:00:01',
            '-i', localFilePath,
            '-frames:v', '1',
            '-q:v', '3',
            '-vf', 'scale=320:-1',
            thumbPath
          ], { timeout: 4000, stdio: 'ignore' });

          if (fs.existsSync(thumbPath)) {
            return `karaoke://local/${encodeURIComponent(thumbPath)}`;
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
   * Scans existing library database tracks and asynchronously ensures cached thumbnails
   * exist for all local video files.
   */
  private ensureLocalThumbnails(): void {
    try {
      const allTracks = this.db.getAllTracks();
      for (const t of allTracks) {
        if (!t.thumbnailUrl && t.localFilePath && (t.source === 'local_library' || t.source === 'youtube')) {
          const thumb = this.getOrGenerateThumbnail(t.localFilePath);
          if (thumb) {
            t.thumbnailUrl = thumb;
            this.db.upsertTrack(t);
          }
        }
      }
    } catch (err) {
      this.logger.warn('Thumbnail', 'Error ensuring local thumbnails', { error: String(err) });
    }
  }

  /**
   * Performs an asynchronous YouTube search query using yt-dlp metadata extraction.
   * Appends 'karaoke' to the query to prioritize instrumental/backing video results.
   *
   * @param query - Search term entered by user
   * @returns Array of YouTube media track candidates
   */
  private searchYouTube(query: string): Promise<KaraokeMediaTrack[]> {
    return new Promise((resolve) => {
      const sanitizedQuery = `${query.trim()} karaoke`;
      const { spawn } = require('child_process');
      const ytdlpPath = resolveYtDlpPath();

      let child: any;
      try {
        child = spawn(ytdlpPath, [
          `ytsearch10:${sanitizedQuery}`,
          '--dump-json',
          '--flat-playlist',
          '--no-warnings'
        ]);
      } catch (spawnErr) {
        this.logger.warn('YouTube', `yt-dlp could not be spawned at "${ytdlpPath}".`, { error: String(spawnErr) });
        resolve([]);
        return;
      }

      let stdout = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });

      child.on('close', (code: number) => {
        if (code !== 0 || !stdout.trim()) {
          resolve([]);
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

        resolve(tracks);
      });

      child.on('error', (err: any) => {
        this.logger.warn('YouTube', `yt-dlp execution error: ${err.message}`, { error: String(err) });
        resolve([]);
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
