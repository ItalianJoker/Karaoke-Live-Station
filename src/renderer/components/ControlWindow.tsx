import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Mic,
  Music,
  Sliders,
  Sparkles,
  QrCode,
  Trash2,
  Settings,
  Users,
  Smartphone,
  Layers,
  Check,
  X,
  Search,
  ChevronDown,
  User,
  Star,
  History,
  Download,
  XCircle,
  HelpCircle,
  Info,
  AudioLines
} from 'lucide-react';
import { useKaraokeStore } from '../store/karaokeStore';
import { AudioGraphManager } from '../core/AudioGraphManager';
import {
  getPitchRangeForEngine,
  getSpeedRangeForEngine,
  coerceDspPitchEngine
} from '../../shared/dspPitch';

import { MidiChannelMixer } from './MidiChannelMixer';
import { LibraryPanel } from './LibraryPanel';
import { HistoryPanel } from './HistoryPanel';
import { SettingsModal } from './SettingsModal';
import { MissingFileModal } from './MissingFileModal';
import { PlayerDeckControls } from './PlayerDeckControls';
import { QueueList } from './QueueList';
import { useControlPlayback } from '../hooks/useControlPlayback';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { resolveDroppedAbsolutePaths } from '../utils/fsDragDrop';
import {
  checkTrackLocalFileExists,
  trackNeedsLocalFileCheck
} from '../utils/localFileCheck';
import { ToastHost } from './ToastHost';
import { showToast, confirmAsync } from '../utils/toast';
import { SingersModal } from './SingersModal';
import { GuestRequestsModal } from './GuestRequestsModal';
import { FirewallGuideCard } from './FirewallGuideCard';
import { ShortcutsHelpModal } from './ShortcutsHelpModal';
import { StudioDeskShell } from './StudioDeskShell';
import { StudioPlayerDeckControls } from './StudioPlayerDeckControls';
import { AppSettings, DownloadProgressPayload } from '../../shared/types';
import { textMatchesSearch } from '../../shared/textNormalize';
import appLogo from '../assets/logo.png';


