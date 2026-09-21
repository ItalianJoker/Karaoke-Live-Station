import { useCallback, type MutableRefObject, type RefObject } from 'react';
import type { AudioGraphManager } from '../core/AudioGraphManager';
import { useKaraokeStore } from '../store/karaokeStore';
import {
  checkTrackLocalFileExists,
  trackNeedsLocalFileCheck
} from '../utils/localFileCheck';
import type { KaraokeMediaTrack, QueueItem } from '../../shared/types';

/**
 * Playback transport handlers for the Control (Regia) window.
 *
 * **Audience (humans):** Encapsulates play/pause, stop, seek, restart, jump-to-queue,
 * and CUE preview so ControlWindow stays a composition root rather than a monolith.
 *
 * **Audience (AI):** Do not change missing-file gating, SIAE stop logging (≥120s via
 * `logCurrentTrackExecution`), or Stage sync `sendStateSync` payloads. Guard clauses
 * early-return when queue head / track identity is absent.
 *
 * @param deps - Refs and store slices needed by transport actions
 * @returns Stable handler callbacks for PlayerDeckControls / QueueList / shortcuts
 */
export function useControlPlayback(deps: {
  audioGraphRef: MutableRefObject<AudioGraphManager | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  currentTrack: KaraokeMediaTrack | undefined;
  currentQueueItem: QueueItem | undefined;
  isMidiTrack: boolean;
  isPlaying: boolean;
  duration: number;
  cueAudioDeviceId: string | undefined;
  setActiveCueUri: (uri: string | undefined) => void;
}): {
  pauseResetForMissingFile: () => void;
  openMissingForQueueItem: (
    track: { id: string; title: string; artist: string; localFilePath?: string },
    filePath: string,
    queueItemId?: string
  ) => void;
  handleJumpToTrack: (index: number) => Promise<void>;
  handlePlayCue: (uri: string) => void;
  handleStopCue: () => void;
  handlePlayPause: () => Promise<void>;
  handleStop: () => void;
  handleSeek: (timeSec: number) => void;
  handleRestart: () => void;
} {
  const {
    audioGraphRef,
    videoRef,
    currentTrack,
    currentQueueItem,
    isMidiTrack,
    isPlaying,
    duration,
    cueAudioDeviceId,
    setActiveCueUri
  } = deps;

  const setPlaybackState = useKaraokeStore((s) => s.setPlaybackState);
  const togglePlayPause = useKaraokeStore((s) => s.togglePlayPause);
  const jumpToQueueItem = useKaraokeStore((s) => s.jumpToQueueItem);
  const showMissingFileModal = useKaraokeStore((s) => s.showMissingFileModal);
  const markTrackMissing = useKaraokeStore((s) => s.markTrackMissing);
  const clearTrackMissing = useKaraokeStore((s) => s.clearTrackMissing);
  const queue = useKaraokeStore((s) => s.queue);

  /**
   * Safely pause / reset media graph when a local file is missing.
   * Why: never leave AudioGraph or `<video>` in a rejecting play() state.
   */
  const pauseResetForMissingFile = useCallback(() => {
    try {
      audioGraphRef.current?.stopMidiPlayback();
    } catch {
      // ignore
    }
    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      } catch {
        // ignore
      }
    }
    setPlaybackState({ isPlaying: false, currentTime: 0, activeLyricsText: undefined });
  }, [audioGraphRef, videoRef, setPlaybackState]);

  const openMissingForQueueItem = useCallback(
    (
      track: { id: string; title: string; artist: string; localFilePath?: string },
      filePath: string,
      queueItemId?: string
    ) => {
      markTrackMissing(track.id);
      showMissingFileModal({
        filePath,
        trackTitle: track.title,
        trackArtist: track.artist,
        trackId: track.id,
        queueItemId,
        context: 'queue'
      });
    },
    [markTrackMissing, showMissingFileModal]
  );

  const handleSeek = useCallback(
    (timeSec: number) => {
      const maxDur = duration > 0 ? duration : 3600;
      const safeTime = Math.max(0, Math.min(maxDur, timeSec));
      setPlaybackState({ currentTime: safeTime });
      if (isMidiTrack) {
        audioGraphRef.current?.seekMidi(safeTime * 1000);
      } else if (videoRef.current) {
        videoRef.current.currentTime = safeTime;
      }
      if (typeof window !== 'undefined' && window.karaokeApi) {
        const curPlayback = {
          ...useKaraokeStore.getState().playback,
          currentTime: safeTime
        };
        window.karaokeApi.sendStateSync(curPlayback);
      }
    },
    [audioGraphRef, videoRef, duration, isMidiTrack, setPlaybackState]
  );

  const handleRestart = useCallback(() => {
    handleSeek(0);
  }, [handleSeek]);

  const handlePlayPause = useCallback(async () => {
    if (!currentTrack || !currentQueueItem) return;

    // Starting playback — verify local path before AudioGraph / video feed
    if (!isPlaying && trackNeedsLocalFileCheck(currentTrack)) {
      const check = await checkTrackLocalFileExists(currentTrack);
      if (!check.exists) {
        pauseResetForMissingFile();
        openMissingForQueueItem(currentTrack, check.path, currentQueueItem.queueId);
        return;
      }
      clearTrackMissing(currentTrack.id);
    }

    if (!isPlaying) {
      const curPitch = useKaraokeStore.getState().playback.livePitchOffset;
      if (curPitch !== currentQueueItem.pitchOffset) {
        setPlaybackState({ livePitchOffset: currentQueueItem.pitchOffset });
      }
      audioGraphRef.current?.setPitchOffset(currentQueueItem.pitchOffset);
    }

    await audioGraphRef.current?.initContext();
    togglePlayPause();
  }, [
    audioGraphRef,
    currentTrack,
    currentQueueItem,
    isPlaying,
    pauseResetForMissingFile,
    openMissingForQueueItem,
    clearTrackMissing,
    setPlaybackState,
    togglePlayPause
  ]);

  const handleStop = useCallback(() => {
    // Record into SIAE history if the song was played for at least 120s (2 minutes) before stopping
    useKaraokeStore.getState().logCurrentTrackExecution({ naturalEnd: false });

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
    audioGraphRef.current?.stopMidiPlayback();
    setPlaybackState({ isPlaying: false, currentTime: 0, activeLyricsText: undefined });
  }, [audioGraphRef, videoRef, setPlaybackState]);

  const handleJumpToTrack = useCallback(
    async (index: number) => {
      const item = queue[index];
      if (!item) return;

      if (trackNeedsLocalFileCheck(item.track)) {
        const check = await checkTrackLocalFileExists(item.track);
        if (!check.exists) {
          pauseResetForMissingFile();
          openMissingForQueueItem(item.track, check.path, item.queueId);
          return;
        }
        clearTrackMissing(item.track.id);
      }

      audioGraphRef.current?.stopMidiPlayback();
      await audioGraphRef.current?.initContext();
      if (index === 0) {
        handleRestart();
        if (!isPlaying) {
          await handlePlayPause();
        }
      } else {
        jumpToQueueItem(index);
      }
    },
    [
      queue,
      audioGraphRef,
      pauseResetForMissingFile,
      openMissingForQueueItem,
      clearTrackMissing,
      handleRestart,
      handlePlayPause,
      isPlaying,
      jumpToQueueItem
    ]
  );

  const handlePlayCue = useCallback(
    (uri: string) => {
      setActiveCueUri(uri);
      audioGraphRef.current?.playCuePreview(uri, cueAudioDeviceId);
    },
    [audioGraphRef, cueAudioDeviceId, setActiveCueUri]
  );

  const handleStopCue = useCallback(() => {
    setActiveCueUri(undefined);
    audioGraphRef.current?.stopCuePreview();
  }, [audioGraphRef, setActiveCueUri]);

  return {
    pauseResetForMissingFile,
    openMissingForQueueItem,
    handleJumpToTrack,
    handlePlayCue,
    handleStopCue,
    handlePlayPause,
    handleStop,
    handleSeek,
    handleRestart
  };
}
