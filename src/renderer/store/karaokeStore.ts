import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  AppSettings,
  KaraokeMediaTrack,
  QueueItem,
  ActivePlaybackState,
  SingerProfile,
  GuestSongRequest
} from '../../shared/types';
import {
  createDefaultStageMessages,
  patchStageMessages
} from '../../shared/stageMessages';
import {
  coerceAlgorithmicVocalRemoverMethod,
  coerceInstrumentalVocalRemoverMethod,
  isAiVocalRemoverMethod
} from '../../shared/vocalRemover';
import {
  coerceMdxEnableOrt,
  coerceMdxOverlap,
  coerceMdxSegmentSize,
  MDX_DEFAULT_ENABLE_ORT,
  MDX_DEFAULT_OVERLAP,
  MDX_DEFAULT_SEGMENT_SIZE
} from '../../shared/mdxAdvancedSettings';
import {
  coerceDemucsOverlap,
  coerceDemucsSegmentSize,
  coerceDemucsShifts,
  DEMUCS_DEFAULT_OVERLAP,
  DEMUCS_DEFAULT_SEGMENT_SIZE,
  DEMUCS_DEFAULT_SHIFTS
} from '../../shared/demucsAdvancedSettings';
import { coerceAiCpuThreads } from '../../shared/aiCpuThreads';
import { coerceAiEnableGpu } from '../../shared/aiOrtProviders';
import { clampPitchForEngine, clampSpeedForEngine, coerceDspPitchEngine } from '../../shared/dspPitch';


