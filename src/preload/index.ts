import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import {
  ActivePlaybackState,
  KaraokeMediaTrack,
  QueueItem,
  SingerProfile,
  DownloadProgressPayload,
  ExistingLocalMedia,
  StartDownloadResult,
  GuestSongRequest,
  AppSettings,
  LogLevel,
  YtDlpStatus,
  FirewallCheckResult,
  SiaeLogEntry
} from '../shared/types';

/**
 * Secure IPC Bridge contract exposed to the renderer window via contextBridge.
 * Enforces isolation between Node.js / Electron APIs and React UI components.
 */
export interface KaraokeAPI {
  // 1. Playback State Synchronization (Master <-> Main <-> Slave)
  /** Broadcasts master playback state from Control Window to Main and Stage windows */
  sendStateSync: (state: ActivePlaybackState) => void;
  /** Subscribes to real-time playback state broadcasts */
  onStateSync: (callback: (state: ActivePlaybackState) => void) => () => void;
  /** Sends an arbitrary control action command (e.g. sync:queue, sync:settings) */
  sendCommand: (action: string, payload?: unknown) => void;
  /** Subscribes to command dispatches from the Main process */
  onCommand: (callback: (command: { action: string; payload?: unknown }) => void) => () => void;
  /** Emits an updated queue cache for immediate LAN guest portal synchronization */
  syncQueueCache: (queue: QueueItem[]) => void;

  // 2. Window Management & Auto-Recovery
  /** Fetches current state snapshot upon Stage window bootstrap or reconnection */
  getStageInitialState: () => Promise<{ playback: ActivePlaybackState | null; queue: QueueItem[]; settings: AppSettings | null }>;
  /** Reopens or focuses the Stage window if closed */
  reopenStageWindow: () => Promise<{ success: boolean }>;
  /** Toggles Stage window full-screen mode on secondary monitor */
  toggleStageFullscreen: () => Promise<{ isFullScreen: boolean }>;
  /** Listens for Stage window open/close status changes */
  onStageStatusChange: (callback: (status: { isOpen: boolean }) => void) => () => void;
  /** Listens for Stage window renderer crash notifications */
  onStageCrashed: (callback: (details: unknown) => void) => () => void;
  /** Signals that Stage window DOM, styles, and state are fully loaded and ready for rendering */
  signalStageReady: () => void;

  // 3. SQLite Database Operations
  db: {
    /** Retrieves all catalog tracks */
    getTracks: () => Promise<KaraokeMediaTrack[]>;
    /** Inserts or updates a catalog track */
    upsertTrack: (track: KaraokeMediaTrack) => Promise<{ success: boolean }>;
    /** Retrieves all registered singers ordered by priority */
    getAllSingers: () => Promise<SingerProfile[]>;
    /** Retrieves or registers a singer by name */
    getOrCreateSinger: (name: string) => Promise<SingerProfile>;
    /** Toggles permanent favorite pin for a singer */
    setSingerPermanent: (singerId: string, isPermanent: boolean) => Promise<{ success: boolean }>;
    /** Deletes a singer from the database */
    deleteSinger: (singerId: string) => Promise<{ success: boolean }>;
    /** Updates a singer's remembered pitch offset in semitones */
    updateSingerPitch: (singerId: string, pitchOffset: number) => Promise<{ success: boolean }>;
    /** Increments performance counter for a singer */
    incrementSingerCount: (singerId: string) => Promise<{ success: boolean }>;
    /** Logs an executed track performance for copyright reporting */
    logSiae: (log: { title: string; artist: string; singer?: string; durationSec: number; executedAt?: number | string }) => Promise<{ success: boolean }>;
  };

  // 4. Library Scanner & YouTube Search
  library: {
    /** Scans a local filesystem folder for media files */
    scanFolder: (folderPath: string) => Promise<KaraokeMediaTrack[]>;
    /** Searches YouTube for karaoke backing tracks */
    searchYouTube: (query: string) => Promise<KaraokeMediaTrack[]>;
    /** Generates or retrieves a cached video thumbnail for a local video file */
    getTrackThumbnail: (filePath: string) => Promise<string | undefined>;
  };

  // 5. SIAE Reporting
  siae: {
    /** Retrieves historical execution logs */
    getLogs: () => Promise<SiaeLogEntry[]>;
    /** Exports execution logs to a user-selected CSV file */
    exportCsv: () => Promise<{ success: boolean; filePath?: string }>;
    /** Clears all historical performance logs from the persistent database */
    clearLogs: () => Promise<{ success: boolean }>;
  };

