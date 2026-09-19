/**
 * Media source types supported by the Karaoke Live Station.
 */
export type MediaSource = 'local_library' | 'youtube' | 'midi';

/**
 * Visual themes available for Host (Regia) and Stage (Palco) screens.
 */
export type AppTheme =
  | 'dark-stage'
  | 'midnight-neon'
  | 'club-gold'
  | 'ocean-breeze'
  | 'sunset-crimson'
  | 'emerald-matrix'
  | 'royal-amethyst'
  | 'high-contrast'
  | 'light';

/**
 * Supported UI localization languages with auto-detection fallback.
 */
export type AppLanguage = 'autodetect' | 'en' | 'it' | 'es' | 'fr';

/**
 * Diagnostic log levels supported by the application logger.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'off';

/**
 * Diagnostic log message structure.
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
  data?: unknown;
}

/**
 * Global application settings persisted across sessions.
 */

/** Visual formatting for a customizable Stage overlay message. */
/** How the Stage backdrop is overridden while this message is visible. */
export type StageMessageBackgroundMode = 'none' | 'color' | 'image';

export interface StageMessageStyle {
  /** Show this message on Stage */
  enabled: boolean;
  /**
   * Custom template. Empty string = use current-locale i18n default.
   * Supports `{{name}}` where applicable (nowSinging / getReady).
   */
  text: string;
  bold: boolean;
  italic: boolean;
  /** Font size in CSS pixels */
  fontSizePx: number;
  /**
   * Optional Stage backdrop override while this message is on screen.
   * `none` keeps the normal theme/video Stage background.
   * Lifecycle: applied only while the message is visible+enabled; cleared when it hides.
   */
  backgroundMode: StageMessageBackgroundMode;
  /** CSS color used when backgroundMode === 'color' (e.g. #0f172a). */
  backgroundColor: string;
  /**
   * Absolute filesystem path to a still image used when backgroundMode === 'image'.
   * Stage converts this to the privileged karaoke://local/ URL for safe rendering.
   */
  backgroundImagePath: string;
}

/** Operator-editable Stage overlay copy + formatting. */
export interface StageMessagesSettings {
  nowSinging: StageMessageStyle;
  getReady: StageMessageStyle;
  upNextIntro: StageMessageStyle;
  nextSong: StageMessageStyle;
  nextSingerUnassigned: StageMessageStyle;
  upNextOnStage: StageMessageStyle;
  followingSinger: StageMessageStyle;
}

export interface AppSettings {
  /** Theme used by the operator desk (Regia) */
  themeHost: AppTheme;
  /** Theme used by the stage display (Palco) */
  themeStage: AppTheme;
  /** Interface language code */
  language: AppLanguage;

  /** Audio/video hardware synchronization latency offset in milliseconds */
  audioVideoSyncOffsetMs: number;
  /** Custom third-party service API keys */
  customApiKeys: Record<string, string>;
  /** Absolute filesystem path to user-selected SoundFont 2 (.sf2) bank */
  midiSoundFontPath: string;
  /** Absolute filesystem path to the main local karaoke media library */
  libraryPath: string;

