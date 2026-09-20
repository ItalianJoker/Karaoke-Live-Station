import { useCallback, useEffect, type RefObject } from 'react';
import type { AudioGraphManager } from '../core/AudioGraphManager';
import { useKaraokeStore } from '../store/karaokeStore';
import {
  clampSpeedForEngine,
  coerceDspPitchEngine,
  getPitchRangeForEngine,
  getSpeedRangeForEngine
} from '../../shared/dspPitch';

export type ControlRightTab = 'queue' | 'library' | 'history';

/**
 * Global keyboard shortcuts for the Control (Regia) window.
 *
 * **Audience (humans):** Mirrors `src/renderer/data/appShortcuts.ts` (help modal + Settings).
 * Ignored while focus is in INPUT/TEXTAREA/SELECT except Escape (blur + close modals).
 *
 * **Audience (AI):** Do not delete handlers that look unused — shortcuts are a Watchlist
 * surface (Space/N/M/Ctrl+F etc.). Pitch clamp uses {@link getPitchRangeForEngine}
 * (Signalsmith ±8 / SoundTouch ±4). Speed ± uses `clampSpeedForEngine` /
 * `getSpeedRangeForEngine` — keep in sync with PlayerDeckControls.
 * with PlayerDeckControls.
 *
 * @param deps - Transport handlers + modal/tab setters wired by ControlWindow
 */