  // 6. Download Engine Bridge
  downloads: {
    /** Starts downloading a video or audio stream via yt-dlp (or reuses a local copy) */
    start: (options: {
      url: string;
      isAudioOnly?: boolean;
      titleHint?: string;
      artistHint?: string;
      trackId?: string;
      libraryPath?: string;
    }) => Promise<StartDownloadResult>;
    /** Cancels an ongoing download process */
    cancel: (downloadId: string) => Promise<boolean>;
    /** Looks up an existing local library/cache copy before downloading */
    findExisting: (options: {
      url?: string;
      trackId?: string;
      title?: string;
      artist?: string;
      libraryPath?: string;
    }) => Promise<ExistingLocalMedia | null>;
    /** Moves a downloaded file into the user's permanent karaoke library */
    saveToLibrary: (payload: {
      tempFilePath: string;
      title: string;
      artist: string;
      durationSec: number;
      targetDirectory?: string;
      trackId?: string;
    }) => Promise<KaraokeMediaTrack>;
    /** Moves a downloaded file into the persistent queue cache */
    saveToQueueCache: (payload: {
      tempFilePath: string;
      title: string;
      artist: string;
      durationSec: number;
      trackId?: string;
    }) => Promise<{ localFilePath: string; uri: string }>;
    /** Deletes a cached file from disk when dequeued */
    deleteCachedFile: (filePath: string) => Promise<{ success: boolean }>;
    /** Purges orphaned cache files not referenced in active queue */
    cleanupUnreferencedCache: (activeFilePaths: string[]) => Promise<{ deletedCount: number }>;
    /** Subscribes to live download progress updates */
    onProgress: (callback: (payload: DownloadProgressPayload) => void) => () => void;
    /** Subscribes to library reindex notifications after saves */
    onLibraryReindexed: (callback: () => void) => () => void;
  };

  // 7. Guest Portal & Requests
  guestPortal: {
    /** Retrieves current guest portal network URL, actual port, IP, and base64 QR code */
    getInfo: () => Promise<{ enabled: boolean; url: string; qrCode: string; port?: number; ip?: string }>;
    /** Listens for incoming smartphone song requests */
    onRequestReceived: (callback: (request: GuestSongRequest) => void) => () => void;
  };

  // 8. Native Dialogs
  dialog: {
    /** Opens a native file picker for SoundFont 2 (.sf2) files */
    openSoundFontFile: () => Promise<string | null>;
    /** Opens a native file picker for media files */
    openMediaFile: () => Promise<string | null>;
    /** Opens a native directory picker for folder scanning */
    openDirectory: () => Promise<string | null>;
  };

  // 9. System Defaults & First-Run Paths
  system: {
    /** Auto-detects the operating system's default General MIDI SoundFont path */
    getDefaultSoundFont: () => Promise<string | null>;
    /** Validates paths, prompts for library folder on first run or falls back to ~/Karaoke, and sets soundfont */
    initPaths: (clientSettings: { libraryPath?: string; midiSoundFontPath?: string }) => Promise<{
      libraryPath: string;
      midiSoundFontPath: string;
      wasPrompted: boolean;
    }>;
    /** Safely opens an external HTTP/HTTPS URL in the default system browser */
    openExternal: (url: string) => Promise<{ success: boolean }>;
    /** Inspects and diagnoses firewall rules across Windows, macOS, and Linux */
    checkFirewall: () => Promise<FirewallCheckResult>;
  };

  // 10. Diagnostic Logger
  logger: {
    /** Emits a diagnostic log entry to the persistent log file */
    log: (level: LogLevel, source: string, message: string, data?: unknown) => void;
    /** Retrieves absolute path to current log file */
    getLogFilePath: () => Promise<string>;
    /** Opens log folder in OS file manager */
    openLogFolder: () => Promise<{ success: boolean }>;
    /** Opens log file in OS text viewer */
    openLogFile: () => Promise<{ success: boolean }>;
    /** Clears contents of log file */
    clearLogs: () => Promise<{ success: boolean }>;
    /** Updates active log level */
    setLogLevel: (level: LogLevel) => Promise<{ success: boolean }>;
    /** Retrieves recent log lines from disk */
    getRecentLogs: (lines?: number) => Promise<string[]>;
  };