  /** Enable anti-monopoly fair queue rotation algorithm */
  enableFairQueue: boolean;
  /** Enable DSP mid/side guide-vocal attenuation (algorithmic only) */
  enableVocalRemover: boolean;
  /**
   * Live Rimozione Vocale / Control `V` — algorithmic mid/side DSP only.
   * AI methods must never be stored here (see `instrumentalVocalRemoverMethod`).
   */
  vocalRemoverAlgorithm: 'centerCancelBassKeep' | 'centerCancel' | 'softMid';
  /**
   * Method used by YouTube Download Instrumental (algorithmic DSP and/or offline AI).
   * Independent from live Rimozione Vocale — AI here never drives the live graph.
   */
  instrumentalVocalRemoverMethod:
    | 'centerCancelBassKeep'
    | 'centerCancel'
    | 'softMid'
    | 'aiMdxKaraoke2'
    | 'aiHtDemucs'
    | 'aiBsRoformer';
  /**
   * UVR-MDX-NET segment size (`dim_t`). Used only when instrumental method is aiMdxKaraoke2.
   * Powers of 2 in [64, 1024]; Karaoke 2 catalog default is 256.
   */
  mdxSegmentSize: number;
  /**
   * UVR-MDX fractional overlap (0.10–0.99). Maps to ORT window hop via
   * `mdxStepSamples(overlap) = floor((1 - overlap) * chunk_size)`.
   * Used only for aiMdxKaraoke2.
   */
  mdxOverlap: number;
  /**
   * When true: ORT WASM graphOptimizationLevel `all` + SIMD.
   * When false: graphOptimizationLevel `disabled` + SIMD off.
   * ORT is still required for MDX — this only toggles CPU acceleration opts.
   * Used only for aiMdxKaraoke2.
   */
  mdxEnableOrt: boolean;
  /**
   * ORT WASM thread count for Download Instrumental AI (MDX / HTDemucs).
   * `null` / missing → use all detected logical cores (default max power).
   * Finite values are clamped to [1, detectedCores] at resolve time.
   */
  aiCpuThreads: number | null;
  /**
   * When true (default), maximize the Control (Regia) window on app launch
   * via BrowserWindow.maximize() — not exclusive fullscreen.
   */
  autoMaximizeControlOnLaunch: boolean;
  /**
   * When true (default), open the Stage (Palco) window during initWindows.
   * When false, Stage stays closed until reopened via UI / F2 / stage:open.
   */
  autoOpenStageOnLaunch: boolean;
  /**
   * Max concurrent yt-dlp jobs (shared pool for traditional Download and Download Instrumental).
   * Extra starts are queued until a slot frees.
   */
  maxSimultaneousDownloads: number;
  /** Enable microphone-triggered background music ducking */
  enableAutoDuckingBGM: boolean;
  /** Enable automatic dynamic audio volume normalization (leveling) */
  enableAudioNormalization?: boolean;
  /** Enable embedded LAN guest request web server */
  enableGuestPortal: boolean;
  /** Enable logging of executed songs for SIAE / copyright borderò */
  enableSiaeReporting: boolean;
  /** Automatically import completed YouTube downloads into the local catalog */
  autoArchiveWebTracks: boolean;

  /** Duration (seconds) of the "Now Singing" intro banner */
  bannerIntroDurationSec: number;
  /** Remaining duration (seconds) when the "Up Next" outro banner is triggered */
  bannerOutroTriggerSec: number;
  /** Duration (seconds) the song title and artist banner appears at the bottom center of the video */
  titleOverlayDurationSec: number;
  /** Show next singer and song announcement already at the beginning of the current song */
  showNextSingerAtIntro: boolean;
  /** Silence/pause duration (seconds) between successive queued tracks */
  transitionPauseSec: number;
  /** Automatically trigger playback of the next queued track */
  autoAdvanceNext: boolean;
  /** Show live semitone pitch shift badge on the stage monitor */
  showPitchOnStage?: boolean;
  /** Show live playback speed badge on the stage monitor (e.g. 1.00x) */
  showSpeedOnStage?: boolean;
  /** Customizable Stage overlay messages (Ora Canta, Preparati, …) */
  stageMessages?: StageMessagesSettings;

  /** Network port for the embedded Guest Portal HTTP & Socket.IO server */
  guestPortalPort: number;
  /** Audio output device ID for operator CUE pre-listening */
  cueAudioDeviceId: string;
  /** Audio output device ID for main front-of-house room playback */
  masterAudioDeviceId: string;
  /** Diagnostic log level for capturing system events and anomalies ('debug' | 'info' | 'warn' | 'error' | 'off') */
  logLevel: LogLevel;
}

/**
 * Represents a playable media track in the library or queue.
 */
export interface KaraokeMediaTrack {
  /** Unique identifier for the track */
  id: string;
  /** Origin source of the track */
  source: MediaSource;
  /** Song title */
  title: string;
  /** Artist / Performer name */
  artist: string;
  /** Duration in seconds */
  durationSec: number;
  /** Playback URI (e.g. karaoke://local/..., file://..., or web URL) */
  uri: string;
  /** Local filesystem path if cached or downloaded */
  localFilePath?: string;
  /** Thumbnail or preview image URL (karaoke://local/... or https://...) */
  thumbnailUrl?: string;
  /** Indicates whether the track contains embedded lyrics (e.g. KAR, CDG, or MP4 subtitles) */
  hasEmbeddedLyrics?: boolean;
  /** Indicates whether the track has multiplex audio channels (e.g. vocal guide on left/right) */
  isMultiplex?: boolean;
  /** Indicates if the track can be embedded or played directly */
  isEmbeddable?: boolean;
}

/**
 * An entry in the active playback queue.
 */
export interface QueueItem {
  /** Unique queue entry identifier */
  queueId: string;
  /** The media track to be played */
  track: KaraokeMediaTrack;
  /** ID of the registered singer assigned to this song */
  assignedSingerId?: string;
  /** Display name of the singer assigned to this song */
  assignedSingerName?: string;
  /** Real-time pitch offset in semitones (-8 to +8) */
  pitchOffset: number;
  /** Epoch timestamp (ms) when this request was enqueued */
  requestedAt: number;
  /** Flag to bypass the fair rotation algorithm and prioritize track */
  isVIPOverride?: boolean;
  /** Dynamic rotation priority score calculated by the fair queue algorithm */
  fairScore?: number;
  /** Force placement at the end of the queue, bypassing automatic fair position */
  forceEnd?: boolean;
  /** Flag indicating whether this track execution has already been recorded into SIAE history */
  alreadyLogged?: boolean;
}

