import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Play,
  Pause,
  Square,
  SkipForward,
  RotateCcw,
  Volume2,
  VolumeX
} from 'lucide-react';
import { useKaraokeStore } from '../store/karaokeStore';
import {
  clampSpeedForEngine,
  coerceDspPitchEngine,
  type DspPitchEngine
} from '../../shared/dspPitch';
import { formatBpmTransition, formatKeyTransition } from '../../shared/musicalKeys';

export interface PlayerDeckControlsProps {
  /** Inclusive pitch range for the active DSP engine (semitones). */
  pitchRange: { min: number; max: number };
  /** Per-engine Control speed range (Signalsmith 0.50–1.50 / SoundTouch 0.75–1.25). */
  speedRange: { min: number; max: number; step: number };
  /** Active DSP engine — used with `clampSpeedForEngine` on ± buttons. */
  dspEngine: DspPitchEngine;
  onPlayPause: () => void;
  onStop: () => void;
  onRestart: () => void;
  onNext: () => void;
}

/**
 * Transport + live DSP dock (play/pause/stop/restart/next, pitch, speed, volume, vocal/duck).
 *
 * **Audience (humans):** Floating Material-style control bar under the Regia preview.
 *
 * **Audience (AI):** Uses granular Zustand selectors. Pitch 0 / speed 1.00 click resets are
 * intentional UX; do not change volume² curve (lives in AudioGraphManager). Keep button
 * titles/shortcut hints in sync with `appShortcuts.ts`. Key/BPM labels (#54) and
 * `clampSpeedForEngine` (#56) must stay beside pitch/speed controls.
 */