export function useKeyboardShortcuts(deps: {
  audioGraphRef: RefObject<AudioGraphManager | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  handlePlayPause: () => void | Promise<void>;
  handleStop: () => void;
  handleRestart: () => void;
  handleSeek: (timeSec: number) => void;
  setActiveRightTab: (tab: ControlRightTab) => void;
  setShowSettingsModal: (v: boolean | ((p: boolean) => boolean)) => void;
  setShowSingersModal: (v: boolean | ((p: boolean) => boolean)) => void;
  setShowGuestModal: (v: boolean | ((p: boolean) => boolean)) => void;
  setShowPortalQrModal: (v: boolean | ((p: boolean) => boolean)) => void;
  setShowShortcutsModal: (v: boolean | ((p: boolean) => boolean)) => void;
}): void {
  const {
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
  } = deps;

  // Granular selectors — avoid rebinding on unrelated playback field churn
  const isMuted = useKaraokeStore((s) => s.playback.isMuted);
  const isVocalRemoverActive = useKaraokeStore((s) => s.playback.isVocalRemoverActive);
  const isDuckingActive = useKaraokeStore((s) => s.playback.isDuckingActive);
  const livePitchOffset = useKaraokeStore((s) => s.playback.livePitchOffset);
  const playbackSpeed = useKaraokeStore((s) => s.playback.playbackSpeed);
  const currentTime = useKaraokeStore((s) => s.playback.currentTime);
  const duration = useKaraokeStore((s) => s.playback.duration);
  const masterVolume = useKaraokeStore((s) => s.playback.masterVolume);

  const setPlaybackState = useKaraokeStore((s) => s.setPlaybackState);
  const setLivePitch = useKaraokeStore((s) => s.setLivePitch);
  const setPlaybackSpeed = useKaraokeStore((s) => s.setPlaybackSpeed);
  const setVocalRemover = useKaraokeStore((s) => s.setVocalRemover);
  const setDucking = useKaraokeStore((s) => s.setDucking);
  const closeMissingFileModal = useKaraokeStore((s) => s.closeMissingFileModal);
  const advanceToNextTrack = useKaraokeStore((s) => s.advanceToNextTrack);
  const dspEngine = useKaraokeStore((s) => coerceDspPitchEngine(s.settings.dspEngine));
  const speedRange = getSpeedRangeForEngine(dspEngine);
  const pitchRange = getPitchRangeForEngine(dspEngine);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        if (e.key === 'Escape') {
          (e.target as HTMLElement).blur();
          closeMissingFileModal();
          setShowSettingsModal(false);
          setShowSingersModal(false);
          setShowGuestModal(false);
          setShowPortalQrModal(false);
          setShowShortcutsModal(false);
        }
        return;
      }

      if (e.key === 'Escape') {
        closeMissingFileModal();
        setShowSettingsModal(false);
        setShowSingersModal(false);
        setShowGuestModal(false);
        setShowPortalQrModal(false);
        setShowShortcutsModal(false);
      } else if (e.code === 'Space') {
        e.preventDefault();
        void handlePlayPause();
      } else if (e.code === 'KeyN') {
        e.preventDefault();
        audioGraphRef.current?.stopMidiPlayback();
        advanceToNextTrack();
      } else if (e.code === 'KeyS') {
        e.preventDefault();
        handleStop();
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        handleRestart();
      } else if (e.code === 'KeyM') {
        e.preventDefault();
        setPlaybackState({ isMuted: !isMuted });
      } else if (e.code === 'KeyV') {
        e.preventDefault();
        setVocalRemover(!isVocalRemoverActive);
      } else if (e.code === 'KeyD') {
        e.preventDefault();
        setDucking(!isDuckingActive);
      } else if (e.code === 'KeyP' || e.code === 'F2') {
        e.preventDefault();
        window.karaokeApi?.reopenStageWindow();
      } else if (e.code === 'Digit1' || e.key === '1') {
        e.preventDefault();
        setActiveRightTab('queue');
      } else if (e.code === 'Digit2' || e.key === '2') {
        e.preventDefault();
        setActiveRightTab('library');
      } else if (e.code === 'Digit3' || e.key === '3') {
        e.preventDefault();
        setActiveRightTab('history');
      } else if (e.code === 'F1' || (e.key === '?' && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault();
        setShowShortcutsModal((prev) => !prev);
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'ArrowUp') {
        e.preventDefault();
        setLivePitch(Math.min(pitchRange.max, livePitchOffset + 1));
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'ArrowDown') {
        e.preventDefault();
        setLivePitch(Math.max(pitchRange.min, livePitchOffset - 1));
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'ArrowLeft') {
        e.preventDefault();
        setPlaybackSpeed(
          clampSpeedForEngine(playbackSpeed - speedRange.step, dspEngine)
        );
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'ArrowRight') {
        e.preventDefault();
        setPlaybackSpeed(
          clampSpeedForEngine(playbackSpeed + speedRange.step, dspEngine)
        );
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        const newTime = Math.max(0, currentTime - 5);
        handleSeek(newTime);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        const newTime = Math.min(duration, currentTime + 5);
        handleSeek(newTime);
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        setPlaybackState({ masterVolume: Math.min(1, masterVolume + 0.05) });
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        setPlaybackState({ masterVolume: Math.max(0, masterVolume - 0.05) });
      } else if (e.key === '+' || e.code === 'NumpadAdd' || e.key === '=') {
        e.preventDefault();
        setLivePitch(Math.min(pitchRange.max, livePitchOffset + 1));
      } else if (e.key === '-' || e.code === 'NumpadSubtract') {
        e.preventDefault();
        setLivePitch(Math.max(pitchRange.min, livePitchOffset - 1));
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF') {
        e.preventDefault();
        setActiveRightTab('library');
        searchInputRef.current?.focus();
      }
    },
    [
      audioGraphRef,
      searchInputRef,
      handlePlayPause,
      handleStop,
      handleRestart,
      handleSeek,
      advanceToNextTrack,
      setLivePitch,
      setPlaybackSpeed,
      setPlaybackState,
      setVocalRemover,
      setDucking,
      closeMissingFileModal,
      setActiveRightTab,
      setShowSettingsModal,
      setShowSingersModal,
      setShowGuestModal,
      setShowPortalQrModal,
      setShowShortcutsModal,
      isMuted,
      isVocalRemoverActive,
      isDuckingActive,
      livePitchOffset,
      playbackSpeed,
      currentTime,
      duration,
      masterVolume,
      dspEngine,
      speedRange.step,
      pitchRange.min,
      pitchRange.max
    ]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