/**
 * Historical record of an executed karaoke track for SIAE / copyright borderò.
 */
export interface SiaeLogEntry {
  id: number;
  trackTitle: string;
  trackArtist: string;
  singerName: string | null;
  /** Unix epoch timestamp in milliseconds when the song was logged */
  executedAt: number;
  /** ISO 8601 formatted timestamp (YYYY-MM-DDTHH:mm:ss.sssZ) */
  executedAtIso?: string;
  /** Duration of the performance in seconds */
  durationSec: number;
}

/**
 * Real-time playback status synchronized across main and renderer windows.
 */
export interface ActivePlaybackState {
  /** Playback state (true = playing, false = paused/stopped) */
  isPlaying: boolean;
  /** Current playback position in seconds */
  currentTime: number;
  /** Total duration of the active track in seconds */
  duration: number;
  /** Current live pitch transposition in semitones (-8 to +8) */
  livePitchOffset: number;
  /** Playback rate / speed multiplier (0.50x to 1.50x) */
  playbackSpeed: number;
  /** Array of muted MIDI channel indices (0-15) for live KAR/MIDI playback */
  mutedMidiChannels: number[];
  /** Current synchronized lyric text line */
  activeLyricsText?: string;
  /** ID of the track currently being played */
  currentTrackId?: string;
  /** Center-channel vocal remover active status */
  isVocalRemoverActive: boolean;
  /** Auto-ducking BGM attenuation active status */
  isDuckingActive: boolean;
  /** Master volume gain multiplier (0.0 to 1.0) */
  masterVolume: number;
  /** Master mute toggle */
  isMuted: boolean;
}

/**
 * Persistent profile for registered singers and performers.
 */
export interface SingerProfile {
  /** Unique singer UUID */
  id: string;
  /** Performer display name */
  name: string;
  /** Preferred pitch offset memory in semitones */
  preferredPitchOffset?: number;
  /** Total count of songs sung during the session */
  songsSungCount: number;
  /** Pinned favorite status for fast lookup */
  isPermanentFavorite: boolean;
  /** Registration timestamp (epoch ms) */
  createdAt: number;
  /** Last performed song timestamp (epoch ms) */
  lastSungAt?: number;
}

/**
 * Progress payload emitted during YouTube and web media downloads.
 */
export interface DownloadProgressPayload {
  /** Unique task download ID */
  downloadId: string;
  /** Download completion percentage (0.0 to 100.0) */
  percent: number;
  /** Formatted download speed (e.g. "2.4 MB/s") */
  speed: string;
  /** Estimated time of arrival (e.g. "00:45") */
  eta: string;
  /** Number of bytes downloaded so far */
  downloadedBytes: number;
  /** Total expected file size in bytes */
  totalBytes: number;
  /** Current download phase */
  status:
    | 'queued'
    | 'downloading'
    | 'converting'
    | 'processing'
    | 'downloading_model'
    | 'removing_vocals'
    | 'remuxing'
    | 'completed'
    | 'error'
    | 'cancelled';
  /** Error details if status is 'error' */
  errorMessage?: string;
  /** Destination file path when download completes */
  outputFilePath?: string;
  /** True when an existing library/cache file was reused (no network I/O) */
  alreadyExists?: boolean;
  /** Where the reused file was found */
  existingLocation?: 'library' | 'queue_cache' | 'database';
  /** True when this job requested instrumental post-process */
  instrumental?: boolean;
  /** Display title hint for the Download menu */
  titleHint?: string;
}

/**
 * Options for starting a yt-dlp download (optional instrumental post-process).
 */
export interface StartDownloadOptions {
  url: string;
  isAudioOnly?: boolean;
  preferredQuality?: string;
  titleHint?: string;
  artistHint?: string;
  trackId?: string;
  libraryPath?: string;
  /** When true, apply vocal removal (AI or algorithmic) and remux instrumental A/V after download */
  instrumental?: boolean;
  /** Method for instrumental post-process — from `instrumentalVocalRemoverMethod` (may be AI) */
  vocalRemoverAlgorithm?: string;
  /**
   * MDX-only advanced knobs (omit for Demucs / Roformer / algorithmic).
   * Client should only set when method is aiMdxKaraoke2.
   */
  mdxSegmentSize?: number;
  mdxOverlap?: number;
  mdxEnableOrt?: boolean;
  /**
   * ORT WASM thread preference for AI instrumental (null = all cores).
   * Main resolves/clamps before the worker; renderer may pass the raw setting.
   */
  aiCpuThreads?: number | null;
}