function logControl(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void {
  try {
    window.karaokeApi?.logger?.log(level, 'ControlWindow', message, data);
  } catch {
    /* ignore */
  }
}


/**
 * ControlWindow (Regia Operator Console)
 *
 * This is the primary mission-control window used by the karaoke operator/DJ.
 * Key responsibilities:
 * 1. Audio & Video Playback:
 *    - Hosts the hidden/docked `<video>` element for MP4/WEBM tracks.
 *    - Integrates with AudioGraphManager for real-time Web Audio DSP (pitch shifting in semitones,
 *      vocal cancellation via center-channel attenuation, mic ducking, and SpessaSynth MIDI synthesis).
 * 2. Stage Sync Dispatch:
 *    - Continuously transmits authoritative playback state (currentTime, isPlaying, duration, pitch)
 *      and queue updates to the separate audience-facing StageWindow via Electron IPC.
 * 3. Fair Queue & Singer Management:
 *    - Renders the fair-queue rotation with live singer combobox auto-complete and search.
 *    - Allows manual track jumps, per-track pitch pre-adjustment, and instant queue manipulation.
 * 4. Timeline Scrubbing & Seeking:
 *    - Interactive progress bar with real-time frame seeking and synchronized timecode broadcasts.
 * 5. Headphone CUE & Library Management:
 *    - Independent CUE preview routing to secondary soundcards for pre-listening tracks.
 *    - Integrated local SQLite database search and yt-dlp web downloader with live progress updates.
 * 6. Historical Execution Log & SIAE Reporting:
 *    - Dedicated History tab tracking completed song executions with performer names, timestamps, and durations.
 *    - 1-click SIAE / copyright CSV borderò export and persistent execution clearing.
 */
export const ControlWindow: React.FC = () => {
  const { t } = useTranslation();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioGraphRef = useRef<AudioGraphManager | null>(null);

  // Modals visibility
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showSingersModal, setShowSingersModal] = useState(false);
  const [showGuestModal, setShowGuestModal] = useState(false);
  const [showPortalQrModal, setShowPortalQrModal] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showDspCompare, setShowDspCompare] = useState(false);
  const [showDownloadsMenu, setShowDownloadsMenu] = useState(false);
  const [headerDownloads, setHeaderDownloads] = useState<Record<string, DownloadProgressPayload>>(
    {}
  );
  const downloadsMenuRef = useRef<HTMLDivElement>(null);

  // View tabs on right panel: 'queue' | 'library' | 'history'
  const [activeRightTab, setActiveRightTab] = useState<'queue' | 'library' | 'history'>(() => {
    try {
      const saved = sessionStorage.getItem('kls.control.activeRightTab');
      if (saved === 'library' || saved === 'history' || saved === 'queue') return saved;
    } catch {
      // ignore
    }
    return 'queue';
  });

  const [portalInfo, setPortalInfo] = useState<{ enabled: boolean; url: string; qrCode: string; port?: number; ip?: string }>({
    enabled: false,
    url: '',
    qrCode: ''
  });

  useEffect(() => {
    if (showPortalQrModal && window.karaokeApi?.guestPortal) {
      window.karaokeApi.guestPortal.getInfo().then(setPortalInfo);
    }
  }, [showPortalQrModal]);

  useEffect(() => {
    if (!showDownloadsMenu) return;
    const onDoc = (ev: MouseEvent) => {
      const el = downloadsMenuRef.current;
      const target = ev.target as Node;
      // Studio Desk portals the downloads panel to document.body — ignore clicks inside it.
      const studioPortal = document.querySelector('[data-testid="studio-downloads-menu"]');
      if (el && el.contains(target)) return;
      if (studioPortal && studioPortal.contains(target)) return;
      setShowDownloadsMenu(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [showDownloadsMenu]);

  const [editingSingerItem, setEditingSingerItem] = useState<import('../../shared/types').QueueItem | null>(null);
  const [editingSingerText, setEditingSingerText] = useState<string>('');
  const [isSingerDropdownOpen, setIsSingerDropdownOpen] = useState<boolean>(false);
  const [singerHighlightIndex, setSingerHighlightIndex] = useState<number>(-1);
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [stageOpen, setStageOpen] = useState(true);
  const [activeCueUri, setActiveCueUri] = useState<string | undefined>(undefined);
  const [downloadProgress, setDownloadProgress] = useState<{ percent: number; speed: string } | null>(null);
  /** OS file drop onto the queue panel (distinct from in-app reorder). */
  const [queueFileDropActive, setQueueFileDropActive] = useState(false);
  const [isImportingQueueDrop, setIsImportingQueueDrop] = useState(false);
  const loadedTrackQueueIdRef = useRef<string | null>(null);
  /** Media identity for the currently loaded element (queueId + local path/uri). */
  const loadedTrackMediaKeyRef = useRef<string | null>(null);

  // Store hooks
  const settings = useKaraokeStore((state) => state.settings);
  const playback = useKaraokeStore((state) => state.playback);
  const setPlaybackState = useKaraokeStore((state) => state.setPlaybackState);
  const toggleMidiChannelMute = useKaraokeStore((state) => state.toggleMidiChannelMute);

  const queue = useKaraokeStore((state) => state.queue);
  const addToQueueBatch = useKaraokeStore((state) => state.addToQueueBatch);
  const updateTrackInQueue = useKaraokeStore((state) => state.updateTrackInQueue);
  const updateQueueItemSinger = useKaraokeStore((state) => state.updateQueueItemSinger);
  const advanceToNextTrack = useKaraokeStore((state) => state.advanceToNextTrack);
  const clearTrackMissing = useKaraokeStore((state) => state.clearTrackMissing);
  const pendingRequests = useKaraokeStore((state) => state.pendingGuestRequests);
  const storeSingers = useKaraokeStore((state) => state.singers);

  const currentQueueItem = queue[0];
  const currentTrack = currentQueueItem?.track;
  const pitchRange = getPitchRangeForEngine(coerceDspPitchEngine(settings.dspEngine));
  const speedRange = getSpeedRangeForEngine(coerceDspPitchEngine(settings.dspEngine));
  const isMidiTrack = Boolean(
    currentTrack &&
      (currentTrack.uri.endsWith('.mid') ||
        currentTrack.uri.endsWith('.kar') ||
        currentTrack.localFilePath?.endsWith('.mid') ||
        currentTrack.localFilePath?.endsWith('.kar') ||
        currentTrack.source === 'midi')
  );

  const knownSingersList = React.useMemo(() => {
    const map = new Map<string, { name: string; isFavorite: boolean; songCount: number }>();
    if (storeSingers) {
      Object.values(storeSingers).forEach((s) => {
        if (s?.name?.trim()) {
          const key = s.name.trim().toLowerCase();
          map.set(key, {
            name: s.name.trim(),
            isFavorite: Boolean(s.isPermanentFavorite),
            songCount: s.songsSungCount || 0
          });
        }
      });
    }
    queue.forEach((item) => {
      const trimmed = item.assignedSingerName?.trim();
      if (trimmed) {
        const key = trimmed.toLowerCase();
        if (!map.has(key)) {
          map.set(key, {
            name: trimmed,
            isFavorite: false,
            songCount: 1
          });
        }
      }
    });
    return Array.from(map.values()).sort((a, b) => {
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      if (b.songCount !== a.songCount) return b.songCount - a.songCount;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
  }, [storeSingers, queue]);

  const filteredSingers = React.useMemo(() => {
    const query = editingSingerText.trim();
    if (!query) return knownSingersList;
    return knownSingersList.filter((s) => textMatchesSearch(s.name, query));
  }, [knownSingersList, editingSingerText]);

  // Keep playback.currentTrackId in sync with currentTrack
  useEffect(() => {
    if (currentTrack?.id) {
      if (playback.currentTrackId !== currentTrack.id) {
        setPlaybackState({ currentTrackId: currentTrack.id });
      }
    } else if (playback.currentTrackId) {
      setPlaybackState({ currentTrackId: undefined });
    }
  }, [currentTrack?.id, playback.currentTrackId, setPlaybackState]);

  const {
    pauseResetForMissingFile,
    openMissingForQueueItem,
    handleJumpToTrack,
    handlePlayCue,
    handleStopCue,
    handlePlayPause,
    handleStop,
    handleSeek,
    handleRestart
  } = useControlPlayback({
    audioGraphRef,
    videoRef,
    currentTrack,
    currentQueueItem,
    isMidiTrack,
    isPlaying: playback.isPlaying,
    duration: playback.duration,
    cueAudioDeviceId: settings.cueAudioDeviceId,
    setActiveCueUri
  });

  const [savingTrackIds, setSavingTrackIds] = useState<Set<string>>(new Set());


  /**
   * Import OS-dropped files into the catalog, then enqueue each track.
   * Why: Files-type only — must not interfere with queue reorder DnD (text/plain index).
   */
  const handleOsQueueFileDrop = async (fileList: FileList | null) => {
    if (!window.karaokeApi?.library?.importFiles || isImportingQueueDrop) return;
    const paths = resolveDroppedAbsolutePaths(fileList);
    if (!paths.length) {
      showToast(t('library.importNoFiles'), 'warning');
      return;
    }
    setIsImportingQueueDrop(true);
    try {
      const imported = await window.karaokeApi.library.importFiles(paths);
      if (!imported.length) {
        showToast(t('library.importNoFiles'), 'warning');
        return;
      }
      addToQueueBatch(
        imported.map((track) => ({
          track,
          singerName: undefined,
          isVIP: false,
          pitchOffset: 0,
          placement: 'auto' as const
        }))
      );
      showToast(t('queue.importDropped', { count: imported.length }), 'success');
    } catch (err) {
      logControl('error', 'Queue OS drop import error:', err);
      showToast(t('library.importFailed'), 'error');
    } finally {
      setIsImportingQueueDrop(false);
      setQueueFileDropActive(false);
    }
  };

  const handleSaveToPermanentLibrary = async (track: any) => {
    if (!window.karaokeApi?.downloads?.saveToLibrary) return;
    if (!track.localFilePath) {
      showToast(t('library.missingFile'));
      return;
    }

    setSavingTrackIds((prev) => new Set(prev).add(track.id));
    try {
      const saved = await window.karaokeApi.downloads.saveToLibrary({
        tempFilePath: track.localFilePath,
        title: track.title,
        artist: track.artist,
        durationSec: track.durationSec,
        targetDirectory: settings.libraryPath || undefined,
        trackId: track.id
      });

      updateTrackInQueue(track.id, {
        localFilePath: saved.localFilePath,
        uri: saved.uri,
        source: 'local_library'
      });
      updateTrackInQueue(track.uri, {
        localFilePath: saved.localFilePath,
        uri: saved.uri,
        source: 'local_library'
      });
      if (track.localFilePath) {
        updateTrackInQueue(track.localFilePath, {
          localFilePath: saved.localFilePath,
          uri: saved.uri,
          source: 'local_library'
        });
      }

      window.dispatchEvent(new CustomEvent('karaoke:library-refreshed'));
    } catch (err: any) {
      logControl('error', 'Failed to save track to library:', err);
      showToast(t('errors.downloadFailed', { error: err?.message || String(err) }));
    } finally {
      setSavingTrackIds((prev) => {
        const next = new Set(prev);
        next.delete(track.id);
        return next;
      });
    }
  };

  // Initialize AudioGraphManager
  useEffect(() => {
    const manager = new AudioGraphManager();
    audioGraphRef.current = manager;
    // Mute watchdog / init failure → SoundTouch: sync Settings + clamp live pitch/speed UI.
    manager.setDspEngineFallbackHandler((engine) => {
      const store = useKaraokeStore.getState();
      store.updateSettings({ dspEngine: engine });
      store.setLivePitch(store.playback.livePitchOffset);
      store.setPlaybackSpeed(store.playback.playbackSpeed);
    });
    manager.setAudioNormalization(useKaraokeStore.getState().settings.enableAudioNormalization ?? true);

    if (videoRef.current) {
      manager.bindMediaElement(videoRef.current);
    }

    if (window.karaokeApi?.system?.initPaths) {
      const curSettings = useKaraokeStore.getState().settings;
      window.karaokeApi.system
        .initPaths({
          libraryPath: curSettings.libraryPath,
          midiSoundFontPath: curSettings.midiSoundFontPath
        })
        .then((res) => {
          if (res) {
            const updates: Partial<AppSettings> = {};
            if (res.midiSoundFontPath && res.midiSoundFontPath !== curSettings.midiSoundFontPath) {
              updates.midiSoundFontPath = res.midiSoundFontPath;
            }
            if (res.libraryPath && res.libraryPath !== curSettings.libraryPath) {
              updates.libraryPath = res.libraryPath;
            }
            if (Object.keys(updates).length > 0) {
              useKaraokeStore.getState().updateSettings(updates);
            }

            // Always perform an automatic refresh of the current library on startup if configured
            const effectiveLibrary = res.libraryPath || curSettings.libraryPath;
            if (effectiveLibrary) {
              window.karaokeApi.library
                .scanFolder(effectiveLibrary)
                .then((tracks) => {
                  window.dispatchEvent(
                    new CustomEvent('karaoke:library-refreshed', {
                      detail: { count: tracks?.length || 0 }
                    })
                  );
                })
                .catch((err) => logControl('warn', 'Startup library refresh warning:', err));
            }
          }
        })
        .catch((err) => logControl('warn', 'Path initialization notice:', err));
    } else if (window.karaokeApi?.system?.getDefaultSoundFont) {
      window.karaokeApi.system.getDefaultSoundFont().then((defaultSf) => {
        if (defaultSf) {
          const curSf = useKaraokeStore.getState().settings.midiSoundFontPath;
          if (!curSf || curSf.includes('default-GM.sf2') || curSf.includes('FluidR3_GM.sf2')) {
            useKaraokeStore.getState().updateSettings({ midiSoundFontPath: defaultSf });
          }
        }
      });
    }

    manager.registerLyricCallback((lyric) => {
      setPlaybackState({ activeLyricsText: lyric?.text });
    });

    manager.registerPlaybackEndCallback(() => {
      advanceToNextTrack({ naturalEnd: true });
    });

    if (window.karaokeApi) {
      window.karaokeApi.guestPortal.getInfo().then(setPortalInfo);
      useKaraokeStore.getState().loadSingersFromDb();

      // Sync initial store state to main process immediately on mount
      const initQueue = useKaraokeStore.getState().queue;
      const initSettings = useKaraokeStore.getState().settings;
      let initPlayback = useKaraokeStore.getState().playback;

      if (initQueue.length > 0 && !initPlayback.currentTrackId) {
        initPlayback = {
          ...initPlayback,
          currentTrackId: initQueue[0].track.id,
          livePitchOffset: initQueue[0].pitchOffset,
          isPlaying: false,
          currentTime: 0
        };
        useKaraokeStore.getState().setPlaybackState(initPlayback);
      }

      window.karaokeApi.syncQueueCache(initQueue);
      window.karaokeApi.sendCommand('sync:queue', initQueue);
      window.karaokeApi.sendCommand('sync:settings', initSettings);
      window.karaokeApi.sendStateSync(initPlayback);

      const unSubGuest = window.karaokeApi.guestPortal.onRequestReceived((req) => {
        useKaraokeStore.getState().addGuestRequest(req);
      });

      const unSubStageStatus = window.karaokeApi.onStageStatusChange(({ isOpen }) => {
        setStageOpen(isOpen);
        if (isOpen) {
          const curQueue = useKaraokeStore.getState().queue;
          const curSettings = useKaraokeStore.getState().settings;
          const curPlayback = {
            ...useKaraokeStore.getState().playback,
            currentTime: videoRef.current ? videoRef.current.currentTime : useKaraokeStore.getState().playback.currentTime
          };
          window.karaokeApi?.sendCommand('sync:queue', curQueue);
          window.karaokeApi?.sendCommand('sync:settings', curSettings);
          window.karaokeApi?.sendStateSync(curPlayback);
        }
      });

      const unSubDownloads = window.karaokeApi.downloads.onProgress((payload) => {
        setHeaderDownloads((prev) => {
          const next = { ...prev, [payload.downloadId]: payload };
          if (
            payload.status === 'completed' ||
            payload.status === 'error' ||
            payload.status === 'cancelled'
          ) {
            // Keep terminal rows longer for reuse/error notices so operators can read them
            const holdMs = payload.alreadyExists || payload.status === 'error' ? 8000 : 4000;
            setTimeout(() => {
              setHeaderDownloads((cur) => {
                const copy = { ...cur };
                delete copy[payload.downloadId];
                return copy;
              });
            }, holdMs);
          }
          return next;
        });
        // Open Downloads menu for operator-facing notices that used to toast outside the queue
        if (payload.alreadyExists || payload.status === 'error' || payload.status === 'queued') {
          setShowDownloadsMenu(true);
        }
        if (payload.status === 'downloading') {
          setDownloadProgress({ percent: payload.percent, speed: payload.speed || '' });
        } else if (
          payload.status === 'converting' ||
          payload.status === 'processing' ||
          payload.status === 'downloading_model' ||
          payload.status === 'removing_vocals' ||
          payload.status === 'remuxing'
        ) {
          // Conversion phase: keep percent for any legacy UI, clear speed
          setDownloadProgress({ percent: payload.percent, speed: '' });
        } else if (payload.status === 'completed' && payload.outputFilePath) {
          setDownloadProgress(null);
          const cur = useKaraokeStore.getState().queue[0]?.track;
          const autoArchive = useKaraokeStore.getState().settings.autoArchiveWebTracks;
          // When auto-archive is on, LibraryPanel promotes temp → permanent library and
          // updates the queue. Do not bind playback to a temp path that will be moved/deleted.
          if (cur && cur.source === 'youtube' && !cur.localFilePath && !autoArchive) {
            const localUri = `karaoke://local/${encodeURIComponent(payload.outputFilePath)}`;
            updateTrackInQueue(cur.id, {
              localFilePath: payload.outputFilePath,
              uri: localUri
            });
          }
        } else if (payload.status === 'error' || payload.status === 'cancelled') {
          setDownloadProgress(null);
        }
      });

      return () => {
        unSubGuest();
        unSubStageStatus();
        unSubDownloads();
        manager.dispose();
      };
    }

    return () => {
      manager.dispose();
    };
  }, []);

  
  // Keep algorithmic vocal remover in sync when the active track changes
  useEffect(() => {
    audioGraphRef.current?.refreshVocalRemoverForCurrentMedia();
  }, [playback.currentTrackId]);

  // Update Audio Graph on DSP state change (decoupled from currentTime tracking to eliminate stutter)
  const mutedMidiChannelsKey = playback.mutedMidiChannels.slice().sort().join(',');

  useEffect(() => {
    if (!audioGraphRef.current) return;
    audioGraphRef.current.setDspEngine(settings.dspEngine || 'signalsmith');
    audioGraphRef.current.setPitchOffset(playback.livePitchOffset);
    audioGraphRef.current.setPlaybackSpeed(playback.playbackSpeed);
    audioGraphRef.current.setMutedMidiChannels(playback.mutedMidiChannels);
    audioGraphRef.current.setVocalRemoverAlgorithm(
      settings.vocalRemoverAlgorithm || 'centerCancelBassKeep'
    );
    audioGraphRef.current.setVocalRemover(playback.isVocalRemoverActive);
    audioGraphRef.current.setDucking(playback.isDuckingActive);
    audioGraphRef.current.setMasterVolume(playback.masterVolume, playback.isMuted);
    audioGraphRef.current.setAudioVideoSyncOffsetMs(settings.audioVideoSyncOffsetMs);
    audioGraphRef.current.setAudioNormalization(settings.enableAudioNormalization ?? true);

    if (videoRef.current) {
      videoRef.current.preservesPitch = true;
      (videoRef.current as any).mozPreservesPitch = true;
      (videoRef.current as any).webkitPreservesPitch = true;
      // Hi-Fi (Signalsmith) + SoundTouch: media element drives tempo; Hi-Fi compensates pitch.
      videoRef.current.playbackRate = playback.playbackSpeed;
    }
  }, [
    playback.livePitchOffset,
    playback.playbackSpeed,
    mutedMidiChannelsKey,
    playback.isVocalRemoverActive,
    playback.isDuckingActive,
    playback.masterVolume,
    playback.isMuted,
    settings.audioVideoSyncOffsetMs,
    settings.enableAudioNormalization,
    settings.vocalRemoverAlgorithm,
    settings.dspEngine
  ]);

  // Keep SoundFont in sync if changed from settings
  // Load SoundFont when path is set — skip ephemeral AppImage mounts (initPaths re-seeds userData)
  useEffect(() => {
    if (settings.midiSoundFontPath && audioGraphRef.current) {
      const sf = settings.midiSoundFontPath.replace(/\\/g, '/');
      if (sf.includes('/.mount_')) {
        return;
      }
      audioGraphRef.current.loadSoundFont(settings.midiSoundFontPath);
    }
  }, [settings.midiSoundFontPath]);

  // Continuous Time Tracking for MIDI / KAR playback
  useEffect(() => {
    if (!isMidiTrack || !playback.isPlaying) return;

    const timer = window.setInterval(() => {
      if (!audioGraphRef.current) return;
      const ms = audioGraphRef.current.getMidiCurrentTimeMs();
      const sec = ms / 1000;
      setPlaybackState({ currentTime: sec });
    }, 100);

    return () => {
      clearInterval(timer);
    };
  }, [isMidiTrack, playback.isPlaying, setPlaybackState]);

  // Main Playback Coordinator Effect
  // Guards local paths before AudioGraph / <video> feed (jump, play, auto-advance).
  useEffect(() => {
    if (!currentTrack || !currentQueueItem) {
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      }
      audioGraphRef.current?.stopMidiPlayback();
      setPlaybackState({ activeLyricsText: undefined });
      loadedTrackQueueIdRef.current = null;
      loadedTrackMediaKeyRef.current = null;
      return;
    }

    // If it's a YouTube track and has no local file, initiate download (with local dedup)
    if (currentTrack.source === 'youtube' && !currentTrack.localFilePath) {
      if (!downloadProgress && window.karaokeApi) {
        setDownloadProgress({ percent: 0, speed: '' });
        const settingsSnapshot = useKaraokeStore.getState().settings;
        window.karaokeApi.downloads
          .start({
            url: currentTrack.uri,
            titleHint: currentTrack.title,
            artistHint: currentTrack.artist,
            trackId: currentTrack.id,
            libraryPath: settingsSnapshot.libraryPath || undefined
          })
          .then((result) => {
            if (result.alreadyExists && result.localFilePath) {
              setDownloadProgress(null);
              const localUri =
                result.uri || `karaoke://local/${encodeURIComponent(result.localFilePath)}`;
              updateTrackInQueue(currentTrack.id, {
                localFilePath: result.localFilePath,
                uri: localUri,
                source: result.location === 'library' ? 'local_library' : currentTrack.source
              });
            }
          })
          .catch((err) => {
            logControl('error', 'Failed to auto-download YouTube track:', err);
            setDownloadProgress(null);
          });
      }
      return;
    }

    let cancelled = false;

    const coordinatePlayback = async () => {
      // Disk probe before MIDI / video graph — never uncaught rejection
      if (trackNeedsLocalFileCheck(currentTrack)) {
        const check = await checkTrackLocalFileExists(currentTrack);
        if (cancelled) return;
        if (!check.exists) {
          pauseResetForMissingFile();
          openMissingForQueueItem(currentTrack, check.path, currentQueueItem.queueId);
          loadedTrackQueueIdRef.current = null;
          loadedTrackMediaKeyRef.current = null;
          return;
        }
        clearTrackMissing(currentTrack.id);
      }

      if (cancelled) return;

      // Native CD+G ZIP: extract on demand, then play audio via karaoke://local/
      let playUri = currentTrack.uri;
      if (
        currentTrack.localFilePath &&
        /\.zip$/i.test(currentTrack.localFilePath) &&
        window.karaokeApi?.library?.ensureZipPlayback
      ) {
        const alreadyExtracted =
          currentTrack.cdgFilePath &&
          currentTrack.uri &&
          !/\.zip$/i.test(currentTrack.uri) &&
          currentTrack.uri.includes('zip_cache');
        if (!alreadyExtracted) {
          try {
            const zipResult = await window.karaokeApi.library.ensureZipPlayback({
              trackId: currentTrack.id,
              zipPath: currentTrack.localFilePath
            });
            if (cancelled) return;
            if (!zipResult?.success || !zipResult.audioUri) {
              pauseResetForMissingFile();
              openMissingForQueueItem(
                currentTrack,
                currentTrack.localFilePath,
                currentQueueItem.queueId
              );
              return;
            }
            playUri = zipResult.audioUri;
            updateTrackInQueue(currentTrack.id, {
              uri: zipResult.audioUri,
              cdgFilePath: zipResult.cdgPath
            });
          } catch (err) {
            logControl('error', 'ZIP CD+G extract failed:', err);
            if (!cancelled) {
              pauseResetForMissingFile();
              openMissingForQueueItem(
                currentTrack,
                currentTrack.localFilePath,
                currentQueueItem.queueId
              );
            }
            return;
          }
        } else {
          playUri = currentTrack.uri;
        }
      }

      const mediaKey = `${currentQueueItem.queueId}::${currentTrack.localFilePath || currentTrack.uri}`;
      const isNewTrackLoaded = loadedTrackMediaKeyRef.current !== mediaKey;

      // If track is MIDI/KAR
      if (isMidiTrack) {
        if (isNewTrackLoaded) {
          loadedTrackQueueIdRef.current = currentQueueItem.queueId;
          loadedTrackMediaKeyRef.current = mediaKey;
          // Instantly stop previous MIDI playback BEFORE starting fetch
          audioGraphRef.current?.stopMidiPlayback();
          // Unload any existing video playback
          if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.removeAttribute('src');
            videoRef.current.load();
          }
          setPlaybackState({ activeLyricsText: undefined, currentTime: 0 });

          const mediaKeyToLoad = mediaKey;
          fetch(currentTrack.uri)
            .then((res) => {
              if (!res.ok) {
                throw new Error(`MIDI fetch failed: ${res.status}`);
              }
              return res.arrayBuffer();
            })
            .then(async (buffer) => {
              // Guard against race conditions when skipping tracks rapidly
              if (cancelled || loadedTrackMediaKeyRef.current !== mediaKeyToLoad) return;
              await audioGraphRef.current?.initContext();
              const song = await audioGraphRef.current?.loadMidiSong(buffer);
              if (song && loadedTrackMediaKeyRef.current === mediaKeyToLoad) {
                // Prefer MIDI-declared BPM when catalog has none yet
                if (song.initialBpm && !currentTrack.initialBpm) {
                  updateTrackInQueue(currentTrack.id, { initialBpm: song.initialBpm });
                }
                setPlaybackState({ duration: song.durationMs / 1000, currentTime: 0 });
                if (useKaraokeStore.getState().playback.isPlaying) {
                  audioGraphRef.current?.playMidi();
                }
              }
            })
            .catch((err) => {
              logControl('error', 'Failed to load MIDI file:', err);
              if (cancelled) return;
              // Treat fetch failure (missing file behind karaoke://) as missing media
              if (trackNeedsLocalFileCheck(currentTrack) || currentTrack.localFilePath) {
                pauseResetForMissingFile();
                openMissingForQueueItem(
                  currentTrack,
                  currentTrack.localFilePath || currentTrack.uri,
                  currentQueueItem.queueId
                );
              }
            });
        } else {
          if (playback.isPlaying) {
            audioGraphRef.current?.playMidi();
          } else {
            audioGraphRef.current?.pauseMidi();
          }
        }
      } else {
        // Audio or Video file
        if (videoRef.current) {
          if (isNewTrackLoaded) {
            loadedTrackQueueIdRef.current = currentQueueItem.queueId;
            loadedTrackMediaKeyRef.current = mediaKey;
            // Stop MIDI voices and clear lyric text
            audioGraphRef.current?.stopMidiPlayback();
            setPlaybackState({ activeLyricsText: undefined, currentTime: 0 });

            videoRef.current.src = playUri;
            videoRef.current.load();
            videoRef.current.preservesPitch = true;
            (videoRef.current as any).mozPreservesPitch = true;
            (videoRef.current as any).webkitPreservesPitch = true;
            // Hi-Fi (Signalsmith) + SoundTouch: media element drives tempo; Hi-Fi compensates pitch.
            videoRef.current.playbackRate = playback.playbackSpeed;
          }

          if (playback.isPlaying) {
            audioGraphRef.current?.initContext().then(() => {
              if (cancelled || !videoRef.current) return;
              audioGraphRef.current?.bindMediaElement(videoRef.current);
              videoRef.current.play().catch((err) => {
                logControl('warn', 'Playback play() was rejected:', err);
                // Media error often means missing/unreadable file after USB unplug mid-session
                const mediaErr = videoRef.current?.error;
                if (mediaErr && trackNeedsLocalFileCheck(currentTrack)) {
                  pauseResetForMissingFile();
                  openMissingForQueueItem(
                    currentTrack,
                    currentTrack.localFilePath || currentTrack.uri,
                    currentQueueItem.queueId
                  );
                }
              });
            });
          } else {
            videoRef.current.pause();
          }
        }
      }
    };

    void coordinatePlayback();

    return () => {
      cancelled = true;
    };
  }, [
    currentQueueItem?.queueId,
    currentTrack?.id,
    currentTrack?.uri,
    currentTrack?.localFilePath,
    currentTrack?.cdgFilePath,
    playback.isPlaying,
    isMidiTrack,
    downloadProgress
  ]);

  useEffect(() => {
    try {
      sessionStorage.setItem('kls.control.activeRightTab', activeRightTab);
    } catch {
      // ignore
    }
  }, [activeRightTab]);

  useKeyboardShortcuts({
    audioGraphRef,
    searchInputRef,
    handlePlayPause,
    handleStop,
    handleRestart,
    handleSeek,
    setActiveRightTab,
    setShowSettingsModal,
    setShowSingersModal,
    setShowGuestModal,
    setShowPortalQrModal,
    setShowShortcutsModal
  });

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  /** Opt-in Studio Desk shell — classic Regia header/grid stays on all other themes. */
  const isStudioDesk = settings.themeHost === 'studio-desk';
  /** Bumped by Studio «Ricerca» to force LibraryPanel onto Web/YouTube. */
  const [studioWebSearchNonce, setStudioWebSearchNonce] = useState(0);
  /** Bumped by Studio «Libreria» to force LibraryPanel onto Locale. */
  const [studioLocalSearchNonce, setStudioLocalSearchNonce] = useState(0);
  /** Studio MIDI mixer column visibility (toggle lives in transport row). */
  const [showStudioMidiMixer, setShowStudioMidiMixer] = useState(false);

  useEffect(() => {
    if (!isMidiTrack) setShowStudioMidiMixer(false);
  }, [isMidiTrack]);

  const libraryPanelNode = (
    <LibraryPanel
      onPlayCue={handlePlayCue}
      onStopCue={handleStopCue}
      activeCueUri={activeCueUri}
      searchInputRef={searchInputRef}
      webSearchNonce={studioWebSearchNonce}
      localSearchNonce={studioLocalSearchNonce}
      embedded
    />
  );

  const queuePanelNode = (
    <QueueList
      isPlaying={playback.isPlaying}
      enableFairQueue={Boolean(settings.enableFairQueue)}
      queueFileDropActive={queueFileDropActive}
      setQueueFileDropActive={setQueueFileDropActive}
      onOsFileDrop={(files) => { void handleOsQueueFileDrop(files); }}
      onPlayPause={() => { void handlePlayPause(); }}
      onStop={handleStop}
      onJumpToTrack={(index) => { void handleJumpToTrack(index); }}
      onSaveToPermanentLibrary={handleSaveToPermanentLibrary}
      savingTrackIds={savingTrackIds}
      onEditSinger={(item) => {
        setEditingSingerItem(item);
        setEditingSingerText(item.assignedSingerName || '');
      }}
      embedded
    />
  );

  const historyPanelNode = <HistoryPanel embedded />;

  const midiMixerNode = (
    <MidiChannelMixer
      onToggleMuteChannel={toggleMidiChannelMute}
      studioColumn={isStudioDesk}
    />
  );

  const scrubPercent =
    playback.duration > 0
      ? (
          ((isScrubbing && scrubTime !== null ? scrubTime : playback.currentTime) /
            playback.duration) *
          100
        ).toFixed(2)
      : '0';
  const scrubAccent = isStudioDesk ? '#00D4F0' : '#6366f1';
  const scrubAccentSoft = isStudioDesk ? '#67e8f9' : '#818cf8';
  const scrubTrack = isStudioDesk ? '#1E2229' : '#1e293b';

  const nowPlayingInner = (
    <>
      <div className="flex items-center justify-between mb-2.5">
        <span
          className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${
            isStudioDesk ? 'text-[color:var(--accent)]' : 'text-indigo-400'
          }`}
        >
          <Sparkles className="w-4 h-4" /> {t('player.nowPlaying')}
        </span>
        <div className="flex items-center gap-2 overflow-hidden">
          <span className="text-xs text-slate-400 font-mono truncate max-w-xs">
            {currentTrack
              ? `${currentTrack.artist} - ${currentTrack.title}`
              : t('player.noTrackLoaded')}
          </span>
          {currentTrack &&
            (currentTrack.source !== 'local_library' ||
              currentTrack.localFilePath?.includes('queue_cache')) &&
            currentTrack.localFilePath && (
              <button
                type="button"
                onClick={() => handleSaveToPermanentLibrary(currentTrack)}
                disabled={savingTrackIds.has(currentTrack.id)}
                className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-950/80 hover:bg-emerald-900/90 text-emerald-300 border border-emerald-700/60 text-[10px] font-semibold transition-all shrink-0 active:scale-95 shadow-sm"
                title={t('library.saveToLibrary', 'Salva in Libreria')}
              >
                <Download
                  className={`w-3 h-3 ${savingTrackIds.has(currentTrack.id) ? 'animate-spin' : ''}`}
                />
                <span>{t('library.saveToLibrary', 'Salva')}</span>
              </button>
            )}
        </div>
      </div>

      <div
        className={`w-full aspect-video bg-black rounded-xl overflow-hidden relative flex items-center justify-center border border-slate-800 mx-auto ${
          isStudioDesk ? 'max-h-[28vh]' : 'max-h-[32vh]'
        }`}
      >
        <video
          ref={videoRef}
          className="w-full h-full object-contain"
          onError={(e) => {
            const mediaErr = e.currentTarget.error;
            window.karaokeApi?.logger?.log('error', 'ControlWindow:Video', 'Media playback error', {
              code: mediaErr?.code,
              message: mediaErr?.message,
              src: e.currentTarget.currentSrc
            });
            const track = useKaraokeStore.getState().queue[0]?.track;
            const queueId = useKaraokeStore.getState().queue[0]?.queueId;
            if (track && trackNeedsLocalFileCheck(track)) {
              pauseResetForMissingFile();
              openMissingForQueueItem(
                track,
                track.localFilePath || e.currentTarget.currentSrc || '',
                queueId
              );
            }
          }}
          onLoadedMetadata={(e) => {
            const video = e.currentTarget;
            video.preservesPitch = true;
            (video as any).mozPreservesPitch = true;
            (video as any).webkitPreservesPitch = true;
            video.playbackRate = playback.playbackSpeed;
            audioGraphRef.current?.bindMediaElement(video);
            audioGraphRef.current?.setPitchOffset(playback.livePitchOffset);
            audioGraphRef.current?.setPlaybackSpeed(playback.playbackSpeed);
          }}
          onPlay={(e) => {
            const video = e.currentTarget;
            video.preservesPitch = true;
            (video as any).mozPreservesPitch = true;
            (video as any).webkitPreservesPitch = true;
            video.playbackRate = playback.playbackSpeed;
            audioGraphRef.current?.initContext();
          }}
          onTimeUpdate={() => {
            if (videoRef.current) {
              setPlaybackState({
                currentTime: videoRef.current.currentTime,
                duration: videoRef.current.duration || playback.duration || 0
              });
            }
          }}
          onEnded={() => {
            advanceToNextTrack({ naturalEnd: true });
          }}
        />
        {playback.activeLyricsText && (
          <div
            className={`absolute inset-0 flex items-center justify-center p-4 text-center pointer-events-none z-10 ${
              isStudioDesk ? 'bg-black/30' : 'bg-black/40 backdrop-blur-[1px]'
            }`}
          >
            <span
              className={
                isStudioDesk
                  ? 'text-base md:text-xl font-extrabold text-white tracking-wide'
                  : 'text-base md:text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-pink-400 to-indigo-300 drop-shadow-md'
              }
              style={
                isStudioDesk
                  ? {
                      textShadow: 'var(--neon-lyric-glow)',
                      WebkitTextStroke: '1px var(--neon-lyric-stroke)'
                    }
                  : undefined
              }
            >
              {playback.activeLyricsText}
            </span>
          </div>
        )}
        {!playback.isPlaying && currentTrack && !playback.activeLyricsText && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-slate-950/85 backdrop-blur-[2px] z-10 pointer-events-none select-none animate-fadeIn">
            <span
              className={`text-[10px] uppercase tracking-widest font-bold px-2.5 py-0.5 rounded-full mb-1.5 inline-flex items-center gap-1 ${
                isStudioDesk
                  ? 'text-[color:var(--accent)] bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)] border border-[color:var(--accent)]'
                  : 'text-indigo-400 bg-indigo-500/10 border border-indigo-500/30'
              }`}
            >
              <Mic className="w-3 h-3" /> {t('banner.upNextOnStage')}
            </span>
            <span className="text-base md:text-lg font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-pink-400 to-indigo-300 line-clamp-1">
              {currentQueueItem?.assignedSingerName || t('banner.nextSingerUnassigned')}
            </span>
            <span className="text-xs text-white font-semibold line-clamp-1 mt-0.5">
              {currentTrack.title}
            </span>
            {currentTrack.artist && (
              <span className="text-[11px] text-slate-400 font-medium line-clamp-1">
                {currentTrack.artist}
              </span>
            )}
            {currentQueueItem?.pitchOffset !== 0 && (
              <span className="text-[10px] font-mono text-amber-400 mt-1 font-semibold">
                {t('guestRequests.pitch')}:{' '}
                {currentQueueItem!.pitchOffset > 0
                  ? `+${currentQueueItem!.pitchOffset}`
                  : currentQueueItem!.pitchOffset}
              </span>
            )}
          </div>
        )}
        {!currentTrack && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-slate-500 text-xs gap-2.5 pointer-events-none">
            <Music className="w-10 h-10 opacity-30" />
            <span className="max-w-xs leading-relaxed">{t('queue.empty')}</span>
          </div>
        )}
      </div>

      <div className="mt-3">
        <div className="flex justify-between text-[10px] text-slate-400 font-mono mb-1">
          <span>
            {formatTime(isScrubbing && scrubTime !== null ? scrubTime : playback.currentTime)}
          </span>
          <span>{formatTime(playback.duration)}</span>
        </div>
        <div className="relative flex items-center py-1.5 cursor-pointer group">
          <input
            type="range"
            min="0"
            max={playback.duration || 100}
            step="0.25"
            value={isScrubbing && scrubTime !== null ? scrubTime : playback.currentTime}
            onPointerDown={(e) => {
              setIsScrubbing(true);
              setScrubTime(parseFloat(e.currentTarget.value));
            }}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setScrubTime(val);
              if (!isScrubbing) {
                handleSeek(val);
              }
            }}
            onPointerUp={(e) => {
              const val = parseFloat(e.currentTarget.value);
              handleSeek(val);
              setIsScrubbing(false);
              setScrubTime(null);
            }}
            className="w-full h-2 rounded-lg cursor-pointer transition-all appearance-none focus:outline-none"
            style={{
              background: `linear-gradient(to right, ${scrubAccent} 0%, ${scrubAccentSoft} ${scrubPercent}%, ${scrubTrack} ${scrubPercent}%, ${scrubTrack} 100%)`
            }}
          />
        </div>
      </div>
    </>
  );

  const downloadsMenuBody = (
    <>
      <div className="text-[11px] font-bold uppercase tracking-wider text-cyan-400 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <Download className="w-3.5 h-3.5" /> {t('library.downloadsMenu')}
        </span>
        {Object.keys(headerDownloads).length > 0 && (
          <button
            type="button"
            onClick={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              const activeStatuses = new Set([
                'queued',
                'downloading',
                'converting',
                'processing',
                'downloading_model',
                'removing_vocals',
                'remuxing'
              ]);
              const hasActive = Object.values(headerDownloads).some((d) =>
                activeStatuses.has(d.status)
              );
              if (
                hasActive &&
                !(await confirmAsync(
                  t(
                    'library.confirmClearDownloads',
                    'Annullare tutti i download in corso e svuotare l’elenco?'
                  )
                ))
              ) {
                return;
              }
              try {
                await window.karaokeApi?.downloads.cancelAll();
              } catch {
                /* still clear the menu list */
              }
              setHeaderDownloads({});
            }}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold normal-case tracking-normal text-slate-300 hover:text-rose-300 bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60"
            title={t('library.clearDownloads', 'Pulisci coda')}
            data-testid="downloads-clear-all"
          >
            <Trash2 className="w-3 h-3 text-rose-400" />
            {t('library.clearDownloads', 'Pulisci coda')}
          </button>
        )}
      </div>
      {Object.keys(headerDownloads).length === 0 ? (
        <p className="text-[11px] text-slate-500 py-2">{t('library.downloadsEmpty')}</p>
      ) : (
        Object.values(headerDownloads).map((dl) => {
          const isConversionPhase =
            dl.instrumental === true &&
            (dl.status === 'processing' ||
              dl.status === 'downloading_model' ||
              dl.status === 'removing_vocals' ||
              dl.status === 'remuxing' ||
              dl.status === 'converting');
          const showSpeed = dl.status === 'downloading' && Boolean(dl.speed);
          const showEta =
            (dl.status === 'downloading' || dl.status === 'removing_vocals') &&
            Boolean(dl.eta) &&
            dl.eta !== '--:--' &&
            !/^n\/?a$/i.test(dl.eta);
          const reuseNotice = dl.alreadyExists
            ? t('library.alreadyLocal', {
                path: dl.outputFilePath || '',
                defaultValue:
                  'Track already available locally. Linked existing file without re-downloading:\n{{path}}'
              }).replace(/\n+/g, ' ')
            : null;
          const statusLabel = reuseNotice
            ? reuseNotice
            : dl.status === 'downloading_model'
              ? t('library.downloadingModel')
              : dl.status === 'queued'
                ? t('library.queued')
                : dl.status === 'removing_vocals'
                  ? t('library.removingVocals')
                  : dl.status === 'remuxing'
                    ? t('library.remuxingInstrumental')
                    : dl.status === 'processing' ||
                        (dl.status === 'converting' && dl.instrumental)
                      ? t('library.convertingInstrumental')
                      : dl.status === 'converting'
                        ? t('library.converting')
                        : dl.status === 'downloading'
                          ? t('library.downloading')
                          : dl.status === 'completed'
                            ? t('library.downloadCompleted')
                            : dl.status === 'error'
                              ? dl.errorMessage
                                ? t('errors.downloadFailed', {
                                    error: dl.errorMessage
                                  })
                                : t('common.error', 'Error')
                              : dl.status === 'cancelled'
                                ? t('common.cancelled', 'Cancelled')
                                : String(dl.status);
          const statusTone =
            dl.alreadyExists || dl.status === 'error' ? 'text-amber-400' : 'text-slate-500';
          return (
            <div key={dl.downloadId} className="flex items-center gap-2 text-xs">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-slate-300 truncate mb-0.5">
                  {dl.titleHint || dl.downloadId}
                  {dl.instrumental ? ' · Inst.' : ''}
                </div>
                <div
                  className={`flex justify-between gap-2 text-[10px] mb-1 font-mono ${statusTone}`}
                >
                  <span className="min-w-0 break-words whitespace-normal">
                    {statusLabel}
                    {showSpeed ? ` · ${dl.speed}` : ''}
                    {showEta ? ` · ETA ${dl.eta}` : ''}
                  </span>
                  <span className="shrink-0">{dl.percent.toFixed(0)}%</span>
                </div>
                <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      dl.status === 'completed'
                        ? 'bg-emerald-500'
                        : dl.status === 'error'
                          ? 'bg-amber-500'
                          : isConversionPhase
                            ? 'bg-amber-500'
                            : 'bg-cyan-500'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, dl.percent))}%` }}
                  />
                </div>
              </div>
              {(dl.status === 'queued' ||
                dl.status === 'downloading' ||
                dl.status === 'converting' ||
                dl.status === 'processing' ||
                dl.status === 'downloading_model' ||
                dl.status === 'removing_vocals' ||
                dl.status === 'remuxing') && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void window.karaokeApi?.downloads.cancel(dl.downloadId);
                  }}
                  className="text-slate-500 hover:text-red-400 p-1 rounded-full hover:bg-slate-800"
                  title={t('common.cancel', 'Cancel')}
                >
                  <XCircle className="w-4 h-4" />
                </button>
              )}
            </div>
          );
        })
      )}
    </>
  );

  return (
    <div className="h-screen max-h-screen app-control-container flex flex-col font-sans select-none overflow-hidden">
      {isStudioDesk ? (
        <StudioDeskShell
          activeRightTab={activeRightTab}
          setActiveRightTab={setActiveRightTab}
          onOpenLocalLibrary={() => {
            setActiveRightTab('library');
            setStudioLocalSearchNonce((n) => n + 1);
          }}
          onOpenWebSearch={() => {
            setActiveRightTab('library');
            setStudioWebSearchNonce((n) => n + 1);
            window.setTimeout(() => searchInputRef.current?.focus(), 0);
          }}
          pendingGuestCount={pendingRequests.length}
          onOpenGuestRequests={() => setShowGuestModal(true)}
          onOpenPortalQr={() => setShowPortalQrModal(true)}
          onOpenSingers={() => setShowSingersModal(true)}
          onOpenShortcuts={() => setShowShortcutsModal(true)}
          onOpenSettings={() => setShowSettingsModal(true)}
          stageOpen={stageOpen}
          onReopenStage={() => window.karaokeApi?.reopenStageWindow()}
          downloadsSlot={downloadsMenuBody}
          showDownloadsMenu={showDownloadsMenu}
          setShowDownloadsMenu={setShowDownloadsMenu}
          downloadsMenuRef={downloadsMenuRef}
          downloadBadgeCount={Object.keys(headerDownloads).length}
          nowPlaying={nowPlayingInner}
          playerDeck={
            <StudioPlayerDeckControls
              pitchRange={pitchRange}
              speedRange={speedRange}
              dspEngine={coerceDspPitchEngine(settings.dspEngine)}
              onPlayPause={() => {
                void handlePlayPause();
              }}
              onStop={handleStop}
              onRestart={handleRestart}
              onNext={() => advanceToNextTrack()}
              isMidiTrack={isMidiTrack}
              showMidiMixer={showStudioMidiMixer}
              onToggleMidiMixer={() => setShowStudioMidiMixer((v) => !v)}
            />
          }
          libraryColumn={libraryPanelNode}
          queueColumn={queuePanelNode}
          historyColumn={historyPanelNode}
          showMidiColumn={isMidiTrack && showStudioMidiMixer}
          midiColumn={midiMixerNode}
        />
      ) : (
        <>
      {/* Top Navigation Bar - Material Design 3 Elevated Surface */}
      <header className="h-14 shrink-0 bg-slate-900/90 backdrop-blur-md border-b border-slate-800/80 px-6 flex items-center justify-between shadow-sm z-20">
        <div className="flex items-center gap-3">
          <img
            src={appLogo}
            alt="Karaoke Live Station"
            className="w-10 h-10 object-contain drop-shadow-[0_2px_8px_rgba(99,102,241,0.35)] shrink-0"
          />
          <div>
            <h1 className="font-extrabold text-sm tracking-wide text-white">{t('app.title')}</h1>
            <p className="text-[10px] text-slate-400 font-medium">{t('app.subtitle')}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Stage Window Status / Auto-Recovery pill */}
          <button
            type="button"
            onClick={() => window.karaokeApi?.reopenStageWindow()}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-2 border shadow-sm transition-all duration-200 active:scale-95 ${
              stageOpen
                ? 'bg-emerald-950/40 border-emerald-800/70 text-emerald-400 hover:bg-emerald-900/50'
                : 'bg-red-950/40 border-red-800/70 text-red-400 animate-pulse hover:bg-red-900/50'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${stageOpen ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50' : 'bg-red-400'}`} />
            {stageOpen ? t('app.stageWindow') : 'Riapri Palco'}
          </button>

          {/* Guest Requests Badge & Modal trigger */}
          <button
            type="button"
            onClick={() => setShowGuestModal(true)}
            className="relative px-3.5 py-1.5 rounded-full text-xs font-semibold bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border border-slate-700/60 shadow-sm flex items-center gap-1.5 transition-all duration-200 active:scale-95"
          >
            <Smartphone className="w-4 h-4 text-indigo-400" />
            Richieste Guest
            {pendingRequests.length > 0 && (
              <span className="bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full animate-bounce shadow-sm">
                {pendingRequests.length}
              </span>
            )}
          </button>

          {/* Guest Portal QR Code */}
          <button
            type="button"
            onClick={() => setShowPortalQrModal(true)}
            className="p-2 rounded-full text-xs font-semibold bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border border-slate-700/60 shadow-sm transition-all duration-200 active:scale-95"
            title="Mostra QR Code Guest Portal"
          >
            <QrCode className="w-4 h-4 text-indigo-400" />
          </button>

          {/* Gestione Cantanti */}
          <button
            type="button"
            onClick={() => setShowSingersModal(true)}
            className="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border border-slate-700/60 shadow-sm flex items-center gap-1.5 transition-all duration-200 active:scale-95"
          >
            <Users className="w-4 h-4 text-amber-400" />
            Cantanti
          </button>

          {/* Scorciatoie + DSP engine comparison (HelpCircle / Info) */}
          <div className="relative flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowShortcutsModal(true)}
              className="p-2 rounded-full text-xs font-semibold bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border border-slate-700/60 shadow-sm transition-all duration-200 active:scale-95"
              title={t('shortcuts.title', 'Scorciatoie da Tastiera') + ' (F1 / ?)'}
            >
              <HelpCircle className="w-4 h-4 text-indigo-400 hover:text-indigo-300" />
            </button>
            <button
              type="button"
              onClick={() => setShowDspCompare((v) => !v)}
              className="p-2 rounded-full text-xs font-semibold bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border border-slate-700/60 shadow-sm transition-all duration-200 active:scale-95"
              title={t('settings.dspEngineCompareTitle')}
              aria-expanded={showDspCompare}
            >
              <Info className="w-4 h-4 text-cyan-400 hover:text-cyan-300" />
            </button>
            {showDspCompare && (
              <div className="absolute right-0 top-full mt-2 w-80 z-50 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-3 space-y-2 text-[11px] text-slate-300">
                <div className="flex items-center gap-1.5 text-cyan-400 font-bold uppercase tracking-wider text-[10px]">
                  <AudioLines className="w-3.5 h-3.5" />
                  {t('settings.dspEngineCompareTitle')}
                </div>
                <p className="leading-relaxed">{t('settings.dspEngineCompareBody')}</p>
                <ul className="space-y-1.5 list-none pl-0">
                  <li>
                    <span className="text-indigo-300 font-semibold">Signalsmith</span>
                    {' — '}
                    {t('settings.dspEngineSignalsmithBlurb')}
                  </li>
                  <li>
                    <span className="text-amber-300 font-semibold">SoundTouch</span>
                    {' — '}
                    {t('settings.dspEngineSoundTouchBlurb')}
                  </li>
                </ul>
                <p className="text-slate-500 leading-relaxed">{t('settings.dspEngineMidiNote')}</p>
              </div>
            )}
          </div>

          {/* Downloads menu — active/queued progress (replaces alert list above library rows) */}
          <div className="relative" ref={downloadsMenuRef}>
            <button
              type="button"
              onClick={() => setShowDownloadsMenu((v) => !v)}
              className="p-2 rounded-full text-xs font-semibold bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border border-slate-700/60 shadow-sm transition-all duration-200 active:scale-95 relative"
              title={t('library.downloadsMenu')}
              aria-expanded={showDownloadsMenu}
            >
              <Download className="w-4 h-4 text-cyan-400 hover:text-cyan-300" />
              {Object.keys(headerDownloads).length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[1rem] h-4 px-1 rounded-full bg-amber-500 text-[9px] font-bold text-slate-950 flex items-center justify-center">
                  {Object.keys(headerDownloads).length}
                </span>
              )}
            </button>
            {showDownloadsMenu && (
              <div className="absolute right-0 mt-2 w-80 max-h-80 overflow-y-auto z-50 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-3 space-y-2.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-cyan-400 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <Download className="w-3.5 h-3.5" /> {t('library.downloadsMenu')}
                  </span>
                  {Object.keys(headerDownloads).length > 0 && (
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const activeStatuses = new Set([
                          'queued',
                          'downloading',
                          'converting',
                          'processing',
                          'downloading_model',
                          'removing_vocals',
                          'remuxing'
                        ]);
                        const hasActive = Object.values(headerDownloads).some((d) =>
                          activeStatuses.has(d.status)
                        );
                        if (
                          hasActive &&
                          !(await confirmAsync(
                            t(
                              'library.confirmClearDownloads',
                              'Annullare tutti i download in corso e svuotare l’elenco?'
                            )
                          ))
                        ) {
                          return;
                        }
                        try {
                          await window.karaokeApi?.downloads.cancelAll();
                        } catch {
                          /* still clear the menu list */
                        }
                        setHeaderDownloads({});
                      }}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold normal-case tracking-normal text-slate-300 hover:text-rose-300 bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60"
                      title={t('library.clearDownloads', 'Pulisci coda')}
                      data-testid="downloads-clear-all"
                    >
                      <Trash2 className="w-3 h-3 text-rose-400" />
                      {t('library.clearDownloads', 'Pulisci coda')}
                    </button>
                  )}
                </div>
                {Object.keys(headerDownloads).length === 0 ? (
                  <p className="text-[11px] text-slate-500 py-2">{t('library.downloadsEmpty')}</p>
                ) : (
                  Object.values(headerDownloads).map((dl) => {
                    const isConversionPhase =
                      dl.instrumental === true &&
                      (dl.status === 'processing' ||
                        dl.status === 'downloading_model' ||
                        dl.status === 'removing_vocals' ||
                        dl.status === 'remuxing' ||
                        dl.status === 'converting');
                    const showSpeed = dl.status === 'downloading' && Boolean(dl.speed);
                    const showEta =
                      (dl.status === 'downloading' || dl.status === 'removing_vocals') &&
                      Boolean(dl.eta) &&
                      dl.eta !== '--:--' &&
                      !/^n\/?a$/i.test(dl.eta);
                    const reuseNotice = dl.alreadyExists
                      ? t('library.alreadyLocal', {
                          path: dl.outputFilePath || '',
                          defaultValue:
                            'Track already available locally. Linked existing file without re-downloading:\n{{path}}'
                        }).replace(/\n+/g, ' ')
                      : null;
                    const statusLabel = reuseNotice
                      ? reuseNotice
                      : dl.status === 'downloading_model'
                        ? t('library.downloadingModel')
                        : dl.status === 'queued'
                          ? t('library.queued')
                          : dl.status === 'removing_vocals'
                            ? t('library.removingVocals')
                            : dl.status === 'remuxing'
                              ? t('library.remuxingInstrumental')
                              : dl.status === 'processing' ||
                                  (dl.status === 'converting' && dl.instrumental)
                                ? t('library.convertingInstrumental')
                                : dl.status === 'converting'
                                  ? t('library.converting')
                                  : dl.status === 'downloading'
                                    ? t('library.downloading')
                                    : dl.status === 'completed'
                                      ? t('library.downloadCompleted')
                                      : dl.status === 'error'
                                        ? dl.errorMessage
                                          ? t('errors.downloadFailed', {
                                              error: dl.errorMessage
                                            })
                                          : t('common.error', 'Error')
                                        : dl.status === 'cancelled'
                                          ? t('common.cancelled', 'Cancelled')
                                          : String(dl.status);
                    const statusTone =
                      dl.alreadyExists || dl.status === 'error'
                        ? 'text-amber-400'
                        : 'text-slate-500';
                    return (
                    <div key={dl.downloadId} className="flex items-center gap-2 text-xs">
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] text-slate-300 truncate mb-0.5">
                          {dl.titleHint || dl.downloadId}
                          {dl.instrumental ? ' · Inst.' : ''}
                        </div>
                        <div
                          className={`flex justify-between gap-2 text-[10px] mb-1 font-mono ${statusTone}`}
                        >
                          <span className="min-w-0 break-words whitespace-normal">
                            {statusLabel}
                            {showSpeed ? ` · ${dl.speed}` : ''}
                            {showEta ? ` · ETA ${dl.eta}` : ''}
                          </span>
                          <span className="shrink-0">{dl.percent.toFixed(0)}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              dl.status === 'completed'
                                ? 'bg-emerald-500'
                                : dl.status === 'error'
                                  ? 'bg-amber-500'
                                  : isConversionPhase
                                    ? 'bg-amber-500'
                                    : 'bg-cyan-500'
                            }`}
                            style={{ width: `${Math.min(100, Math.max(0, dl.percent))}%` }}
                          />
                        </div>
                      </div>
                      {(dl.status === 'queued' ||
                        dl.status === 'downloading' ||
                        dl.status === 'converting' ||
                        dl.status === 'processing' ||
                        dl.status === 'downloading_model' ||
                        dl.status === 'removing_vocals' ||
                        dl.status === 'remuxing') && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void window.karaokeApi?.downloads.cancel(dl.downloadId);
                          }}
                          className="text-slate-500 hover:text-red-400 p-1 rounded-full hover:bg-slate-800"
                          title={t('common.cancel', 'Cancel')}
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Impostazioni Sistema */}
          <button
            type="button"
            onClick={() => setShowSettingsModal(true)}
            className="p-2 rounded-full text-xs font-semibold bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border border-slate-700/60 shadow-sm transition-all duration-200 active:scale-95"
            title={t('settings.title')}
          >
            <Settings className="w-4 h-4 text-slate-400 hover:text-white" />
          </button>
        </div>
      </header>

      {/* Main Studio Grid */}
      <main className="flex-1 min-h-0 p-3.5 md:p-4 grid grid-cols-12 gap-3.5 md:gap-4 overflow-hidden">
        {/* Left Column: Player & DSP Controls (7 Cols) */}
        <section className="col-span-12 lg:col-span-7 flex flex-col h-full min-h-0 overflow-y-auto pr-1 gap-3">
          {/* Active Screen Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-2xl relative">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4" /> {t('player.nowPlaying')}
              </span>
              <div className="flex items-center gap-2 overflow-hidden">
                <span className="text-xs text-slate-400 font-mono truncate max-w-xs">
                  {currentTrack ? `${currentTrack.artist} - ${currentTrack.title}` : t('player.noTrackLoaded')}
                </span>
                {currentTrack && (currentTrack.source !== 'local_library' || currentTrack.localFilePath?.includes('queue_cache')) && currentTrack.localFilePath && (
                  <button
                    type="button"
                    onClick={() => handleSaveToPermanentLibrary(currentTrack)}
                    disabled={savingTrackIds.has(currentTrack.id)}
                    className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-950/80 hover:bg-emerald-900/90 text-emerald-300 border border-emerald-700/60 text-[10px] font-semibold transition-all shrink-0 active:scale-95 shadow-sm"
                    title={t('library.saveToLibrary', 'Salva in Libreria')}
                  >
                    <Download className={`w-3 h-3 ${savingTrackIds.has(currentTrack.id) ? 'animate-spin' : ''}`} />
                    <span>{t('library.saveToLibrary', 'Salva')}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Video preview element */}
            <div className="w-full aspect-video max-h-[32vh] bg-black rounded-xl overflow-hidden relative flex items-center justify-center border border-slate-800 mx-auto">
              <video
                ref={videoRef}
                className="w-full h-full object-contain"
                onError={(e) => {
                  const mediaErr = e.currentTarget.error;
                  window.karaokeApi?.logger?.log('error', 'ControlWindow:Video', 'Media playback error', {
                    code: mediaErr?.code,
                    message: mediaErr?.message,
                    src: e.currentTarget.currentSrc
                  });
                  // Mid-session USB unplug / deleted file — surface MissingFileModal (no uncaught rejection)
                  const track = useKaraokeStore.getState().queue[0]?.track;
                  const queueId = useKaraokeStore.getState().queue[0]?.queueId;
                  if (track && trackNeedsLocalFileCheck(track)) {
                    pauseResetForMissingFile();
                    openMissingForQueueItem(
                      track,
                      track.localFilePath || e.currentTarget.currentSrc || '',
                      queueId
                    );
                  }
                }}
                onLoadedMetadata={(e) => {
                  const video = e.currentTarget;
                  video.preservesPitch = true;
                  (video as any).mozPreservesPitch = true;
                  (video as any).webkitPreservesPitch = true;
                  // Hi-Fi (Signalsmith) + SoundTouch: media element drives tempo; Hi-Fi compensates pitch.
                  video.playbackRate = playback.playbackSpeed;
                  audioGraphRef.current?.bindMediaElement(video);
                  audioGraphRef.current?.setPitchOffset(playback.livePitchOffset);
                  audioGraphRef.current?.setPlaybackSpeed(playback.playbackSpeed);
                }}
                onPlay={(e) => {
                  const video = e.currentTarget;
                  video.preservesPitch = true;
                  (video as any).mozPreservesPitch = true;
                  (video as any).webkitPreservesPitch = true;
                  video.playbackRate = playback.playbackSpeed;
                  audioGraphRef.current?.initContext();
                }}
                onTimeUpdate={() => {
                  if (videoRef.current) {
                    setPlaybackState({
                      currentTime: videoRef.current.currentTime,
                      duration: videoRef.current.duration || playback.duration || 0
                    });
                  }
                }}
                onEnded={() => {
                  advanceToNextTrack({ naturalEnd: true });
                }}
              />
              {/* Centered lyrics in control preview */}
              {playback.activeLyricsText && (
                <div className="absolute inset-0 flex items-center justify-center p-4 text-center pointer-events-none bg-black/40 backdrop-blur-[1px] z-10">
                  <span className="text-base md:text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-pink-400 to-indigo-300 drop-shadow-md">
                    {playback.activeLyricsText}
                  </span>
                </div>
              )}
              {!playback.isPlaying && currentTrack && !playback.activeLyricsText && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-slate-950/85 backdrop-blur-[2px] z-10 pointer-events-none select-none animate-fadeIn">
                  <span className="text-[10px] uppercase tracking-widest text-indigo-400 font-bold px-2.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/30 mb-1.5 inline-flex items-center gap-1">
                    <Mic className="w-3 h-3" /> {t('banner.upNextOnStage')}
                  </span>
                  <span className="text-base md:text-lg font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-pink-400 to-indigo-300 line-clamp-1">
                    {currentQueueItem?.assignedSingerName || t('banner.nextSingerUnassigned')}
                  </span>
                  <span className="text-xs text-white font-semibold line-clamp-1 mt-0.5">
                    {currentTrack.title}
                  </span>
                  {currentTrack.artist && (
                    <span className="text-[11px] text-slate-400 font-medium line-clamp-1">
                      {currentTrack.artist}
                    </span>
                  )}
                  {currentQueueItem?.pitchOffset !== 0 && (
                    <span className="text-[10px] font-mono text-amber-400 mt-1 font-semibold">
                      {t('guestRequests.pitch')}: {currentQueueItem.pitchOffset > 0 ? `+${currentQueueItem.pitchOffset}` : currentQueueItem.pitchOffset}
                    </span>
                  )}
                </div>
              )}
              {!currentTrack && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-slate-500 text-xs gap-2.5 pointer-events-none">
                  <Music className="w-10 h-10 opacity-30" />
                  <span className="max-w-xs leading-relaxed">{t('queue.empty')}</span>
                </div>
              )}
            </div>

            {/* Scrubbing Bar */}
            <div className="mt-3">
              <div className="flex justify-between text-[10px] text-slate-400 font-mono mb-1">
                <span>{formatTime(isScrubbing && scrubTime !== null ? scrubTime : playback.currentTime)}</span>
                <span>{formatTime(playback.duration)}</span>
              </div>
              <div className="relative flex items-center py-1.5 cursor-pointer group">
                <input
                  type="range"
                  min="0"
                  max={playback.duration || 100}
                  step="0.25"
                  value={isScrubbing && scrubTime !== null ? scrubTime : playback.currentTime}
                  onPointerDown={(e) => {
                    setIsScrubbing(true);
                    setScrubTime(parseFloat(e.currentTarget.value));
                  }}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setScrubTime(val);
                    if (!isScrubbing) {
                      handleSeek(val);
                    }
                  }}
                  onPointerUp={(e) => {
                    const val = parseFloat(e.currentTarget.value);
                    handleSeek(val);
                    setIsScrubbing(false);
                    setScrubTime(null);
                  }}
                  className="w-full h-2 rounded-lg cursor-pointer transition-all appearance-none focus:outline-none"
                  style={{
                    background: `linear-gradient(to right, #6366f1 0%, #818cf8 ${
                      playback.duration > 0
                        ? (((isScrubbing && scrubTime !== null ? scrubTime : playback.currentTime) / playback.duration) * 100).toFixed(2)
                        : 0
                    }%, #1e293b ${
                      playback.duration > 0
                        ? (((isScrubbing && scrubTime !== null ? scrubTime : playback.currentTime) / playback.duration) * 100).toFixed(2)
                        : 0
                    }%, #1e293b 100%)`
                  }}
                />
              </div>
            </div>

            <PlayerDeckControls
              pitchRange={pitchRange}
              speedRange={speedRange}
              dspEngine={coerceDspPitchEngine(settings.dspEngine)}
              onPlayPause={() => { void handlePlayPause(); }}
              onStop={handleStop}
              onRestart={handleRestart}
              onNext={() => advanceToNextTrack()}
            />
          </div>

          {/* MIDI 16-Channel Mixer - Rendered ONLY if file is MIDI/KAR compatible */}
          {isMidiTrack && (
            <MidiChannelMixer onToggleMuteChannel={toggleMidiChannelMute} />
          )}
        </section>

        {/* Right Column: Tab Switcher (Queue, Library, History) (5 Cols) */}
        <section className="col-span-12 lg:col-span-5 flex flex-col h-full min-h-0 overflow-hidden">
          {/* Tab Navigation - M3 Pill Segmented Switcher */}
          <div className="flex items-center gap-1.5 mb-3 bg-slate-900/90 p-1.5 rounded-full border border-slate-800/80 text-xs font-semibold shrink-0 shadow-sm">
            <button
              type="button"
              onClick={() => setActiveRightTab('queue')}
              className={`flex-1 py-1.5 rounded-full flex items-center justify-center gap-1.5 transition-all duration-200 active:scale-95 ${
                activeRightTab === 'queue'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 font-bold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              {t('queue.title')} ({queue.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveRightTab('library')}
              className={`flex-1 py-1.5 rounded-full flex items-center justify-center gap-1.5 transition-all duration-200 active:scale-95 ${
                activeRightTab === 'library'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 font-bold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              {t('library.title')}
            </button>
            <button
              type="button"
              onClick={() => setActiveRightTab('history')}
              className={`flex-1 py-1.5 rounded-full flex items-center justify-center gap-1.5 transition-all duration-200 active:scale-95 ${
                activeRightTab === 'history'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 font-bold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              {t('history.tabTitle')}
            </button>
          </div>

          {/* Tab 1: Queue (Fair Queue) */}
          {/* Tabs stay mounted so search/scroll/downloads persist across navigation */}
          <div className={activeRightTab === 'queue' ? 'flex flex-col flex-1 min-h-0' : 'hidden'}>
            <QueueList
              isPlaying={playback.isPlaying}
              enableFairQueue={Boolean(settings.enableFairQueue)}
              queueFileDropActive={queueFileDropActive}
              setQueueFileDropActive={setQueueFileDropActive}
              onOsFileDrop={(files) => { void handleOsQueueFileDrop(files); }}
              onPlayPause={() => { void handlePlayPause(); }}
              onStop={handleStop}
              onJumpToTrack={(index) => { void handleJumpToTrack(index); }}
              onSaveToPermanentLibrary={handleSaveToPermanentLibrary}
              savingTrackIds={savingTrackIds}
              onEditSinger={(item) => {
                setEditingSingerItem(item);
                setEditingSingerText(item.assignedSingerName || '');
              }}
            />
          </div>

          {/* Tab 2: Library Panel — kept mounted so downloads/search persist */}
          <div className={activeRightTab === 'library' ? 'flex flex-col flex-1 min-h-0' : 'hidden'}>
            <LibraryPanel
              onPlayCue={handlePlayCue}
              onStopCue={handleStopCue}
              activeCueUri={activeCueUri}
              searchInputRef={searchInputRef}
            />
          </div>

          {/* Tab 3: Execution History & Royalty/SIAE Logging */}
          <div className={activeRightTab === 'history' ? 'flex flex-col flex-1 min-h-0' : 'hidden'}>
            <HistoryPanel />
          </div>
        </section>
      </main>
        </>
      )}

      {/* Modals */}
      <SettingsModal isOpen={showSettingsModal} onClose={() => setShowSettingsModal(false)} />
      <ToastHost />
      <SingersModal
        isOpen={showSingersModal}
        onClose={() => {
          setShowSingersModal(false);
          useKaraokeStore.getState().loadSingersFromDb();
        }}
      />
      <GuestRequestsModal isOpen={showGuestModal} onClose={() => setShowGuestModal(false)} />

      {/* Modal: Assegna / Modifica Cantante della canzone in coda con Menu a Tendina e Ricerca Rapida */}
      {editingSingerItem && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-md shadow-2xl p-6 text-white animate-in fade-in zoom-in duration-150 relative">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <Mic className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-100">
                    {editingSingerItem.assignedSingerName ? 'Modifica Cantante' : 'Assegna Cantante'}
                  </h3>
                  <p className="text-xs text-slate-400 truncate max-w-[280px]">
                    {editingSingerItem.track.artist} - {editingSingerItem.track.title}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingSingerItem(null);
                  setIsSingerDropdownOpen(false);
                }}
                className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                updateQueueItemSinger(editingSingerItem.queueId, editingSingerText.trim());
                setEditingSingerItem(null);
                setIsSingerDropdownOpen(false);
              }}
            >
              <div className="space-y-4">
                <div className="relative">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5 flex items-center justify-between">
                    <span>Cantante</span>
                    <span className="text-[10px] text-indigo-400 font-normal">Menu con ricerca rapida</span>
                  </label>

                  {/* Searchable Input Combobox */}
                  <div className="relative flex items-center">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
                    <input
                      type="text"
                      autoFocus
                      value={editingSingerText}
                      onFocus={() => setIsSingerDropdownOpen(true)}
                      onChange={(e) => {
                        setEditingSingerText(e.target.value);
                        setIsSingerDropdownOpen(true);
                        setSingerHighlightIndex(-1);
                      }}
                      onKeyDown={(e) => {
                        const hasCustomAdd =
                          editingSingerText.trim().length > 0 &&
                          !knownSingersList.some((s) => s.name.toLowerCase() === editingSingerText.trim().toLowerCase());
                        const totalOptions = filteredSingers.length + (hasCustomAdd ? 1 : 0);

                        if (!isSingerDropdownOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                          setIsSingerDropdownOpen(true);
                          return;
                        }

                        if (isSingerDropdownOpen) {
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setSingerHighlightIndex((prev) => (prev + 1 < totalOptions ? prev + 1 : 0));
                          } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setSingerHighlightIndex((prev) => (prev - 1 >= 0 ? prev - 1 : totalOptions - 1));
                          } else if (e.key === 'Enter' && singerHighlightIndex >= 0) {
                            e.preventDefault();
                            if (hasCustomAdd && singerHighlightIndex === 0) {
                              setIsSingerDropdownOpen(false);
                            } else {
                              const targetIdx = hasCustomAdd ? singerHighlightIndex - 1 : singerHighlightIndex;
                              if (filteredSingers[targetIdx]) {
                                setEditingSingerText(filteredSingers[targetIdx].name);
                                setIsSingerDropdownOpen(false);
                              }
                            }
                          } else if (e.key === 'Escape') {
                            setIsSingerDropdownOpen(false);
                          }
                        }
                      }}
                      placeholder="Cerca o inserisci cantante..."
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-16 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent select-text"
                    />
                    <div className="absolute right-2 flex items-center gap-1">
                      {editingSingerText && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSingerText('');
                            setIsSingerDropdownOpen(true);
                          }}
                          className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                          title="Cancella testo"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setIsSingerDropdownOpen((prev) => !prev)}
                        className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                        title="Mostra menu a tendina cantanti"
                      >
                        <ChevronDown
                          className={`w-4 h-4 transition-transform duration-200 ${
                            isSingerDropdownOpen ? 'rotate-180 text-indigo-400' : ''
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Dropdown Menu with Quick Search */}
                  {isSingerDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 mt-1.5 bg-slate-950 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden max-h-56 flex flex-col animate-in fade-in slide-in-from-top-1 duration-100">
                      <div className="p-1.5 overflow-y-auto flex-1 divide-y divide-slate-800/60">
                        {/* Option: Add new name if typed name is not exact match */}
                        {editingSingerText.trim().length > 0 &&
                          !knownSingersList.some((s) => s.name.toLowerCase() === editingSingerText.trim().toLowerCase()) && (
                            <button
                              type="button"
                              onClick={() => {
                                setIsSingerDropdownOpen(false);
                              }}
                              className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center gap-2 transition-colors ${
                                singerHighlightIndex === 0
                                  ? 'bg-indigo-600 text-white font-semibold'
                                  : 'text-indigo-300 hover:bg-indigo-950/60 hover:text-indigo-100'
                              }`}
                            >
                              <User className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                              <span className="truncate">
                                Usa <strong className="text-white">"{editingSingerText.trim()}"</strong> come nuovo cantante
                              </span>
                            </button>
                          )}

                        {filteredSingers.length > 0 ? (
                          filteredSingers.map((singer, idx) => {
                            const hasCustomAdd =
                              editingSingerText.trim().length > 0 &&
                              !knownSingersList.some((s) => s.name.toLowerCase() === editingSingerText.trim().toLowerCase());
                            const adjustedHighlightIdx = hasCustomAdd ? idx + 1 : idx;
                            const isSelected = editingSingerText.trim().toLowerCase() === singer.name.toLowerCase();
                            const isHighlighted = singerHighlightIndex === adjustedHighlightIdx;

                            return (
                              <button
                                key={singer.name}
                                type="button"
                                onClick={() => {
                                  setEditingSingerText(singer.name);
                                  setIsSingerDropdownOpen(false);
                                }}
                                className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between gap-2 transition-colors ${
                                  isSelected
                                    ? 'bg-indigo-600 text-white font-bold'
                                    : isHighlighted
                                    ? 'bg-slate-800 text-slate-100'
                                    : 'text-slate-200 hover:bg-slate-850 hover:bg-slate-800/70'
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0 truncate">
                                  {singer.isFavorite ? (
                                    <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />
                                  ) : (
                                    <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  )}
                                  <span className="truncate font-medium">{singer.name}</span>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0 text-[10px] text-slate-400">
                                  {singer.songCount > 0 && (
                                    <span className="opacity-75">
                                      {singer.songCount} {singer.songCount === 1 ? 'brano' : 'brani'}
                                    </span>
                                  )}
                                  {isSelected && <Check className="w-3.5 h-3.5 text-white ml-1 shrink-0" />}
                                </div>
                              </button>
                            );
                          })
                        ) : (
                          <div className="px-3 py-3 text-center text-xs text-slate-500">
                            Nessun cantante trovato per "{editingSingerText}"
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Quick select chips for frequent singers */}
                {knownSingersList.length > 0 && (
                  <div>
                    <span className="text-[11px] font-medium text-slate-400 block mb-1.5">
                      Cantanti frequenti:
                    </span>
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                      {knownSingersList.slice(0, 10).map((singer) => (
                        <button
                          key={singer.name}
                          type="button"
                          onClick={() => {
                            setEditingSingerText(singer.name);
                            setIsSingerDropdownOpen(false);
                          }}
                          className={`text-xs px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1 ${
                            editingSingerText === singer.name
                              ? 'bg-indigo-600 border-indigo-400 text-white font-semibold shadow-sm shadow-indigo-600/50'
                              : 'bg-slate-800/80 border-slate-700/80 text-slate-300 hover:bg-slate-700 hover:text-white'
                          }`}
                        >
                          {singer.isFavorite && <Star className="w-2.5 h-2.5 text-amber-400 fill-amber-400 shrink-0" />}
                          <span>{singer.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                  {editingSingerItem.assignedSingerName ? (
                    <button
                      type="button"
                      onClick={() => {
                        updateQueueItemSinger(editingSingerItem.queueId, '');
                        setEditingSingerItem(null);
                        setIsSingerDropdownOpen(false);
                      }}
                      className="text-xs text-rose-400 hover:text-rose-300 hover:underline flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Rimuovi cantante
                    </button>
                  ) : <div />}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingSingerItem(null);
                        setIsSingerDropdownOpen(false);
                      }}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
                    >
                      Annulla
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 flex items-center gap-1.5 transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Salva Cantante
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Missing File Modal — USB unplug / moved path (Elimina vs Lascia; never auto-delete) */}
      <MissingFileModal />

      {/* Guest Portal QR Modal */}
      {showPortalQrModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl flex flex-col max-h-[92vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4 shrink-0">
              <div className="flex items-center gap-2.5">
                <img src={appLogo} alt="Logo" className="w-7 h-7 object-contain drop-shadow" />
                <div>
                  <h3 className="font-bold text-sm text-white">Guest Portal LAN</h3>
                  <p className="text-[11px] text-slate-400">Richieste canzoni dal pubblico con smartphone</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPortalQrModal(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body: Responsive 2-column or stack */}
            <div className="overflow-y-auto pr-1 flex-1 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                {/* Left: QR Code & Direct Link */}
                <div className="flex flex-col items-center text-center p-4 bg-slate-950/70 rounded-2xl border border-slate-800 space-y-3">
                  <p className="text-xs text-slate-300 font-medium">
                    Gli ospiti possono inquadrare il codice per richiedere canzoni:
                  </p>
                  {portalInfo.qrCode ? (
                    <div className="bg-white p-3 rounded-2xl shadow-xl border border-white/20">
                      <img
                        src={portalInfo.qrCode}
                        alt="QR Code Guest Portal"
                        className="w-44 h-44 object-contain"
                      />
                    </div>
                  ) : (
                    <div className="w-48 h-48 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-xs text-slate-500">
                      Generazione QR Code...
                    </div>
                  )}
                  <div className="w-full space-y-1">
                    <span className="text-[10px] text-slate-400 block uppercase font-semibold">Oppure apri l'indirizzo:</span>
                    <code className="block font-mono text-xs text-indigo-400 bg-black/60 px-2.5 py-1.5 rounded-lg border border-slate-800 select-all font-bold truncate">
                      {portalInfo.url || `http://${portalInfo.ip || '127.0.0.1'}:${portalInfo.port || 3000}`}
                    </code>
                  </div>
                  <p className="text-[10.5px] text-slate-500 leading-tight">
                    Lo smartphone deve essere collegato alla stessa rete Wi-Fi di questo computer.
                  </p>
                </div>

                {/* Right: Multiplatform Firewall & LAN Access Guide */}
                <div>
                  <FirewallGuideCard compact={true} />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="pt-3 border-t border-slate-800 mt-4 shrink-0">
              <button
                type="button"
                onClick={() => setShowPortalQrModal(false)}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs shadow-md transition-colors cursor-pointer"
              >
                Chiudi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shortcuts Help Modal */}
      <ShortcutsHelpModal
        isOpen={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
      />
    </div>
  );
};