export const PlayerDeckControls: React.FC<PlayerDeckControlsProps> = ({
  pitchRange,
  speedRange,
  dspEngine,
  onPlayPause,
  onStop,
  onRestart,
  onNext
}) => {
  const { t } = useTranslation();

  const isPlaying = useKaraokeStore((s) => s.playback.isPlaying);
  const livePitchOffset = useKaraokeStore((s) => s.playback.livePitchOffset);
  const playbackSpeed = useKaraokeStore((s) => s.playback.playbackSpeed);
  const isMuted = useKaraokeStore((s) => s.playback.isMuted);
  const masterVolume = useKaraokeStore((s) => s.playback.masterVolume);
  const isVocalRemoverActive = useKaraokeStore((s) => s.playback.isVocalRemoverActive);
  const isDuckingActive = useKaraokeStore((s) => s.playback.isDuckingActive);
  const initialKey = useKaraokeStore((s) => s.queue[0]?.track?.initialKey);
  const initialBpm = useKaraokeStore((s) => s.queue[0]?.track?.initialBpm);

  const setPlaybackState = useKaraokeStore((s) => s.setPlaybackState);
  const setLivePitch = useKaraokeStore((s) => s.setLivePitch);
  const setPlaybackSpeed = useKaraokeStore((s) => s.setPlaybackSpeed);
  const setVocalRemover = useKaraokeStore((s) => s.setVocalRemover);
  const setDucking = useKaraokeStore((s) => s.setDucking);

  const engine = coerceDspPitchEngine(dspEngine);

  const keyLabel = formatKeyTransition(initialKey, livePitchOffset);
  const bpmLabel = formatBpmTransition(initialBpm, playbackSpeed);

  return (
    <div className="mt-4 p-3.5 bg-slate-950/60 border border-slate-800/80 rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-inner">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPlayPause}
          className="w-11 h-11 bg-gradient-to-tr from-indigo-600 to-violet-500 hover:from-indigo-500 hover:to-violet-400 rounded-full text-white shadow-lg shadow-indigo-600/30 transition-all duration-200 hover:scale-105 active:scale-95 flex items-center justify-center shrink-0"
          title={(isPlaying ? t('player.pause') : t('player.play')) + ' (Spazio)'}
        >
          {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
        </button>
        <button
          type="button"
          onClick={onStop}
          className="w-9 h-9 bg-slate-800/90 hover:bg-slate-700/90 rounded-full text-slate-300 border border-slate-700/60 shadow-sm flex items-center justify-center transition-all active:scale-95 shrink-0"
          title={t('player.stop') + ' (S)'}
        >
          <Square className="w-4 h-4 fill-current" />
        </button>
        <button
          type="button"
          onClick={onRestart}
          className="w-9 h-9 bg-slate-800/90 hover:bg-slate-700/90 rounded-full text-slate-300 border border-slate-700/60 shadow-sm flex items-center justify-center transition-all active:scale-95 shrink-0"
          title={t('player.restart') + ' (R)'}
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onNext}
          className="w-9 h-9 bg-slate-800/90 hover:bg-slate-700/90 rounded-full text-slate-300 border border-slate-700/60 shadow-sm flex items-center justify-center transition-all active:scale-95 shrink-0"
          title={t('player.next') + ' (N)'}
        >
          <SkipForward className="w-4 h-4" />
        </button>
      </div>

      {/* Pitch Controls (range depends on DSP engine) — key label affixed side-by-side */}
      <div className="flex items-center gap-1.5 bg-slate-800/90 px-3 py-1.5 rounded-full border border-slate-700/70 shadow-sm shrink-0">
        <span className="text-[11px] font-semibold text-slate-300 shrink-0" title="Tonalità in semitoni">
          {t('player.pitch')}:
          {keyLabel ? (
            <span className="ml-1 font-mono text-indigo-300/90 font-bold">{keyLabel}</span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={() => setLivePitch(livePitchOffset - 1)}
          disabled={livePitchOffset <= pitchRange.min}
          className="w-5 h-5 rounded-full bg-slate-700 hover:bg-indigo-600 disabled:opacity-40 disabled:hover:bg-slate-700 hover:text-white text-xs font-bold flex items-center justify-center transition-colors text-slate-200 shrink-0"
          title="Abbassa tonalità (-1 semitono, CTRL + Freccia Giù)"
        >
          -
        </button>
        <button
          type="button"
          onClick={() => setLivePitch(0)}
          className="font-mono font-bold text-xs min-w-[42px] px-1.5 py-0.5 rounded-full text-center text-indigo-400 hover:bg-indigo-950/70 hover:text-indigo-200 transition-colors cursor-pointer shrink-0"
          title="Clicca per azzerare la tonalità (0 ST)"
        >
          {livePitchOffset > 0 ? `+${livePitchOffset}` : livePitchOffset} ST
        </button>
        <button
          type="button"
          onClick={() => setLivePitch(livePitchOffset + 1)}
          disabled={livePitchOffset >= pitchRange.max}
          className="w-5 h-5 rounded-full bg-slate-700 hover:bg-indigo-600 disabled:opacity-40 disabled:hover:bg-slate-700 hover:text-white text-xs font-bold flex items-center justify-center transition-colors text-slate-200 shrink-0"
          title="Alza tonalità (+1 semitono, CTRL + Freccia Su)"
        >
          +
        </button>
      </div>

      {/* Speed Controls — per-engine range + BPM label affixed side-by-side */}
      <div className="flex items-center gap-1.5 bg-slate-800/90 px-3 py-1.5 rounded-full border border-slate-700/70 shadow-sm shrink-0">
        <span className="text-[11px] font-semibold text-slate-300 shrink-0">
          {t('player.speed')}:
          {bpmLabel ? (
            <span className="ml-1 font-mono text-emerald-300/90 font-bold">{bpmLabel}</span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={() =>
            setPlaybackSpeed(clampSpeedForEngine(playbackSpeed - speedRange.step, engine))
          }
          disabled={playbackSpeed <= speedRange.min + 1e-6}
          className="w-5 h-5 rounded-full bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:hover:bg-slate-700 text-xs font-bold flex items-center justify-center text-slate-200 transition-all shrink-0"
          title={`Rallenta tempo (−${speedRange.step.toFixed(2)}x, CTRL + Freccia Sinistra)`}
        >
          -
        </button>
        <span
          onClick={() => setPlaybackSpeed(1.0)}
          className="font-mono font-bold text-xs w-9 text-center text-emerald-400 hover:underline cursor-pointer shrink-0"
          title="Clicca per ripristinare tempo 1.00x"
        >
          {playbackSpeed.toFixed(2)}x
        </span>
        <button
          type="button"
          onClick={() =>
            setPlaybackSpeed(clampSpeedForEngine(playbackSpeed + speedRange.step, engine))
          }
          disabled={playbackSpeed >= speedRange.max - 1e-6}
          className="w-5 h-5 rounded-full bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:hover:bg-slate-700 text-xs font-bold flex items-center justify-center text-slate-200 transition-all shrink-0"
          title={`Aumenta tempo (+${speedRange.step.toFixed(2)}x, CTRL + Freccia Destra)`}
        >
          +
        </button>
      </div>

      {/* Volume & Mute */}
      <div className="flex items-center gap-2 bg-slate-800/90 px-3 py-1.5 rounded-full border border-slate-700/70 shadow-sm">
        <button
          type="button"
          onClick={() => setPlaybackState({ isMuted: !isMuted })}
          className="text-slate-300 hover:text-white transition-colors"
        >
          {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={isMuted ? 0 : masterVolume}
          onChange={(e) => setPlaybackState({ masterVolume: parseFloat(e.target.value), isMuted: false })}
          className="w-16 h-1 accent-indigo-500 cursor-pointer"
        />
      </div>

      {/* DSP Toggles: Vocal Remover & Ducking */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setVocalRemover(!isVocalRemoverActive)}
          title={t('player.vocalRemover')}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold border shadow-sm transition-all duration-150 active:scale-95 ${
            isVocalRemoverActive
              ? 'bg-rose-950/60 border-rose-700/80 text-rose-300 shadow-rose-950/30'
              : 'bg-slate-800/80 border-slate-700/60 text-slate-400 hover:text-slate-200'
          }`}
        >
          {t('player.vocalRemover')}
        </button>
        <button
          type="button"
          onClick={() => setDucking(!isDuckingActive)}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold border shadow-sm transition-all duration-150 active:scale-95 ${
            isDuckingActive
              ? 'bg-amber-950/60 border-amber-700/80 text-amber-300 shadow-amber-950/30'
              : 'bg-slate-800/80 border-slate-700/60 text-slate-400 hover:text-slate-200'
          }`}
        >
          {t('player.bgmDucking')}
        </button>
      </div>
    </div>
  );
};