/**
 * Result of starting a download, including optional local-file reuse (deduplication).
 */
export interface StartDownloadResult {
  downloadId: string;
  alreadyExists: boolean;
  localFilePath?: string;
  uri?: string;
  location?: 'library' | 'queue_cache' | 'database';
}

/**
 * Descriptor for an already-present local media file matching a remote/web track.
 */
export interface ExistingLocalMedia {
  localFilePath: string;
  uri: string;
  location: 'library' | 'queue_cache' | 'database';
  matchedBy: 'id' | 'hash' | 'filename';
}

/**
 * Incoming song request submitted via the LAN Guest Portal.
 */
export interface GuestSongRequest {
  /** Unique request identifier */
  requestId: string;
  /** Name of the requesting singer */
  singerName: string;
  /** Optional library track identifier if selected from catalog */
  trackId?: string;
  /** Requested song title */
  trackTitle: string;
  /** Requested artist name */
  trackArtist: string;
  /** Submission timestamp (epoch ms) */
  requestedAt: number;
  /** Optional media URI if specified */
  sourceUri?: string;
  /** Guest preferred pitch transposition (-8 to +8) */
  preferredPitch: number;
  /** Moderation approval status */
  status: 'pending' | 'approved' | 'rejected';
}

/**
 * A parsed MIDI/KAR lyric syllable or sentence event.
 */
export interface MidiLyricEvent {
  /** Event timestamp in milliseconds from track start */
  timeMs: number;
  /** Syllable or word text */
  text: string;
  /** Indicates a line break trigger (`/` or `\n`) */
  isLineBreak: boolean;
  /** Indicates a stanza or paragraph break trigger (`\\`) */
  isParagraphBreak: boolean;
}

/**
 * Track and channel metadata extracted from a MIDI sequence.
 */
export interface MidiParsedTrackInfo {
  /** MIDI channel index (0 to 15) */
  channel: number;
  /** Track or sequence name */
  name: string;
  /** Total number of Note-On events on this channel */
  noteCount: number;
  /** General MIDI patch/instrument program name */
  instrumentName?: string;
  /** Indicates whether this channel is dedicated to percussion (Channel 10) */
  isDrumTrack: boolean;
}

/**
 * Complete parsed structure of a Standard MIDI or KAR file.
 */
export interface MidiParsedSong {
  /** Total song duration in milliseconds */
  durationMs: number;
  /** List of tracks and channels present in the sequence */
  tracks: MidiParsedTrackInfo[];
  /** Chronologically sorted lyrics events */
  lyrics: MidiLyricEvent[];
  /** Starting tempo in Beats Per Minute */
  initialBpm: number;
}

/**
 * Generic result wrapper for SQLite database operations.
 */
export interface SqlQueryResult<T = unknown> {
  /** Success status */
  success: boolean;
  /** Result payload data */
  data?: T;
  /** Error message if failed */
  error?: string;
  /** Number of rows inserted, updated, or deleted */
  rowsAffected?: number;
}

/**
 * Diagnostic status and version information for the yt-dlp download engine.
 */
export interface YtDlpStatus {
  /** Whether a working yt-dlp binary is detected and executable */
  available: boolean;
  /** Currently installed and running version string (e.g. "2026.08.19") */
  version?: string;
  /** Absolute filesystem path to the active binary */
  path?: string;
  /** Whether an update or initial download is actively in progress */
  isUpdating: boolean;
  /** Latest available release version detected on GitHub */
  latestVersion?: string;
  /** Epoch timestamp in milliseconds of the last version check */
  lastChecked?: number;
  /** Error message if check, download or execution failed */
  error?: string;
}

/**
 * Supported host operating systems.
 */
export type OperatingSystem = 'win32' | 'darwin' | 'linux';

/**
 * Firewall rule diagnostics and configuration steps for a given OS.
 */
export interface FirewallRuleInfo {
  platform: OperatingSystem;
  port: number;
  status: 'allowed' | 'blocked' | 'unknown';
  serviceName: string;
  summary: string;
  command?: string;
  commandExplanation?: string;
  guiSteps?: string[];
}

/**
 * Complete multiplatform firewall check result payload.
 */
export interface FirewallCheckResult {
  currentPlatform: OperatingSystem;
  activePort: number;
  lanIp: string;
  rules: Record<OperatingSystem, FirewallRuleInfo>;
}