function logStore(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void {
  try {
    if (typeof window !== 'undefined') {
      window.karaokeApi?.logger?.log(level, 'karaokeStore', message, data);
    }
  } catch {
    /* ignore */
  }
}



export type MissingFileContext = 'library' | 'queue';

/**
 * Modal payload when a local media path is missing on disk (USB unplugged / moved / deleted).
 * Why: never auto-delete — operator chooses Elimina vs Lascia; red mark via `missingTrackIds`.
 */
export interface MissingFileModalState {
  isOpen: boolean;
  filePath: string;
  trackTitle: string;
  trackArtist: string;
  trackId?: string;
  queueItemId?: string;
  context: MissingFileContext;
}

/** Arguments for opening the missing-file modal (library enqueue or queue play). */
export interface ShowMissingFileModalArgs {
  filePath: string;
  trackTitle: string;
  trackArtist?: string;
  trackId?: string;
  queueItemId?: string;
  context: MissingFileContext;
}

export interface KaraokeStoreState {
  // 1. Settings (Persistent)
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;
  applyAppTheme: () => void;

  // 2. Playback State (Volatile / Synced via IPC)
  playback: ActivePlaybackState;
  setPlaybackState: (partial: Partial<ActivePlaybackState>) => void;
  togglePlayPause: () => void;
  setLivePitch: (pitchOffset: number) => void;
  setPlaybackSpeed: (speed: number) => void;
  toggleMidiChannelMute: (channelIndex: number) => void;
  setVocalRemover: (active: boolean) => void;
  setDucking: (active: boolean) => void;

  // 3. Singer Profiles (Persistent)
  singers: Record<string, SingerProfile>;
  loadSingersFromDb: () => Promise<void>;
  getOrCreateSingerProfile: (name: string) => SingerProfile;
  removeSingerProfile: (singerId: string) => void;
  saveSingerPitchMemory: (singerId: string, pitchOffset: number) => void;
  incrementSingerCount: (singerId: string) => void;

  // 4. Queue & Fair Queue Algorithm (Volatile)
  queue: QueueItem[];
  addToQueue: (track: KaraokeMediaTrack, singerName?: string, isVIP?: boolean, pitchOffset?: number, placement?: 'auto' | 'end') => void;
  /** Batch enqueue — one Zustand set + one syncQueueCache (OS multi-file queue drops). */
  addToQueueBatch: (
    items: Array<{
      track: KaraokeMediaTrack;
      singerName?: string;
      isVIP?: boolean;
      pitchOffset?: number;
      placement?: 'auto' | 'end';
    }>
  ) => void;
  setQueueItemPitch: (queueId: string, pitchOffset: number) => void;
  updateTrackInQueue: (trackId: string, updates: Partial<KaraokeMediaTrack>) => void;
  removeFromQueue: (queueId: string) => void;
  reorderQueue: (startIndex: number, endIndex: number) => void;
  restoreFairQueueOrder: () => void;
  updateQueueItemSinger: (queueId: string, singerName: string) => void;
  jumpToQueueItem: (queueIndex: number) => void;
  advanceToNextTrack: (options?: { naturalEnd?: boolean }) => QueueItem | null;
  /**
   * Logs SIAE borderò when criteria are met.
   * **Critical invariant:** natural end **or** elapsed ≥ 120 seconds; never log below that
   * unless naturalEnd. Duplicate-guarded via `alreadyLogged`.
   */
  logCurrentTrackExecution: (options?: { naturalEnd?: boolean }) => boolean;
  clearQueue: () => void;

  // 5. Missing File Modal & Error Handling
  missingFileModal: MissingFileModalState;
  /** Track IDs known missing on disk — drives rose-500/70 row styling until Elimina or recovery */
  missingTrackIds: string[];
  markTrackMissing: (trackId: string) => void;
  clearTrackMissing: (trackId: string) => void;
  showMissingFileModal: (args: ShowMissingFileModalArgs) => void;
  closeMissingFileModal: () => void;

  // 6. Guest Portal Requests
  pendingGuestRequests: GuestSongRequest[];
  addGuestRequest: (req: GuestSongRequest) => void;
  approveGuestRequest: (requestId: string, track: KaraokeMediaTrack) => void;
  rejectGuestRequest: (requestId: string) => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  themeHost: 'dark-stage',
  themeStage: 'dark-stage',
  language: 'autodetect',

  audioVideoSyncOffsetMs: 0,
  customApiKeys: {},
  midiSoundFontPath: '',
  libraryPath: '',

  enableFairQueue: true,
  enableVocalRemover: false,
  vocalRemoverAlgorithm: 'centerCancelBassKeep',
  instrumentalVocalRemoverMethod: 'aiMdxKaraoke2',
  mdxSegmentSize: MDX_DEFAULT_SEGMENT_SIZE,
  mdxOverlap: MDX_DEFAULT_OVERLAP,
  mdxEnableOrt: MDX_DEFAULT_ENABLE_ORT,
  demucsShifts: DEMUCS_DEFAULT_SHIFTS,
  demucsSegmentSize: DEMUCS_DEFAULT_SEGMENT_SIZE,
  demucsOverlap: DEMUCS_DEFAULT_OVERLAP,
  /** null = all detected cores (max power default). */
  aiCpuThreads: null,
  /** GPU-First default — prefer WebGPU when probe supports it. */
  aiEnableGpu: true,
  autoMaximizeControlOnLaunch: true,
  autoOpenStageOnLaunch: true,
  maxSimultaneousDownloads: 2,
  enableAutoDuckingBGM: false,
  enableAudioNormalization: true,
  dspEngine: 'signalsmith',
  enableGuestPortal: true,
  enableSiaeReporting: true,
  autoArchiveWebTracks: true,
  /** Ask before fetching YouTube auto-subs on Download Instrumental */
  instrumentalSubtitlesPolicy: 'ask',
  showPitchOnStage: true,
  showSpeedOnStage: true,
  stageMessages: createDefaultStageMessages(),

  bannerIntroDurationSec: 6,
  bannerOutroTriggerSec: 20,
  titleOverlayDurationSec: 8,
  showNextSingerAtIntro: true,
  transitionPauseSec: 3,
  autoAdvanceNext: false,

  guestPortalPort: 3000,
  cueAudioDeviceId: 'default',
  masterAudioDeviceId: 'default',
  logLevel: 'info'
};

const INITIAL_PLAYBACK_STATE: ActivePlaybackState = {
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  livePitchOffset: 0,
  playbackSpeed: 1.0,
  mutedMidiChannels: [],
  activeLyricsText: undefined,
  currentTrackId: undefined,
  isVocalRemoverActive: false,
  isDuckingActive: false,
  masterVolume: 1.0,
  isMuted: false
};

/**
 * Calculates an anti-monopoly fair queue rotation priority score.
 * Formula: FairScore = (SongsSungCount * 100_000_000_000) + RequestedAt
 * Performers with fewer performances are placed ahead of those who have sung multiple times.
 * Within the same performance tier, submission timestamps break ties chronologically.
 * VIP overrides bypass rotation (score = -1). Tracks flagged with forceEnd receive max penalty.
 *
 * @param songsSungCount - Count of songs previously performed by the singer
 * @param requestedAt - Epoch timestamp in milliseconds
 * @param isVIP - VIP flag to force highest priority
 * @param forceEnd - Flag to force track to the end of the queue
 * @returns Numerical priority score (lower is higher priority)
 */
export function calculateFairScore(
  songsSungCount: number,
  requestedAt: number,
  isVIP: boolean = false,
  forceEnd: boolean = false
): number {
  if (isVIP) return -1; // VIP requests are always at the top
  if (forceEnd) return Number.MAX_SAFE_INTEGER - 100_000_000 + (requestedAt % 100_000_000);
  return (songsSungCount * 100_000_000_000) + requestedAt;
}

/**
 * Sorts queued items according to the anti-monopoly fair queue formula.
 *
 * @param items - Current queue array
 * @param enableFairQueue - Toggle flag
 * @returns Sorted queue array
 */
export function sortQueueByFairAlgorithm(items: QueueItem[], enableFairQueue: boolean): QueueItem[] {
  if (!enableFairQueue || items.length <= 2) {
    return items;
  }
  // The first item (items[0]) is currently active/playing and must NEVER be moved
  const [first, ...rest] = items;
  const sortedRest = [...rest].sort((a, b) => {
    // 1. VIP override (-1)
    if (a.isVIPOverride && !b.isVIPOverride) return -1;
    if (!a.isVIPOverride && b.isVIPOverride) return 1;

    // 2. forceEnd: placed at the end
    if (a.forceEnd && !b.forceEnd) return 1;
    if (!a.forceEnd && b.forceEnd) return -1;

    // 3. Compare fair scores (incorporating songsSungCount * 100_000_000_000 + requestedAt)
    const scoreA = a.fairScore ?? (a.requestedAt || 0);
    const scoreB = b.fairScore ?? (b.requestedAt || 0);
    return scoreA - scoreB;
  });
  return [first, ...sortedRest];
}

/**
 * Zustand global application store managing:
 * - Persistent configuration settings (themes, paths, latencies)
 * - Volatile real-time playback state
 * - Singer roster and pitch memory map
 * - Fair Queue rotation and song history
 * - Guest request approvals and notifications
 */
let transitionTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Deletes a cached media file from queue_cache if it is no longer referenced
 * by any item in the remaining queue.
 *
 * **Critical invariant (Safety-First):** GC only touches paths under `queue_cache/`
 * or with a `qc_` prefix. Never delete files under `libraryPath` / permanent library.
 * Main-process {@link DownloadManager.deleteCachedFile} also refuses paths outside
 * queue_cache and temp.
 *
 * @param filePath - Candidate cache path (ignored when missing or non-cache)
 * @param remainingQueue - Queue after removal; skip delete if path still referenced
 */
export function cleanupQueueCacheFileIfUnreferenced(filePath?: string, remainingQueue: QueueItem[] = []): void {
  if (!filePath || typeof window === 'undefined' || !window.karaokeApi?.downloads?.deleteCachedFile) return;
  // INVARIANT: never GC permanent library media
  if (!filePath.includes('queue_cache') && !filePath.includes('qc_')) return;

  const isStillReferenced = remainingQueue.some(
    (item) => item.track.localFilePath === filePath
  );

  if (!isStillReferenced) {
    window.karaokeApi.downloads.deleteCachedFile(filePath).catch((err) => {
      logStore('warn', 'Queue GC failed for cached file', { filePath, err });
    });
  }
}

export const useKaraokeStore = create<KaraokeStoreState>()(
  persist(
    (set, get) => ({
      // 1. Settings
      settings: DEFAULT_SETTINGS,
      updateSettings: (partial) => {
        let updatedSettings: AppSettings | null = null;
        set((state) => {
          const updated: AppSettings = { ...state.settings, ...partial };
          if (partial.stageMessages) {
            updated.stageMessages = patchStageMessages(
              state.settings.stageMessages,
              partial.stageMessages
            );
          }
          if (partial.vocalRemoverAlgorithm !== undefined || updated.vocalRemoverAlgorithm) {
            // Live setting: algorithmic only — migrate legacy AI ids onto instrumental method
            const rawLive = updated.vocalRemoverAlgorithm as string;
            if (isAiVocalRemoverMethod(rawLive)) {
              if (!partial.instrumentalVocalRemoverMethod) {
                updated.instrumentalVocalRemoverMethod = coerceInstrumentalVocalRemoverMethod(rawLive);
              }
            }
            updated.vocalRemoverAlgorithm = coerceAlgorithmicVocalRemoverMethod(rawLive);
          }
          if (
            partial.instrumentalVocalRemoverMethod !== undefined ||
            updated.instrumentalVocalRemoverMethod
          ) {
            updated.instrumentalVocalRemoverMethod = coerceInstrumentalVocalRemoverMethod(
              updated.instrumentalVocalRemoverMethod
            );
          }
          if (
            partial.mdxSegmentSize !== undefined ||
            updated.mdxSegmentSize !== undefined
          ) {
            updated.mdxSegmentSize = coerceMdxSegmentSize(updated.mdxSegmentSize);
          }
          if (partial.mdxOverlap !== undefined || updated.mdxOverlap !== undefined) {
            updated.mdxOverlap = coerceMdxOverlap(updated.mdxOverlap);
          }
          if (partial.mdxEnableOrt !== undefined || updated.mdxEnableOrt !== undefined) {
            updated.mdxEnableOrt = coerceMdxEnableOrt(updated.mdxEnableOrt);
          }
          if (partial.demucsShifts !== undefined || updated.demucsShifts !== undefined) {
            updated.demucsShifts = coerceDemucsShifts(updated.demucsShifts);
          }
          if (
            partial.demucsSegmentSize !== undefined ||
            updated.demucsSegmentSize !== undefined
          ) {
            updated.demucsSegmentSize = coerceDemucsSegmentSize(updated.demucsSegmentSize);
          }
          if (partial.demucsOverlap !== undefined || updated.demucsOverlap !== undefined) {
            updated.demucsOverlap = coerceDemucsOverlap(updated.demucsOverlap);
          }
          if (partial.aiCpuThreads !== undefined || updated.aiCpuThreads !== undefined) {
            updated.aiCpuThreads = coerceAiCpuThreads(updated.aiCpuThreads);
          }
          if (partial.aiEnableGpu !== undefined || updated.aiEnableGpu !== undefined) {
            updated.aiEnableGpu = coerceAiEnableGpu(updated.aiEnableGpu);
          }
          if (partial.autoMaximizeControlOnLaunch !== undefined) {
            updated.autoMaximizeControlOnLaunch = Boolean(partial.autoMaximizeControlOnLaunch);
          } else if (typeof updated.autoMaximizeControlOnLaunch !== 'boolean') {
            updated.autoMaximizeControlOnLaunch = true;
          }
          if (partial.autoOpenStageOnLaunch !== undefined) {
            updated.autoOpenStageOnLaunch = Boolean(partial.autoOpenStageOnLaunch);
          } else if (typeof updated.autoOpenStageOnLaunch !== 'boolean') {
            updated.autoOpenStageOnLaunch = true;
          }
          if (partial.instrumentalSubtitlesPolicy !== undefined || updated.instrumentalSubtitlesPolicy) {
            const raw = String(updated.instrumentalSubtitlesPolicy || 'ask');
            updated.instrumentalSubtitlesPolicy =
              raw === 'always' || raw === 'never' ? raw : 'ask';
          } else {
            updated.instrumentalSubtitlesPolicy = 'ask';
          }
          if (partial.dspEngine !== undefined) {
            updated.dspEngine = coerceDspPitchEngine(partial.dspEngine);
          }
          const maxDl = Number(updated.maxSimultaneousDownloads);
          updated.maxSimultaneousDownloads =
            Number.isFinite(maxDl) && maxDl >= 1 ? Math.min(8, Math.floor(maxDl)) : 2;
          updatedSettings = updated;

          // Engine switch: re-clamp live pitch + speed into the new UI ranges
          // (e.g. Signalsmith 0.60x → SoundTouch 0.75x).
          if (partial.dspEngine !== undefined) {
            const engine = coerceDspPitchEngine(updated.dspEngine);
            const nextSpeed = clampSpeedForEngine(state.playback.playbackSpeed, engine);
            const nextPitch = clampPitchForEngine(state.playback.livePitchOffset, engine);
            const playbackChanged =
              nextSpeed !== state.playback.playbackSpeed ||
              nextPitch !== state.playback.livePitchOffset;
            if (playbackChanged) {
              const updatedPlayback = {
                ...state.playback,
                playbackSpeed: nextSpeed,
                livePitchOffset: nextPitch
              };
              if (typeof window !== 'undefined' && window.karaokeApi) {
                window.karaokeApi.sendStateSync(updatedPlayback);
              }
              return { settings: updated, playback: updatedPlayback };
            }
          }
          return { settings: updated };
        });
        get().applyAppTheme();
        if (typeof window !== 'undefined' && window.karaokeApi) {
          // Broadcast settings to Main process and Stage screen in real time
          if (updatedSettings) {
            window.karaokeApi.sendCommand('sync:settings', updatedSettings);
          }
          if (partial.logLevel && window.karaokeApi.logger?.setLogLevel) {
            window.karaokeApi.logger.setLogLevel(partial.logLevel);
          }
        }
      },

      applyAppTheme: () => {
        if (typeof window === 'undefined') return;
        const urlParams = new URLSearchParams(window.location.search);
        const windowMode = urlParams.get('window') || 'control';
        const { themeHost, themeStage } = get().settings;
        const activeTheme = windowMode === 'stage' ? themeStage : themeHost;
        const root = document.documentElement;
        root.classList.remove(
          'dark-stage',
          'midnight-neon',
          'club-gold',
          'ocean-breeze',
          'sunset-crimson',
          'emerald-matrix',
          'royal-amethyst',
          'high-contrast',
          'light',
          'studio-desk'
        );
        root.classList.add(activeTheme || 'dark-stage');
      },

      // 2. Playback State
      playback: INITIAL_PLAYBACK_STATE,
      setPlaybackState: (partial) => {
        set((state) => {
          const updatedPlayback = { ...state.playback, ...partial };
          // Broadcast state sync if running in Electron renderer
          if (typeof window !== 'undefined' && window.karaokeApi) {
            window.karaokeApi.sendStateSync(updatedPlayback);
          }
          return { playback: updatedPlayback };
        });
      },

      togglePlayPause: () => {
        if (transitionTimer) {
          clearTimeout(transitionTimer);
          transitionTimer = null;
        }
        const current = get().playback.isPlaying;
        get().setPlaybackState({ isPlaying: !current });
      },

      setLivePitch: (pitchOffset) => {
        const engine = coerceDspPitchEngine(get().settings.dspEngine);
        const clamped = clampPitchForEngine(pitchOffset, engine);
        get().setPlaybackState({ livePitchOffset: clamped });

        // Update the pitch of the active song in the queue
        set((state) => {
          if (state.queue.length === 0) return state;
          const updatedQueue = [...state.queue];
          updatedQueue[0] = { ...updatedQueue[0], pitchOffset: clamped };
          if (typeof window !== 'undefined' && window.karaokeApi) {
            window.karaokeApi.syncQueueCache(updatedQueue);
            window.karaokeApi.sendCommand('sync:queue', updatedQueue);
          }
          return { queue: updatedQueue };
        });
      },

      setPlaybackSpeed: (speed) => {
        const engine = coerceDspPitchEngine(get().settings.dspEngine);
        const clamped = clampSpeedForEngine(speed, engine);
        get().setPlaybackState({ playbackSpeed: clamped });
      },

      toggleMidiChannelMute: (channelIndex) => {
        if (channelIndex < 0 || channelIndex > 15) return;
        const currentMuted = get().playback.mutedMidiChannels;
        const exists = currentMuted.includes(channelIndex);
        const updated = exists
          ? currentMuted.filter((ch) => ch !== channelIndex)
          : [...currentMuted, channelIndex];

        get().setPlaybackState({ mutedMidiChannels: updated });
      },

      setVocalRemover: (active) => {
        get().setPlaybackState({
          isVocalRemoverActive: active
        });
      },

      setDucking: (active) => {
        get().setPlaybackState({ isDuckingActive: active });
      },

      // 3. Singer Profiles (Name, song count, favorites)
      singers: {},

      loadSingersFromDb: async () => {
        if (typeof window !== 'undefined' && window.karaokeApi) {
          try {
            const list = await window.karaokeApi.db.getAllSingers();
            const map: Record<string, SingerProfile> = {};
            list.forEach((s) => {
              map[s.id] = s;
            });
            set({ singers: map });
          } catch (err) {
            logStore('warn', 'Failed to load singers from db:', err);
          }
        }
      },

      getOrCreateSingerProfile: (name: string) => {
        const normalized = name.trim();
        // Look up by normalized name case-insensitively to prevent duplicates
        const existing = Object.values(get().singers).find(
          (s) => s.name.trim().toLowerCase() === normalized.toLowerCase()
        );
        if (existing) return existing;

        const id = `singer_${normalized.toLowerCase().replace(/\s+/g, '_')}`;
        const newProfile: SingerProfile = {
          id,
          name: normalized,
          songsSungCount: 0,
          isPermanentFavorite: false,
          createdAt: Date.now()
        };

        set((state) => ({
          singers: { ...state.singers, [id]: newProfile }
        }));

        if (typeof window !== 'undefined' && window.karaokeApi) {
          window.karaokeApi.db.getOrCreateSinger(normalized);
        }

        return newProfile;
      },

      removeSingerProfile: (singerId: string) => {
        set((state) => {
          const updatedSingers = { ...state.singers };
          delete updatedSingers[singerId];
          return { singers: updatedSingers };
        });

        if (typeof window !== 'undefined' && window.karaokeApi) {
          window.karaokeApi.db.deleteSinger(singerId);
        }
      },

      saveSingerPitchMemory: () => {
        // Deprecated: Pitch is assigned to queued song, not singer
      },

      incrementSingerCount: (singerId: string) => {
        set((state) => {
          const singer = state.singers[singerId];
          if (!singer) return state;
          return {
            singers: {
              ...state.singers,
              [singerId]: {
                ...singer,
                songsSungCount: singer.songsSungCount + 1,
                lastSungAt: Date.now()
              }
            }
          };
        });

        if (typeof window !== 'undefined' && window.karaokeApi) {
          window.karaokeApi.db.incrementSingerCount(singerId);
        }
      },

      // 4. Queue Management & Fair Queue
      queue: [],

      setQueueItemPitch: (queueId: string, pitchOffset: number) => {
        const engine = coerceDspPitchEngine(get().settings.dspEngine);
        const clamped = clampPitchForEngine(pitchOffset, engine);
        set((state) => {
          const itemIndex = state.queue.findIndex((q) => q.queueId === queueId);
          if (itemIndex === -1) return state;
          const updatedQueue = [...state.queue];
          updatedQueue[itemIndex] = { ...updatedQueue[itemIndex], pitchOffset: clamped };

          // If updating current active track (index 0), also update live pitch
          if (itemIndex === 0) {
            get().setPlaybackState({ livePitchOffset: clamped });
          }

          if (typeof window !== 'undefined' && window.karaokeApi) {
            window.karaokeApi.syncQueueCache(updatedQueue);
            window.karaokeApi.sendCommand('sync:queue', updatedQueue);
          }

          return { queue: updatedQueue };
        });
      },

      updateTrackInQueue: (trackId: string, updates: Partial<KaraokeMediaTrack>) => {
        set((state) => {
          let hasChanged = false;
          const updatedQueue = state.queue.map((item) => {
            if (
              item.track.id === trackId ||
              item.track.uri === trackId ||
              (item.track.localFilePath && item.track.localFilePath === trackId)
            ) {
              hasChanged = true;
              return {
                ...item,
                track: { ...item.track, ...updates }
              };
            }
            return item;
          });

          if (!hasChanged) return state;

          if (typeof window !== 'undefined' && window.karaokeApi) {
            window.karaokeApi.syncQueueCache(updatedQueue);
            window.karaokeApi.sendCommand('sync:queue', updatedQueue);
          }

          return { queue: updatedQueue };
        });
      },

      addToQueue: (
        track: KaraokeMediaTrack,
        singerName?: string,
        isVIP: boolean = false,
        pitchOffset: number = 0,
        placement: 'auto' | 'end' = 'auto'
      ) => {
        let assignedSingerId: string | undefined;
        let songsSung = 0;

        if (singerName && singerName.trim().length > 0) {
          const profile = get().getOrCreateSingerProfile(singerName);
          assignedSingerId = profile.id;
          songsSung = profile.songsSungCount;
        }

        const now = Date.now();
        const forceEnd = placement === 'end';
        const fairScore = calculateFairScore(songsSung, now, isVIP, forceEnd);

        const newItem: QueueItem = {
          queueId: `q_${now}_${Math.random().toString(36).substring(2, 6)}`,
          track,
          assignedSingerId,
          assignedSingerName: singerName?.trim() || undefined,
          pitchOffset:
            typeof pitchOffset === 'number'
              ? clampPitchForEngine(pitchOffset, coerceDspPitchEngine(get().settings.dspEngine))
              : 0,
          requestedAt: now,
          isVIPOverride: isVIP,
          forceEnd,
          fairScore
        };

        set((state) => {
          const updatedRaw = [...state.queue, newItem];
          const sorted = sortQueueByFairAlgorithm(updatedRaw, state.settings.enableFairQueue);

          if (typeof window !== 'undefined' && window.karaokeApi) {
            window.karaokeApi.syncQueueCache(sorted);
          }

          return { queue: sorted };
        });
      },

      addToQueueBatch: (items) => {
        if (!items?.length) return;
        const engine = coerceDspPitchEngine(get().settings.dspEngine);
        const newItems: QueueItem[] = [];
        let tick = Date.now();
        for (const entry of items) {
          const { track, singerName, isVIP = false, pitchOffset = 0, placement = 'auto' } = entry;
          let assignedSingerId: string | undefined;
          let songsSung = 0;
          if (singerName && singerName.trim().length > 0) {
            const profile = get().getOrCreateSingerProfile(singerName);
            assignedSingerId = profile.id;
            songsSung = profile.songsSungCount;
          }
          const now = tick++;
          const forceEnd = placement === 'end';
          newItems.push({
            queueId: `q_${now}_${Math.random().toString(36).substring(2, 6)}`,
            track,
            assignedSingerId,
            assignedSingerName: singerName?.trim() || undefined,
            pitchOffset:
              typeof pitchOffset === 'number'
                ? clampPitchForEngine(pitchOffset, engine)
                : 0,
            requestedAt: now,
            isVIPOverride: isVIP,
            forceEnd,
            fairScore: calculateFairScore(songsSung, now, isVIP, forceEnd)
          });
        }
        set((state) => {
          const updatedRaw = [...state.queue, ...newItems];
          const sorted = sortQueueByFairAlgorithm(updatedRaw, state.settings.enableFairQueue);
          if (typeof window !== 'undefined' && window.karaokeApi) {
            window.karaokeApi.syncQueueCache(sorted);
          }
          return { queue: sorted };
        });
      },

      removeFromQueue: (queueId: string) => {
        set((state) => {
          const target = state.queue.find((item) => item.queueId === queueId);
          const updated = state.queue.filter((item) => item.queueId !== queueId);
          if (typeof window !== 'undefined' && window.karaokeApi) {
            window.karaokeApi.syncQueueCache(updated);
          }
          if (target?.track.localFilePath) {
            cleanupQueueCacheFileIfUnreferenced(target.track.localFilePath, updated);
          }
          const trackId = target?.track.id;
          const missingTrackIds =
            trackId && state.missingTrackIds.includes(trackId)
              ? state.missingTrackIds.filter((id) => id !== trackId)
              : state.missingTrackIds;
          return { queue: updated, missingTrackIds };
        });
      },

      reorderQueue: (startIndex: number, endIndex: number) => {
        set((state) => {
          const result = Array.from(state.queue);
          const [removed] = result.splice(startIndex, 1);
          result.splice(endIndex, 0, removed);

          if (typeof window !== 'undefined' && window.karaokeApi) {
            window.karaokeApi.syncQueueCache(result);
          }
          return { queue: result };
        });
      },

      restoreFairQueueOrder: () => {
        set((state) => {
          if (state.queue.length <= 2) return state;
          const [current, ...rest] = state.queue;

          // Re-sort rest by Fair Queue rules
          const sortedRest = [...rest].sort((a, b) => {
            // VIP priority
            if (a.isVIPOverride && !b.isVIPOverride) return -1;
            if (!a.isVIPOverride && b.isVIPOverride) return 1;

            // forceEnd items at the end
            if (a.forceEnd && !b.forceEnd) return 1;
            if (!a.forceEnd && b.forceEnd) return -1;

            const singerA = a.assignedSingerId ? state.singers[a.assignedSingerId] : null;
            const singerB = b.assignedSingerId ? state.singers[b.assignedSingerId] : null;

            const countA = singerA ? singerA.songsSungCount : 0;
            const countB = singerB ? singerB.songsSungCount : 0;

            if (countA !== countB) {
              return countA - countB;
            }

            return (a.requestedAt || 0) - (b.requestedAt || 0);
          });

          const newQueue = [current, ...sortedRest];
          if (typeof window !== 'undefined' && window.karaokeApi) {
            window.karaokeApi.syncQueueCache(newQueue);
          }
          return { queue: newQueue };
        });
      },

      updateQueueItemSinger: (queueId: string, singerName: string) => {
        const trimmed = singerName.trim();
        let assignedSingerId: string | undefined;
        if (trimmed) {
          const profile = get().getOrCreateSingerProfile(trimmed);
          assignedSingerId = profile.id;
        }

        set((state) => {
          const updated = state.queue.map((item) => {
            if (item.queueId === queueId) {
              return {
                ...item,
                assignedSingerId,
                assignedSingerName: trimmed || undefined
              };
            }
            return item;
          });

          if (typeof window !== 'undefined' && window.karaokeApi) {
            window.karaokeApi.syncQueueCache(updated);
            window.karaokeApi.sendCommand('sync:queue', updated);
          }

          return { queue: updated };
        });
      },

      jumpToQueueItem: (queueIndex: number) => {
        const currentQueue = get().queue;
        if (queueIndex < 0 || queueIndex >= currentQueue.length) return;

        const targetItem = currentQueue[queueIndex];
        // Move targetItem to index 0, keeping all remaining items
        const remaining = currentQueue.filter((_, idx) => idx !== queueIndex);
        const newQueue = [targetItem, ...remaining];

        set(() => ({
          queue: newQueue,
          playback: {
            ...get().playback,
            currentTrackId: targetItem.track.id,
            livePitchOffset: targetItem.pitchOffset,
            currentTime: 0,
            isPlaying: true,
            activeLyricsText: undefined
          }
        }));

        if (typeof window !== 'undefined' && window.karaokeApi) {
          window.karaokeApi.syncQueueCache(newQueue);
          window.karaokeApi.sendCommand('sync:queue', newQueue);
          window.karaokeApi.sendStateSync(get().playback);
        }
      },

      logCurrentTrackExecution: (options?: { naturalEnd?: boolean }): boolean => {
        const { queue, playback } = get();
        if (queue.length === 0) return false;

        const currentItem = queue[0];
        if (!currentItem) return false;

        // Prevent duplicate logs for the same execution instance
        if (currentItem.alreadyLogged) {
          return false;
        }

        const isNaturalEnd = options?.naturalEnd === true;
        const currentElapsedSec = playback.currentTime || 0;
        // INVARIANT: SIAE threshold is 120s — do not lower without legal/ops sign-off
        const reachedMinThreshold = currentElapsedSec >= 120;

        // Strict criteria: must reach natural end OR be played for at least 120s (2 minutes)
        if (!isNaturalEnd && !reachedMinThreshold) {
          return false;
        }

        // Set flag to prevent future duplicate logging
        currentItem.alreadyLogged = true;

        const executedAt = Date.now();
        const durationSec = isNaturalEnd
          ? (currentItem.track.durationSec || Math.round(currentElapsedSec))
          : Math.round(currentElapsedSec);

        if (typeof window !== 'undefined' && window.karaokeApi?.db?.logSiae) {
          window.karaokeApi.db.logSiae({
            title: currentItem.track.title,
            artist: currentItem.track.artist,
            singer: currentItem.assignedSingerName,
            durationSec,
            executedAt
          });
        }

        return true;
      },

      advanceToNextTrack: (options?: { naturalEnd?: boolean }) => {
        if (transitionTimer) {
          clearTimeout(transitionTimer);
          transitionTimer = null;
        }

        const { queue } = get();
        if (queue.length === 0) return null;

        const currentFinished = queue[0];
        if (currentFinished.assignedSingerId) {
          get().incrementSingerCount(currentFinished.assignedSingerId);
        }

        // Record executed performance into persistent SQLite history if eligible
        // (Natural end reached, or played for >= 120s before being skipped, unless already logged)
        get().logCurrentTrackExecution(options);

        const nextQueue = queue.slice(1);

        // Clean up cached file if it resided in queue_cache and is no longer queued
        if (currentFinished.track.localFilePath) {
          cleanupQueueCacheFileIfUnreferenced(currentFinished.track.localFilePath, nextQueue);
        }

        const nextTrackItem = nextQueue[0] || null;
        const autoAdvance = get().settings.autoAdvanceNext;
        const pauseSec = get().settings.transitionPauseSec || 0;

        if (nextTrackItem) {
          if (autoAdvance) {
            if (pauseSec > 0) {
              set(() => ({
                queue: nextQueue,
                playback: {
                  ...INITIAL_PLAYBACK_STATE,
                  currentTrackId: nextTrackItem.track.id,
                  livePitchOffset: nextTrackItem.pitchOffset,
                  isPlaying: false,
                  currentTime: 0,
                  activeLyricsText: undefined
                }
              }));

              if (typeof window !== 'undefined' && window.karaokeApi) {
                window.karaokeApi.syncQueueCache(nextQueue);
                window.karaokeApi.sendStateSync(get().playback);
              }

              transitionTimer = setTimeout(() => {
                transitionTimer = null;
                get().setPlaybackState({ isPlaying: true });
              }, pauseSec * 1000);
            } else {
              set(() => ({
                queue: nextQueue,
                playback: {
                  ...INITIAL_PLAYBACK_STATE,
                  currentTrackId: nextTrackItem.track.id,
                  livePitchOffset: nextTrackItem.pitchOffset,
                  isPlaying: true,
                  currentTime: 0,
                  activeLyricsText: undefined
                }
              }));

              if (typeof window !== 'undefined' && window.karaokeApi) {
                window.karaokeApi.syncQueueCache(nextQueue);
                window.karaokeApi.sendStateSync(get().playback);
              }
            }
          } else {
            // Manual mode (autoAdvanceNext is false):
            // The completed song has ended, so advance queue to the next track,
            // but leave it PAUSED at 0:00 for the operator to press Play!
            set(() => ({
              queue: nextQueue,
              playback: {
                ...INITIAL_PLAYBACK_STATE,
                currentTrackId: nextTrackItem.track.id,
                livePitchOffset: nextTrackItem.pitchOffset,
                isPlaying: false,
                currentTime: 0,
                activeLyricsText: undefined
              }
            }));

            if (typeof window !== 'undefined' && window.karaokeApi) {
              window.karaokeApi.syncQueueCache(nextQueue);
              window.karaokeApi.sendStateSync(get().playback);
            }
          }
        } else {
          // No more tracks in queue
          set(() => ({
            queue: nextQueue,
            playback: {
              ...INITIAL_PLAYBACK_STATE,
              currentTrackId: undefined,
              livePitchOffset: 0,
              isPlaying: false,
              currentTime: 0,
              activeLyricsText: undefined
            }
          }));

          if (typeof window !== 'undefined' && window.karaokeApi) {
            window.karaokeApi.syncQueueCache(nextQueue);
            window.karaokeApi.sendStateSync(get().playback);
          }
        }

        return nextTrackItem;
      },

      clearQueue: () => {
        const { queue } = get();
        // Garbage collect all cached files from queue_cache upon queue purge
        for (const item of queue) {
          if (item.track.localFilePath) {
            cleanupQueueCacheFileIfUnreferenced(item.track.localFilePath, []);
          }
        }

        set((state) => ({
          queue: [],
          playback: {
            ...state.playback,
            isPlaying: false,
            currentTrackId: undefined,
            currentTime: 0,
            activeLyricsText: undefined
          }
        }));
        if (typeof window !== 'undefined' && window.karaokeApi) {
          window.karaokeApi.syncQueueCache([]);
          window.karaokeApi.sendStateSync(get().playback);
        }
      },

      // 5. Missing File Modal
      missingFileModal: {
        isOpen: false,
        filePath: '',
        trackTitle: '',
        trackArtist: '',
        context: 'queue'
      },

      missingTrackIds: [],

      markTrackMissing: (trackId: string) => {
        if (!trackId) return;
        set((state) =>
          state.missingTrackIds.includes(trackId)
            ? state
            : { missingTrackIds: [...state.missingTrackIds, trackId] }
        );
      },

      clearTrackMissing: (trackId: string) => {
        if (!trackId) return;
        set((state) => ({
          missingTrackIds: state.missingTrackIds.filter((id) => id !== trackId)
        }));
      },

      showMissingFileModal: (args: ShowMissingFileModalArgs) => {
        if (args.trackId) {
          get().markTrackMissing(args.trackId);
        }
        set({
          missingFileModal: {
            isOpen: true,
            filePath: args.filePath,
            trackTitle: args.trackTitle,
            trackArtist: args.trackArtist || '',
            trackId: args.trackId,
            queueItemId: args.queueItemId,
            context: args.context
          }
        });
      },

      closeMissingFileModal: () => {
        set({
          missingFileModal: {
            isOpen: false,
            filePath: '',
            trackTitle: '',
            trackArtist: '',
            context: 'queue'
          }
        });
      },

      // 6. Guest Portal Requests
      pendingGuestRequests: [],

      addGuestRequest: (req: GuestSongRequest) => {
        set((state) => ({
          pendingGuestRequests: [req, ...state.pendingGuestRequests]
        }));
      },

      approveGuestRequest: (requestId: string, track: KaraokeMediaTrack) => {
        const req = get().pendingGuestRequests.find((r) => r.requestId === requestId);
        if (!req) return;

        get().addToQueue(track, req.singerName, false, req.preferredPitch || 0);

        set((state) => ({
          pendingGuestRequests: state.pendingGuestRequests.filter((r) => r.requestId !== requestId)
        }));
      },

      rejectGuestRequest: (requestId: string) => {
        set((state) => ({
          pendingGuestRequests: state.pendingGuestRequests.filter((r) => r.requestId !== requestId)
        }));
      }
    }),
    {
      name: 'karaoke_station_storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        settings: state.settings,
        singers: state.singers,
        queue: state.queue
      }),
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<KaraokeStoreState>;
        const mergedSettings: AppSettings = {
          ...current.settings,
          ...(p.settings || {})
        };
        mergedSettings.stageMessages = patchStageMessages(
          current.settings.stageMessages,
          p.settings?.stageMessages || {}
        );
        // Live: algorithmic only. If a pre-split persist had AI on vocalRemoverAlgorithm, move it.
        const rawLive = mergedSettings.vocalRemoverAlgorithm as string;
        if (isAiVocalRemoverMethod(rawLive) && !p.settings?.instrumentalVocalRemoverMethod) {
          mergedSettings.instrumentalVocalRemoverMethod =
            coerceInstrumentalVocalRemoverMethod(rawLive);
        }
        mergedSettings.vocalRemoverAlgorithm =
          coerceAlgorithmicVocalRemoverMethod(mergedSettings.vocalRemoverAlgorithm);
        mergedSettings.instrumentalVocalRemoverMethod = coerceInstrumentalVocalRemoverMethod(
          mergedSettings.instrumentalVocalRemoverMethod
        );
        mergedSettings.mdxSegmentSize = coerceMdxSegmentSize(mergedSettings.mdxSegmentSize);
        mergedSettings.mdxOverlap = coerceMdxOverlap(mergedSettings.mdxOverlap);
        mergedSettings.mdxEnableOrt = coerceMdxEnableOrt(mergedSettings.mdxEnableOrt);
        mergedSettings.demucsShifts = coerceDemucsShifts(mergedSettings.demucsShifts);
        mergedSettings.demucsSegmentSize = coerceDemucsSegmentSize(
          mergedSettings.demucsSegmentSize
        );
        mergedSettings.demucsOverlap = coerceDemucsOverlap(mergedSettings.demucsOverlap);
        mergedSettings.aiCpuThreads = coerceAiCpuThreads(mergedSettings.aiCpuThreads);
        mergedSettings.aiEnableGpu = coerceAiEnableGpu(mergedSettings.aiEnableGpu);
        mergedSettings.dspEngine = coerceDspPitchEngine(mergedSettings.dspEngine);
        mergedSettings.autoMaximizeControlOnLaunch =
          typeof mergedSettings.autoMaximizeControlOnLaunch === 'boolean'
            ? mergedSettings.autoMaximizeControlOnLaunch
            : true;
        mergedSettings.autoOpenStageOnLaunch =
          typeof mergedSettings.autoOpenStageOnLaunch === 'boolean'
            ? mergedSettings.autoOpenStageOnLaunch
            : true;
        {
          const raw = String(mergedSettings.instrumentalSubtitlesPolicy || 'ask');
          mergedSettings.instrumentalSubtitlesPolicy =
            raw === 'always' || raw === 'never' ? raw : 'ask';
        }
        const maxDl = Number(mergedSettings.maxSimultaneousDownloads);
        mergedSettings.maxSimultaneousDownloads =
          Number.isFinite(maxDl) && maxDl >= 1 ? Math.min(8, Math.floor(maxDl)) : 2;
        return {
          ...current,
          ...p,
          settings: mergedSettings,
          singers: p.singers ?? current.singers,
          queue: p.queue ?? current.queue
        };
      }
    }
  )
);

// Safely prune unreferenced queue cache files after initial store hydration
if (typeof window !== 'undefined' && window.karaokeApi?.downloads?.cleanupUnreferencedCache) {
  setTimeout(() => {
    try {
      const activePaths = useKaraokeStore.getState().queue
        .map((item) => item.track.localFilePath)
        .filter((p): p is string => Boolean(p));
      window.karaokeApi?.downloads.cleanupUnreferencedCache(activePaths);
    } catch (err) {
      logStore('warn', 'Startup queue cache reconciliation skipped:', err);
    }
  }, 4000);
}
