import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, Music } from 'lucide-react';
import { ActivePlaybackState, AppSettings, QueueItem } from '../../shared/types';
import {
  mergeStageMessages,
  resolveStageMessage,
  stageMessageCss,
  pickActiveStageMessageBackground,
  stageMessageBackgroundCss,
  type StageMessageKey
} from '../../shared/stageMessages';
import { CdgParser } from '../core/CdgParser';
import { useKaraokeStore } from '../store/karaokeStore';
import appLogo from '../assets/logo.png';

/**
 * StageWindow (Palco / Singer Display)
 *
 * This window is displayed on the external TV/Projector facing the singer and audience.
 * Key responsibilities:
 * 1. Edge-to-Edge Visual Rendering:
 *    - Dual-engine display: Renders MP4/WEBM video tracks via `<video>` or MP3+G CD+G subcode graphics
 *      via HTML5 2D Canvas using `CdgParser`.
 *    - Maximized edge-to-edge screen space utilization with zero borders or wasted padding.
 * 2. Temporary Bottom-Center Song Title & Singer Overlays:
 *    - Displays floating song title & artist banner at bottom center for a configurable duration
 *      (`settings.titleOverlayDurationSec`, e.g. 8s default) before smoothly disappearing.
 *    - Displays upcoming singer announcements and countdown intro/outro banners ("Now Singing" / "Get Ready").
 *    - Optional per-message Stage backdrop (solid color or image) while those overlays are visible;
 *      when no message with a backdrop is on screen, the normal theme/video Stage look is restored
 *      without restarting (settings sync live over IPC).
 * 3. Muted Secondary Video:
 *    - Audio is completely muted and zeroed out on this display to prevent audio doubling/echoes
 *      with the main operator audio graph.
 * 4. Adaptive Frame-Accurate Synchronization:
 *    - Receives continuous high-frequency IPC sync broadcasts (`onStateSync`) from the Control window.
 *    - Employs a dual-mode drift compensation algorithm:
 *      * Micro-drift (0.15s - 0.75s): Dynamically micro-adjusts playback rate (±12%) to seamlessly catch up
 *        or slow down without visual stutter.
 *      * Macro-drift (> 0.75s): Executes a throttled hard-seek to align immediately (e.g. after scrubbing
 *        or opening the stage window midway through a song).
 * 5. Fullscreen Management & Low-Profile Progress Bar:
 *    - Responds to F11 / Escape hotkeys and double-click to switch seamlessly into borderless fullscreen.
 *    - Sleek, flush progress bar positioned on the very bottom edge.
 */