  // 11. yt-dlp Auto-Updater & Engine Status
  ytdlp: {
    /** Retrieves diagnostic status and current version of yt-dlp */
    getStatus: () => Promise<YtDlpStatus>;
    /** Checks GitHub releases for updates and performs immediate download/update if available */
    checkUpdate: () => Promise<YtDlpStatus>;
  };

  /** HTDemucs ONNX model cache (main-process download / ArrayBuffer transfer) */
  demucs: {
    /** Returns true when the HTDemucs model is already cached under userData */
    isModelCached: () => Promise<boolean>;
    /** Ensures the model is downloaded and returns its raw ArrayBuffer */
    getModelBuffer: () => Promise<ArrayBuffer>;
  };
}

const karaokeApi: KaraokeAPI = {
  // Playback State Sync
  sendStateSync: (state: ActivePlaybackState) => {
    ipcRenderer.send('playback:state-sync', state);
  },
  onStateSync: (callback: (state: ActivePlaybackState) => void) => {
    const handler = (_event: IpcRendererEvent, state: ActivePlaybackState) => callback(state);
    ipcRenderer.on('playback:state-sync', handler);
    return () => {
      ipcRenderer.removeListener('playback:state-sync', handler);
    };
  },
  sendCommand: (action: string, payload?: unknown) => {
    ipcRenderer.send('playback:command', { action, payload });
  },
  onCommand: (callback: (command: { action: string; payload?: unknown }) => void) => {
    const handler = (_event: IpcRendererEvent, command: { action: string; payload?: unknown }) => callback(command);
    ipcRenderer.on('playback:command', handler);
    return () => {
      ipcRenderer.removeListener('playback:command', handler);
    };
  },
  syncQueueCache: (queue: QueueItem[]) => {
    ipcRenderer.send('queue:update-cache', queue);
  },

  // Window Management & Auto-Recovery
  getStageInitialState: () => ipcRenderer.invoke('stage:get-initial-state'),
  reopenStageWindow: () => ipcRenderer.invoke('window:reopen-stage'),
  toggleStageFullscreen: () => ipcRenderer.invoke('window:toggle-stage-fullscreen'),
  onStageStatusChange: (callback: (status: { isOpen: boolean }) => void) => {
    const handler = (_event: IpcRendererEvent, status: { isOpen: boolean }) => callback(status);
    ipcRenderer.on('window:stage-status', handler);
    return () => {
      ipcRenderer.removeListener('window:stage-status', handler);
    };
  },
  onStageCrashed: (callback: (details: unknown) => void) => {
    const handler = (_event: IpcRendererEvent, details: unknown) => callback(details);
    ipcRenderer.on('window:stage-crashed', handler);
    return () => {
      ipcRenderer.removeListener('window:stage-crashed', handler);
    };
  },
  signalStageReady: () => {
    ipcRenderer.send('stage:ready');
  },

  // Database Bridge
  db: {
    getTracks: () => ipcRenderer.invoke('db:get-tracks'),
    upsertTrack: (track: KaraokeMediaTrack) => ipcRenderer.invoke('db:upsert-track', track),
    getAllSingers: () => ipcRenderer.invoke('db:get-singers'),
    getOrCreateSinger: (name: string) => ipcRenderer.invoke('db:get-or-create-singer', name),
    setSingerPermanent: (singerId: string, isPermanent: boolean) => ipcRenderer.invoke('db:set-singer-permanent', singerId, isPermanent),
    deleteSinger: (singerId: string) => ipcRenderer.invoke('db:delete-singer', singerId),
    updateSingerPitch: (singerId: string, pitchOffset: number) => ipcRenderer.invoke('db:update-singer-pitch', singerId, pitchOffset),
    incrementSingerCount: (singerId: string) => ipcRenderer.invoke('db:increment-singer-count', singerId),
    logSiae: (log) => ipcRenderer.invoke('db:log-siae', log)
  },

  // Library Scanner & YouTube Search
  library: {
    scanFolder: (folderPath: string) => ipcRenderer.invoke('library:scan-folder', folderPath),
    searchYouTube: (query: string) => ipcRenderer.invoke('search:youtube', query),
    getTrackThumbnail: (filePath: string) => ipcRenderer.invoke('library:get-track-thumbnail', filePath)
  },

  // SIAE Reporting
  siae: {
    getLogs: () => ipcRenderer.invoke('siae:get-logs'),
    exportCsv: () => ipcRenderer.invoke('siae:export-csv'),
    clearLogs: () => ipcRenderer.invoke('siae:clear-logs')
  },

  // Downloads Bridge
  downloads: {
    start: (options) => ipcRenderer.invoke('download:start', options),
    cancel: (downloadId) => ipcRenderer.invoke('download:cancel', downloadId),
    findExisting: (options) => ipcRenderer.invoke('download:find-existing', options),
    saveToLibrary: (payload) => ipcRenderer.invoke('download:save-to-library', payload),
    saveToQueueCache: (payload) => ipcRenderer.invoke('download:save-to-queue-cache', payload),
    deleteCachedFile: (filePath: string) => ipcRenderer.invoke('cache:delete-file', filePath),
    cleanupUnreferencedCache: (activeFilePaths: string[]) =>
      ipcRenderer.invoke('cache:cleanup-unreferenced', activeFilePaths),
    onProgress: (callback: (payload: DownloadProgressPayload) => void) => {
      const handler = (_event: IpcRendererEvent, payload: DownloadProgressPayload) => callback(payload);
      ipcRenderer.on('download:progress', handler);
      return () => {
        ipcRenderer.removeListener('download:progress', handler);
      };
    },
    onLibraryReindexed: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('library:reindexed', handler);
      return () => {
        ipcRenderer.removeListener('library:reindexed', handler);
      };
    }
  },

  // Guest Portal Bridge
  guestPortal: {
    getInfo: () => ipcRenderer.invoke('guest:get-portal-info'),
    onRequestReceived: (callback: (request: GuestSongRequest) => void) => {
      const handler = (_event: IpcRendererEvent, request: GuestSongRequest) => callback(request);
      ipcRenderer.on('guest:request-received', handler);
      return () => {
        ipcRenderer.removeListener('guest:request-received', handler);
      };
    }
  },

  // Native Dialogs
  dialog: {
    openSoundFontFile: () =>
      ipcRenderer.invoke('dialog:open-file', [
        { name: 'SoundFont Bank (*.sf2)', extensions: ['sf2'] }
      ]),
    openMediaFile: () =>
      ipcRenderer.invoke('dialog:open-file', [
        { name: 'Karaoke Files (*.mp4, *.mp3, *.mid, *.kar, *.cdg)', extensions: ['mp4', 'mp3', 'mid', 'kar', 'cdg', 'webm'] }
      ]),
    openDirectory: () => ipcRenderer.invoke('dialog:open-directory')
  },

  // System Defaults
  system: {
    getDefaultSoundFont: () => ipcRenderer.invoke('system:get-default-soundfont'),
    initPaths: (clientSettings: { libraryPath?: string; midiSoundFontPath?: string }) =>
      ipcRenderer.invoke('system:init-paths', clientSettings),
    openExternal: (url: string) => ipcRenderer.invoke('system:open-external', url),
    checkFirewall: () => ipcRenderer.invoke('system:check-firewall')
  },

  // Diagnostic Logger
  logger: {
    log: (level: LogLevel, source: string, message: string, data?: unknown) => {
      ipcRenderer.send('logger:log', { level, source, message, data });
    },
    getLogFilePath: () => ipcRenderer.invoke('logger:get-path'),
    openLogFolder: () => ipcRenderer.invoke('logger:open-folder'),
    openLogFile: () => ipcRenderer.invoke('logger:open-file'),
    clearLogs: () => ipcRenderer.invoke('logger:clear'),
    setLogLevel: (level: LogLevel) => ipcRenderer.invoke('logger:set-level', level),
    getRecentLogs: (lines?: number) => ipcRenderer.invoke('logger:get-recent', lines)
  },

  // yt-dlp Auto-Updater & Status
  ytdlp: {
    getStatus: () => ipcRenderer.invoke('ytdlp:get-status'),
    checkUpdate: () => ipcRenderer.invoke('ytdlp:check-update')
  },

  demucs: {
    isModelCached: () => ipcRenderer.invoke('demucs:is-model-cached'),
    getModelBuffer: () => ipcRenderer.invoke('demucs:get-model-buffer')
  }
};

contextBridge.exposeInMainWorld('karaokeApi', karaokeApi);

// Type augmentation for Window
declare global {
  interface Window {
    karaokeApi: KaraokeAPI;
  }
}