export const StageWindow: React.FC = () => {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageVideoRef = useRef<HTMLVideoElement>(null);
  const cdgParserRef = useRef<CdgParser | null>(null);
  const playbackRef = useRef<ActivePlaybackState>({
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
  });

  const [playback, setPlayback] = useState<ActivePlaybackState>({
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
  });

  const [currentQueue, setCurrentQueue] = useState<QueueItem[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [hasCdgLoaded, setHasCdgLoaded] = useState(false);
  const [isStageReady, setIsStageReady] = useState(false);

  const lastToggleTimeRef = useRef(0);
  const clickCountRef = useRef(0);
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleFullscreen = useCallback(() => {
    const now = Date.now();
    if (now - lastToggleTimeRef.current < 400) return;
    lastToggleTimeRef.current = now;
    window.karaokeApi?.toggleStageFullscreen();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.karaokeApi) return;

    const checkReadyAndSignal = async () => {
      try {
        if ('fonts' in document) {
          await document.fonts.ready;
        }
      } catch (err) {
        console.warn('Font loading check error:', err);
      }
      // Wait until stylesheets have applied and layout has painted before revealing video.
      try {
        const sheets = Array.from(document.styleSheets);
        await Promise.all(
          sheets.map(async (sheet) => {
            try {
              void sheet.cssRules;
            } catch {
              // Cross-origin stylesheets may throw; ignore.
            }
          })
        );
      } catch {
        // ignore stylesheet probe failures
      }
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      setIsStageReady(true);
      // Defer IPC show handshake one more frame so React commits the stage DOM/CSS.
      requestAnimationFrame(() => {
        window.karaokeApi?.signalStageReady();
      });
    };

    // Immediately fetch initial state from main process
    window.karaokeApi.getStageInitialState().then((initial) => {
      if (initial?.playback) {
        playbackRef.current = initial.playback;
        setPlayback(initial.playback);
      }
      if (initial?.queue && initial.queue.length > 0) setCurrentQueue(initial.queue);
      if (initial?.settings) {
        setSettings(initial.settings);
        useKaraokeStore.getState().updateSettings(initial.settings);
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
          'light'
        );
        root.classList.add(initial.settings.themeStage || 'dark-stage');
      }
      checkReadyAndSignal();
    }).catch((err) => {
      console.warn('Could not fetch stage initial state:', err);
      checkReadyAndSignal();
    });

    const unsubscribeState = window.karaokeApi.onStateSync((newState) => {
      playbackRef.current = newState;
      setPlayback(newState);
    });

    const unsubscribeCommand = window.karaokeApi.onCommand((cmd) => {
      if (cmd.action === 'sync:settings' && cmd.payload) {
        const newSettings = cmd.payload as AppSettings;
        setSettings(newSettings);
        useKaraokeStore.getState().updateSettings(newSettings);
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
          'light'
        );
        root.classList.add(newSettings.themeStage || 'dark-stage');
      } else if (cmd.action === 'sync:queue') {
        setCurrentQueue(cmd.payload as QueueItem[]);
      }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'F11') {
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // Global native double click listener on the stage window to toggle fullscreen
    const handleWindowDblClick = (e: MouseEvent) => {
      e.preventDefault();
      toggleFullscreen();
    };
    window.addEventListener('dblclick', handleWindowDblClick);

    // Also support two clicks in rapid succession (< 450ms) to ensure clicking twice always toggles fullscreen
    const handleWindowClick = () => {
      clickCountRef.current += 1;
      if (clickCountRef.current >= 2) {
        if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
        clickCountRef.current = 0;
        toggleFullscreen();
      } else {
        if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
        clickTimeoutRef.current = setTimeout(() => {
          clickCountRef.current = 0;
        }, 450);
      }
    };
    window.addEventListener('click', handleWindowClick);

    return () => {
      unsubscribeState();
      unsubscribeCommand();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('dblclick', handleWindowDblClick);
      window.removeEventListener('click', handleWindowClick);
      if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
    };
  }, [toggleFullscreen]);

  // Handle active track resolution
  const activeTrack = (playback.currentTrackId
    ? currentQueue.find((i) => i.track.id === playback.currentTrackId)?.track
    : undefined) || currentQueue[0]?.track;

  const isVideoTrack = Boolean(
    activeTrack?.uri &&
      activeTrack.source !== 'midi' &&
      !activeTrack.uri.endsWith('.mid') &&
      !activeTrack.uri.endsWith('.kar') &&
      !activeTrack.localFilePath?.endsWith('.mid') &&
      !activeTrack.localFilePath?.endsWith('.kar') &&
      !hasCdgLoaded &&
      (activeTrack.source === 'youtube' ||
        /\.(mp4|webm|mkv|avi|mov)$/i.test(activeTrack.uri) ||
        (activeTrack.localFilePath && /\.(mp4|webm|mkv|avi|mov)$/i.test(activeTrack.localFilePath)))
  );

  const lastHardSeekTimeRef = useRef<number>(0);
  const loadedTrackIdRef = useRef<string | null>(null);
  const isAligningRef = useRef<boolean>(false);

  useEffect(() => {
    if (activeTrack?.id && activeTrack.id !== loadedTrackIdRef.current) {
      loadedTrackIdRef.current = activeTrack.id;
      lastHardSeekTimeRef.current = 0;
      isAligningRef.current = false;
    }

    // Wipe previous canvas buffer on track change
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }

    // If new track is not video, pause and unload previous video
    if (!isVideoTrack && stageVideoRef.current) {
      stageVideoRef.current.pause();
      stageVideoRef.current.removeAttribute('src');
      stageVideoRef.current.load();
    }
  }, [activeTrack?.id, isVideoTrack]);

  useEffect(() => {
    if (!activeTrack || !canvasRef.current) {
      cdgParserRef.current = null;
      setHasCdgLoaded(false);
      return;
    }

    // Resolve CD+G path: runtime extract (zip), explicit cdgFilePath, or sibling of .mp3/.wav
    let cdgPath: string | null = null;
    if (activeTrack.cdgFilePath) {
      cdgPath = activeTrack.cdgFilePath;
    } else if (activeTrack.localFilePath) {
      const lp = activeTrack.localFilePath;
      if (/\.mp3$/i.test(lp)) {
        cdgPath = lp.replace(/\.mp3$/i, '.cdg');
      } else if (/\.wav$/i.test(lp)) {
        cdgPath = lp.replace(/\.wav$/i, '.cdg');
      }
    }

    if (cdgPath) {
      fetch(`karaoke://local/${encodeURIComponent(cdgPath)}`)
        .then((res) => {
          if (!res.ok) throw new Error('No CDG file');
          return res.arrayBuffer();
        })
        .then((buffer) => {
          if (canvasRef.current) {
            cdgParserRef.current = new CdgParser(buffer, canvasRef.current);
            setHasCdgLoaded(true);
          }
        })
        .catch(() => {
          cdgParserRef.current = null;
          setHasCdgLoaded(false);
        });
    } else {
      cdgParserRef.current = null;
      setHasCdgLoaded(false);
    }
  }, [activeTrack?.id, activeTrack?.cdgFilePath, activeTrack?.localFilePath]);

  // Render CDG frame at current playback time
  useEffect(() => {
    if (cdgParserRef.current && hasCdgLoaded) {
      cdgParserRef.current.renderAtTime(playback.currentTime);
    }
  }, [playback.currentTime, hasCdgLoaded]);

  // Keep playbackRef continuously updated to avoid stale closures
  playbackRef.current = playback;

  // Unified Stage Video Sync Controller
  const syncVideoWithPlayback = useCallback(() => {
    const video = stageVideoRef.current;
    if (!video) return;
    if (!isVideoTrack) {
      if (!video.paused) {
        video.pause();
      }
      return;
    }

    const currentPlayback = playbackRef.current;

    // 1. Guarantee audio silence on stage screen
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;

    // 2. Base rate matching playback speed
    const baseRate = currentPlayback.playbackSpeed || 1;

    // 3. Resilient drift synchronization without looping seeks
    if (video.readyState >= 2 && !video.seeking && !isAligningRef.current && currentPlayback.isPlaying) {
      const drift = currentPlayback.currentTime - video.currentTime; // > 0 means video behind
      const absDrift = Math.abs(drift);
      const now = Date.now();

      if (absDrift > 0.75) {
        // Significant drift (manual timeline scrub in control, stage reopened, or lag)
        if (now - lastHardSeekTimeRef.current > 600) {
          lastHardSeekTimeRef.current = now;
          isAligningRef.current = true;
          try {
            video.currentTime = currentPlayback.currentTime;
          } catch (err) {
            console.warn('Stage video hard seek error:', err);
            isAligningRef.current = false;
          }
        }
      } else if (absDrift > 0.15) {
        // Dynamic speed catch-up (micro-adjust playback rate ±12%)
        // Because stage video is 100% muted, adjusting rate has ZERO audio impact and fixes small drift within 1-2s
        const adjustedRate = drift > 0 ? baseRate * 1.12 : baseRate * 0.88;
        if (Math.abs(video.playbackRate - adjustedRate) > 0.01) {
          video.playbackRate = adjustedRate;
        }
      } else {
        // In tight lockstep (<0.15s drift), maintain exact base rate
        if (Math.abs(video.playbackRate - baseRate) > 0.01) {
          video.playbackRate = baseRate;
        }
      }
    } else if (!currentPlayback.isPlaying) {
      if (Math.abs(video.playbackRate - baseRate) > 0.01) {
        video.playbackRate = baseRate;
      }
      // If paused, keep frame aligned when scrubbing in control
      if (video.readyState >= 2 && !video.seeking && !isAligningRef.current) {
        const drift = Math.abs(currentPlayback.currentTime - video.currentTime);
        if (drift > 0.4 && Date.now() - lastHardSeekTimeRef.current > 300) {
          lastHardSeekTimeRef.current = Date.now();
          try {
            video.currentTime = currentPlayback.currentTime;
          } catch {
            // ignore
          }
        }
      }
    }

    // 4. Synchronize play/pause state safely
    if (currentPlayback.isPlaying) {
      if (video.paused && video.readyState >= 2 && !video.seeking && !isAligningRef.current) {
        video.play().catch((err) => {
          console.warn('Stage video play catch:', err);
        });
      }
    } else {
      if (!video.paused) {
        video.pause();
      }
    }
  }, [isVideoTrack]);

  // Synchronize whenever playback state changes
  useEffect(() => {
    syncVideoWithPlayback();
  }, [
    playback.isPlaying,
    playback.currentTime,
    playback.livePitchOffset,
    playback.playbackSpeed,
    syncVideoWithPlayback
  ]);

  const activeQueueItem = playback.currentTrackId
    ? currentQueue.find((i) => i.track.id === playback.currentTrackId)
    : currentQueue[0];
  const activeQueueIndex = activeQueueItem
    ? currentQueue.findIndex((i) => i.queueId === activeQueueItem.queueId)
    : 0;

  const currentSinger = activeQueueItem?.assignedSingerName || '';
  const nextQueueItem = currentQueue[activeQueueIndex + 1] || null;
  const nextSinger = nextQueueItem?.assignedSingerName || '';

  // Intermission or pre-song state: when paused before or between tracks
  const isPostSongOrWaiting = !playback.isPlaying && currentQueue.length > 0 && playback.currentTime <= 1;

  // The upcoming track to announce on stage is always the active queue item waiting to be played
  const upcomingItem = activeQueueItem || currentQueue[0] || null;
  const upcomingIndex = upcomingItem
    ? currentQueue.findIndex((i) => i.queueId === upcomingItem.queueId)
    : 0;

  const followingItem =
    upcomingIndex >= 0 && upcomingIndex + 1 < currentQueue.length
      ? currentQueue[upcomingIndex + 1]
      : null;

  const introDuration = settings?.bannerIntroDurationSec ?? 6;
  const outroTrigger = settings?.bannerOutroTriggerSec ?? 20;
  const titleDuration = settings?.titleOverlayDurationSec ?? 8;

  const showIntroBanner = playback.isPlaying && playback.currentTime <= introDuration && Boolean(currentSinger);
  const showOutroBanner =
    playback.isPlaying &&
    playback.duration > 0 &&
    playback.currentTime >= playback.duration - outroTrigger &&
    Boolean(nextQueueItem);
  const showTitleOverlay =
    playback.isPlaying &&
    playback.currentTime <= titleDuration &&
    Boolean(activeTrack?.title);

  const stageMessages = mergeStageMessages(settings?.stageMessages);
  const unassignedMsg = resolveStageMessage(
    stageMessages.nextSingerUnassigned,
    t('banner.nextSingerUnassigned')
  );
  const unassignedLabel = unassignedMsg.enabled ? unassignedMsg.text : '';
  const nowSingingMsg = resolveStageMessage(
    stageMessages.nowSinging,
    t('banner.nowSinging', { name: currentSinger }),
    { name: currentSinger }
  );
  const upNextIntroMsg = resolveStageMessage(
    stageMessages.upNextIntro,
    t('banner.upNextIntro')
  );
  const getReadyMsg = resolveStageMessage(
    stageMessages.getReady,
    t('banner.getReady', { name: nextSinger || unassignedLabel }),
    { name: nextSinger || unassignedLabel }
  );
  const nextSongMsg = resolveStageMessage(stageMessages.nextSong, t('banner.nextSong'));
  const upNextOnStageMsg = resolveStageMessage(
    stageMessages.upNextOnStage,
    t('banner.upNextOnStage')
  );
  const followingSingerMsg = resolveStageMessage(
    stageMessages.followingSinger,
    t('banner.followingSinger')
  );
  const nextQueueSingerLabel =
    nextQueueItem?.assignedSingerName || (unassignedMsg.enabled ? unassignedMsg.text : '');
  const upcomingSingerLabel =
    upcomingItem?.assignedSingerName || (unassignedMsg.enabled ? unassignedMsg.text : '');
  const followingSingerLabel =
    followingItem?.assignedSingerName || (unassignedMsg.enabled ? unassignedMsg.text : '');


  // Track which overlay messages are painted this frame (enabled + timing gates).
  // Backdrop overrides apply only for this set; when it empties the override layer
  // unmounts and the normal Stage theme/video background is restored immediately
  // (settings already sync live via sync:settings — no Stage restart required).
  const visibleStageMessageKeys: StageMessageKey[] = [];
  if (showIntroBanner) {
    if (nowSingingMsg.enabled) visibleStageMessageKeys.push('nowSinging');
    if ((settings?.showNextSingerAtIntro ?? true) && nextQueueItem) {
      if (upNextIntroMsg.enabled) visibleStageMessageKeys.push('upNextIntro');
      if (!nextQueueItem.assignedSingerName && unassignedMsg.enabled) {
        visibleStageMessageKeys.push('nextSingerUnassigned');
      }
    }
  }
  if (showOutroBanner) {
    if (getReadyMsg.enabled) visibleStageMessageKeys.push('getReady');
    if (nextQueueItem && nextSongMsg.enabled) visibleStageMessageKeys.push('nextSong');
  }
  if (isPostSongOrWaiting && upcomingItem) {
    if (upNextOnStageMsg.enabled) visibleStageMessageKeys.push('upNextOnStage');
    if (!upcomingItem.assignedSingerName && unassignedMsg.enabled) {
      visibleStageMessageKeys.push('nextSingerUnassigned');
    }
    if (followingItem) {
      if (followingSingerMsg.enabled) visibleStageMessageKeys.push('followingSinger');
      if (!followingItem.assignedSingerName && unassignedMsg.enabled) {
        visibleStageMessageKeys.push('nextSingerUnassigned');
      }
    }
  }
  const activeMessageBackground = pickActiveStageMessageBackground(
    stageMessages,
    visibleStageMessageKeys
  );
  const messageBackgroundCss = activeMessageBackground
    ? stageMessageBackgroundCss(activeMessageBackground)
    : null;

  if (!isStageReady) {
    return <div className="w-screen h-screen bg-black" />;
  }

  return (
    <div
      onDoubleClick={toggleFullscreen}
      className="stage-screen-container w-screen h-screen relative overflow-hidden select-none flex items-center justify-center cursor-pointer"
    >
      {/* Message backdrop: full-bleed override while banners/waiting card are visible.
          pointer-events-none so double-click fullscreen and video interaction still work.
          Unmounts when messageBackgroundCss is null → normal Stage look returns. */}
      {messageBackgroundCss && (
        <div
          className="absolute inset-0 z-[5] pointer-events-none transition-opacity duration-300"
          style={messageBackgroundCss}
          data-testid="stage-message-background"
          aria-hidden
        />
      )}
      {/* Intro Banner: Ora Canta (+ Next Singer if enabled in settings) */}
      {showIntroBanner && (nowSingingMsg.enabled || ((settings?.showNextSingerAtIntro ?? true) && nextQueueItem && (upNextIntroMsg.enabled || unassignedMsg.enabled))) && (
        <div className="absolute top-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-50 pointer-events-none">
          {nowSingingMsg.enabled && (
            <div className="bg-indigo-600/90 backdrop-blur-md px-10 py-3.5 rounded-full border border-indigo-400/50 shadow-2xl text-center animate-bounce">
              <span
                className="uppercase tracking-wider text-yellow-300 drop-shadow-md"
                style={stageMessageCss(nowSingingMsg)}
                data-testid="stage-msg-nowSinging"
              >
                {nowSingingMsg.text}
              </span>
            </div>
          )}

          {(settings?.showNextSingerAtIntro ?? true) && nextQueueItem && (upNextIntroMsg.enabled || Boolean(nextQueueSingerLabel)) && (
            <div className="bg-slate-900/90 backdrop-blur-md px-6 py-2 rounded-full border border-indigo-500/40 shadow-xl text-center flex items-center gap-2.5 animate-fadeIn">
              {upNextIntroMsg.enabled && (
                <span
                  className="text-indigo-300 uppercase tracking-wider"
                  style={stageMessageCss(upNextIntroMsg)}
                  data-testid="stage-msg-upNextIntro"
                >
                  {upNextIntroMsg.text}:
                </span>
              )}
              {nextQueueSingerLabel ? (
                <span className="text-sm md:text-base font-bold text-white" style={unassignedMsg.enabled && !nextQueueItem.assignedSingerName ? stageMessageCss(unassignedMsg) : undefined}>
                  {nextQueueSingerLabel}
                </span>
              ) : null}
              <span className="text-xs md:text-sm text-slate-300 opacity-80 line-clamp-1">
                • {nextQueueItem.track.title}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Outro Banner: Preparati + Prossima Canzone */}
      {showOutroBanner && (getReadyMsg.enabled || (nextQueueItem && nextSongMsg.enabled)) && (
        <div className="absolute top-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-50 pointer-events-none animate-pulse">
          {getReadyMsg.enabled && (
            <div className="bg-amber-600/90 backdrop-blur-md px-10 py-3.5 rounded-full border border-amber-400/50 shadow-2xl text-center">
              <span
                className="uppercase tracking-wider text-white drop-shadow-md"
                style={stageMessageCss(getReadyMsg)}
                data-testid="stage-msg-getReady"
              >
                {getReadyMsg.text}
              </span>
            </div>
          )}

          {nextQueueItem && nextSongMsg.enabled && (
            <div className="bg-slate-900/90 backdrop-blur-md px-6 py-2 rounded-full border border-amber-500/40 shadow-xl text-center flex items-center gap-2.5">
              <span
                className="text-amber-300 uppercase tracking-wider"
                style={stageMessageCss(nextSongMsg)}
                data-testid="stage-msg-nextSong"
              >
                {nextSongMsg.text}:
              </span>
              <span className="text-sm md:text-base font-bold text-white">
                {nextQueueItem.track.title}
              </span>
              {nextQueueItem.track.artist && (
                <span className="text-xs md:text-sm text-slate-300 opacity-80 line-clamp-1">
                  ({nextQueueItem.track.artist})
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Floating Live Pitch Semitone Offset Badge (+N / -N / 0) — always when toggle enabled */}
      {(settings?.showPitchOnStage ?? true) && (
        <div
          className="absolute top-6 right-6 z-[70] bg-slate-950/95 backdrop-blur-md border border-indigo-500/50 px-4 py-2 rounded-full text-sm font-mono text-indigo-300 font-bold shadow-[0_8px_30px_rgba(0,0,0,0.65)] pointer-events-none tracking-wide"
          data-testid="stage-semitone-badge"
          aria-label={`Pitch ${playback.livePitchOffset > 0 ? '+' : ''}${playback.livePitchOffset}`}
        >
          {playback.livePitchOffset > 0 ? `+${playback.livePitchOffset}` : `${playback.livePitchOffset}`}
        </div>
      )}

      {(settings?.showSpeedOnStage ?? true) && (
        <div
          className="absolute top-6 right-28 z-[70] bg-slate-950/95 backdrop-blur-md border border-emerald-500/50 px-4 py-2 rounded-full text-sm font-mono text-emerald-300 font-bold shadow-[0_8px_30px_rgba(0,0,0,0.65)] pointer-events-none tracking-wide"
          data-testid="stage-speed-badge"
          aria-label={`Speed ${(playback.playbackSpeed || 1).toFixed(2)}x`}
        >
          {`${Number(playback.playbackSpeed || 1).toFixed(2)}x`}
        </div>
      )}

      {/* Temporary Floating Bottom-Center Track Title & Artist Overlay */}
      {showTitleOverlay && activeTrack?.title && (
        <div className="absolute bottom-6 md:bottom-10 left-1/2 -translate-x-1/2 z-40 max-w-[90vw] text-center pointer-events-none transition-all duration-700 ease-in-out">
          <div className="bg-black/80 backdrop-blur-md px-6 md:px-10 py-2.5 md:py-3.5 rounded-2xl border border-white/20 shadow-[0_10px_35px_rgba(0,0,0,0.85)] inline-flex flex-col items-center gap-0.5">
            <span className="text-xl md:text-3xl font-black text-white tracking-wide drop-shadow-md line-clamp-1">
              {activeTrack.title}
            </span>
            {activeTrack.artist && (
              <span className="text-xs md:text-base font-semibold text-slate-300 tracking-wider uppercase opacity-90 line-clamp-1">
                {activeTrack.artist}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Stage Main Center Display: Edge-to-Edge Video, CDG Canvas or Dynamic Typography */}
      <div className="w-full h-full relative flex items-center justify-center overflow-hidden">
        {/* Video Player for MP4 / WebM / YouTube Videos - Maximized to fill all available space */}
        <video
          ref={stageVideoRef}
          onDoubleClick={toggleFullscreen}
          src={isVideoTrack && activeTrack?.uri ? activeTrack.uri : undefined}
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={(e) => {
            const video = e.currentTarget;
            video.muted = true;
            video.defaultMuted = true;
            video.volume = 0;
            const currentPlayback = playbackRef.current;
            video.playbackRate = currentPlayback.playbackSpeed || 1;
            if (currentPlayback.currentTime > 0.1) {
              isAligningRef.current = true;
              lastHardSeekTimeRef.current = Date.now();
              try {
                video.currentTime = currentPlayback.currentTime;
              } catch (err) {
                console.warn('Initial seek on metadata:', err);
                isAligningRef.current = false;
              }
            } else if (currentPlayback.isPlaying) {
              video.play().catch(console.warn);
            }
          }}
          onCanPlay={(e) => {
            const video = e.currentTarget;
            const currentPlayback = playbackRef.current;
            if (!isAligningRef.current && !video.seeking && currentPlayback.isPlaying && video.paused) {
              video.play().catch(console.warn);
            }
          }}
          onSeeked={(e) => {
            const video = e.currentTarget;
            isAligningRef.current = false;
            lastHardSeekTimeRef.current = Date.now();
            const currentPlayback = playbackRef.current;
            if (currentPlayback.isPlaying && video.paused) {
              video.play().catch(console.warn);
            }
          }}
          onError={(e) => {
            const mediaErr = e.currentTarget.error;
            console.error('Stage video media playback error:', mediaErr);
            window.karaokeApi?.logger?.log('error', 'StageWindow:Video', 'Stage video playback error', {
              code: mediaErr?.code,
              message: mediaErr?.message,
              src: e.currentTarget.currentSrc
            });
          }}
          className={`w-full h-full object-contain absolute inset-0 z-0 transition-opacity duration-200 ${
            isVideoTrack ? 'opacity-100 block' : 'opacity-0 hidden'
          }`}
        />

        {/* CDG Canvas for CD+G standard graphics */}
        <canvas
          ref={canvasRef}
          onDoubleClick={toggleFullscreen}
          className={`w-full h-full max-w-full max-h-full aspect-[300/216] object-contain relative z-10 ${
            hasCdgLoaded ? 'block' : 'hidden'
          }`}
        />

        {/* Centered Synchronized Lyrics Overlay (ONLY for non-video tracks without CDG) */}
        {playback.activeLyricsText && !hasCdgLoaded && !isVideoTrack && (
          <div className="absolute inset-0 flex items-center justify-center p-8 text-center pointer-events-none z-20">
            <div className="max-w-5xl text-4xl md:text-6xl lg:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-pink-400 to-indigo-300 leading-tight drop-shadow-[0_6px_25px_rgba(0,0,0,0.98)]">
              {playback.activeLyricsText}
            </div>
          </div>
        )}

        {/* Fullscreen Next Singer / Upcoming Track Stage Card */}
        {isPostSongOrWaiting && upcomingItem && (
          <div
            onDoubleClick={toggleFullscreen}
            className={`absolute inset-0 z-30 flex flex-col items-center justify-center p-6 md:p-12 text-center select-none animate-fadeIn ${
              messageBackgroundCss ? 'bg-transparent' : 'bg-slate-950/95 backdrop-blur-2xl'
            }`}
          >
            {/* Ambient atmospheric lighting */}
            <div className="absolute w-[600px] h-[600px] bg-indigo-600/15 rounded-full blur-3xl pointer-events-none animate-pulse -top-20" />
            <div className="absolute w-[450px] h-[450px] bg-fuchsia-600/10 rounded-full blur-3xl pointer-events-none -bottom-20 -right-20" />

            <div className="relative z-10 max-w-4xl w-full flex flex-col items-center gap-6">
              {/* Badge: Prossimo Cantante sul Palco */}
              {upNextOnStageMsg.enabled && (
                <div
                  className="inline-flex items-center gap-2.5 px-6 py-2 rounded-full bg-indigo-500/20 border border-indigo-400/40 text-indigo-300 font-bold uppercase tracking-widest shadow-lg shadow-indigo-500/10"
                  style={stageMessageCss(upNextOnStageMsg)}
                  data-testid="stage-msg-upNextOnStage"
                >
                  <Mic className="w-5 h-5 text-indigo-400 animate-bounce" />
                  <span>{upNextOnStageMsg.text}</span>
                </div>
              )}

              {/* Singer Name */}
              <h1 className="text-4xl sm:text-6xl md:text-7xl lg:text-8xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-pink-400 to-indigo-300 drop-shadow-[0_10px_35px_rgba(0,0,0,0.9)] max-w-full break-words">
                {upcomingSingerLabel}
              </h1>

              {/* Song Card */}
              <div className="w-full max-w-2xl bg-slate-900/80 border border-slate-700/80 rounded-3xl p-6 md:p-8 shadow-2xl backdrop-blur-md flex flex-col sm:flex-row items-center gap-6 mt-2">
                {upcomingItem.track.thumbnailUrl ? (
                  <img
                    src={upcomingItem.track.thumbnailUrl}
                    alt=""
                    className="w-24 h-24 md:w-32 md:h-32 object-cover rounded-2xl border border-slate-700 shadow-md shrink-0"
                  />
                ) : (
                  <div className="w-24 h-24 md:w-32 md:h-32 rounded-2xl bg-gradient-to-br from-indigo-900/60 to-purple-900/60 border border-indigo-500/30 flex items-center justify-center shrink-0 shadow-inner">
                    <Music className="w-12 h-12 md:w-16 md:h-16 text-indigo-400" />
                  </div>
                )}

                <div className="flex-1 text-center sm:text-left min-w-0">
                  {nextSongMsg.enabled && (
                    <span
                      className="uppercase tracking-widest text-indigo-400 block mb-1"
                      style={stageMessageCss(nextSongMsg)}
                    >
                      {nextSongMsg.text}
                    </span>
                  )}
                  <h2 className="text-2xl md:text-3xl font-extrabold text-white line-clamp-2 drop-shadow-md">
                    {upcomingItem.track.title}
                  </h2>
                  {upcomingItem.track.artist && (
                    <p className="text-base md:text-lg text-slate-300 font-medium tracking-wide mt-1 line-clamp-1">
                      {upcomingItem.track.artist}
                    </p>
                  )}

                  {upcomingItem.pitchOffset !== 0 && (
                    <div className="inline-block mt-3 px-3 py-1 rounded-full bg-slate-800/90 border border-slate-700 text-xs font-mono font-bold text-amber-300">
                      {t('guestRequests.pitch')}: {upcomingItem.pitchOffset > 0 ? `+${upcomingItem.pitchOffset}` : upcomingItem.pitchOffset}
                    </div>
                  )}
                </div>
              </div>

              {/* Following singer preview */}
              {followingItem && (followingSingerMsg.enabled || Boolean(followingSingerLabel)) && (
                <div className="text-xs md:text-sm text-slate-400 flex items-center gap-2 mt-1">
                  {followingSingerMsg.enabled && (
                    <span
                      className="uppercase tracking-wider text-slate-500"
                      style={stageMessageCss(followingSingerMsg)}
                      data-testid="stage-msg-followingSinger"
                    >
                      {followingSingerMsg.text}:
                    </span>
                  )}
                  {followingSingerLabel ? (
                    <span className="font-bold text-slate-300">{followingSingerLabel}</span>
                  ) : null}
                  <span className="text-slate-500">• {followingItem.track.title}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Idle Placeholder when no track is loaded */}
        {!isPostSongOrWaiting && !hasCdgLoaded && !isVideoTrack && !playback.activeLyricsText && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center pointer-events-none z-10">
            <div className="relative mb-6">
              <div className="absolute -inset-6 bg-gradient-to-r from-indigo-500/25 to-purple-500/25 rounded-full blur-2xl animate-pulse" />
              <img
                src={appLogo}
                alt="Karaoke Live Station"
                className="relative w-40 h-40 md:w-52 md:h-52 object-contain drop-shadow-[0_12px_40px_rgba(99,102,241,0.45)]"
              />
            </div>
            <div className="text-slate-300 text-xl md:text-2xl font-extrabold tracking-wide mb-1">
              Karaoke Live Station
            </div>
            <div className="text-slate-500 text-xs md:text-sm font-medium">
              {playback.isPlaying ? '•••' : t('player.noTrackLoaded')}
            </div>
          </div>
        )}
      </div>

      {/* Sleek Flush Bottom Progress Bar */}
      <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/50 z-50 pointer-events-none">
        <div
          className="h-full bg-indigo-500/90 shadow-[0_0_8px_rgba(99,102,241,0.8)] transition-all duration-150"
          style={{
            width: `${playback.duration > 0 ? (playback.currentTime / playback.duration) * 100 : 0}%`
          }}
        />
      </div>
    </div>
  );
};
