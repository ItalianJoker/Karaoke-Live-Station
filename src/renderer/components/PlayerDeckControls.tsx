import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Play,
  Pause,
  Square,
  SkipForward,
  RotateCcw,
  Volume2,
  VolumeX,
  Monitor,
  Sliders,
  Music
} from 'lucide-react';
import { useKaraokeStore } from '../store/karaokeStore';
import {
  clampSpeedForEngine,
  coerceDspPitchEngine,
  type DspPitchEngine
} from '../../shared/dspPitch';
import { formatBpmTransition, formatKeyTransition } from '../../shared/musicalKeys';
import { MidiChannelMixer } from './MidiChannelMixer';

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
  /** Stage window open LED — reopen control is the first Studio deck item (not on the rail). */
  stageOpen: boolean;
  onReopenStage: () => void;
  /** When true, deck exposes a Controls ↔ MIDI mixer tab switch. */
  isMidiTrack: boolean;
  onToggleMuteChannel: (channelIndex: number) => void;
}

type StudioDeckTab = 'controls' | 'midi';

/**
 * Studio deck: Stage reopen + transport/DSP (+ MIDI mixer tab when .mid/.kar).
 *
 * **Audience (humans):** Floating Material-style control bar under the Regia preview.
 *
 * **Audience (AI):** Pitch/speed keep − / + and click-to-reset numeric values (no sliders).
 * Volume range input is intentional and unrelated to pitch/speed. Key/BPM (#54/#74) always
 * visible. Vocal remover + BGM ducking stay on this deck. Stage reopen lives here — not
 * on the icon rail. MIDI 16-ch mixer is a deck tab, not a Library mode.
 */
export const PlayerDeckControls: React.FC<PlayerDeckControlsProps> = ({
  pitchRange,
  speedRange,
  dspEngine,
  onPlayPause,
  onStop,
  onRestart,
  onNext,
  stageOpen,
  onReopenStage,
  isMidiTrack,
  onToggleMuteChannel
}) => {
  const { t } = useTranslation();
  const [deckTab, setDeckTab] = useState<StudioDeckTab>('controls');

  useEffect(() => {
    // Leave MIDI tab when the current track is no longer MIDI/KAR.
    if (!isMidiTrack && deckTab === 'midi') setDeckTab('controls');
  }, [isMidiTrack, deckTab]);

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
  const bpmUnit = t('player.bpm');
  const keyDisplay = keyLabel ?? t('player.keyPlaceholder');
  const bpmDisplay = bpmLabel
    ? `${bpmLabel} ${bpmUnit}`
    : t('player.bpmPlaceholder', { unit: bpmUnit });

  return (
    <div className="mt-4 space-y-2.5" data-testid="studio-deck">
      {/* First Studio deck item: Stage open / reopen (removed from icon rail) */}
      <button
        type="button"
        onClick={onReopenStage}
        data-testid="studio-deck-stage"
        className={`w-full px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 border shadow-sm transition-all duration-200 active:scale-[0.99] ${
          stageOpen
            ? 'bg-emerald-950/40 border-emerald-800/70 text-emerald-400 hover:bg-emerald-900/50'
            : 'bg-red-950/40 border-red-800/70 text-red-400 animate-pulse hover:bg-red-900/50'
        }`}
        title={stageOpen ? t('app.stageWindow') : t('app.reopenStage')}
      >
        <span className={`w-2 h-2 rounded-full ${stageOpen ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50' : 'bg-red-400'}`} />
        <Monitor className="w-4 h-4 shrink-0" />
        {stageOpen ? t('app.stageWindow') : t('app.reopenStage')}
      </button>

      {isMidiTrack && (
        <div
          className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-full border border-slate-800/80 text-[11px] font-semibold shadow-inner"
          role="tablist"
          aria-label={t('regia.deckTabsAria')}
        >
          <button
            type="button"
            role="tab"
            aria-selected={deckTab === 'controls'}
            onClick={() => setDeckTab('controls')}
            className={`flex-1 py-1.5 rounded-full flex items-center justify-center gap-1.5 transition-all active:scale-95 ${
              deckTab === 'controls'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            {t('regia.deckTabControls')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={deckTab === 'midi'}
            onClick={() => setDeckTab('midi')}
            data-testid="studio-deck-midi-tab"
            className={`flex-1 py-1.5 rounded-full flex items-center justify-center gap-1.5 transition-all active:scale-95 ${
              deckTab === 'midi'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Music className="w-3.5 h-3.5" />
            {t('regia.deckTabMidi')}
          </button>
        </div>
      )}

      {(!isMidiTrack || deckTab === 'controls') && (
        <div className="p-3.5 bg-slate-950/60 border border-slate-800/80 rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-inner">
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
              aria-label={t('player.restart')}
              data-testid="studio-deck-restart"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onNext}
              className="w-9 h-9 bg-slate-800/90 hover:bg-slate-700/90 rounded-full text-slate-300 border border-slate-700/60 shadow-sm flex items-center justify-center transition-all active:scale-95 shrink-0"
              title={t('player.next') + ' (N)'}
              aria-label={t('player.next')}
              data-testid="studio-deck-next"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          </div>

          {/* Pitch: − / value (click reset) / + — no sliders */}
          <div className="flex items-center gap-1.5 bg-slate-800/90 px-3 py-1.5 rounded-full border border-slate-700/70 shadow-sm shrink-0">
            <span className="text-[11px] font-semibold text-slate-300 shrink-0" title="Tonalità in semitoni">
              {t('player.pitch')}:
              <span
                className={`ml-1 font-mono font-bold ${keyLabel ? 'text-indigo-300/90' : 'text-slate-500'}`}
                data-testid="regia-key-label"
                data-has-key={keyLabel ? 'true' : 'false'}
              >
                {keyDisplay}
              </span>
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

          {/* Speed: − / value (click reset) / + — no sliders */}
          <div className="flex items-center gap-1.5 bg-slate-800/90 px-3 py-1.5 rounded-full border border-slate-700/70 shadow-sm shrink-0">
            <span className="text-[11px] font-semibold text-slate-300 shrink-0">
              {t('player.speed')}:
              <span
                className={`ml-1 font-mono font-bold ${bpmLabel ? 'text-emerald-300/90' : 'text-slate-500'}`}
                data-testid="regia-bpm-label"
                data-has-bpm={bpmLabel ? 'true' : 'false'}
              >
                {bpmDisplay}
              </span>
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

          {/* DSP Toggles: Vocal Remover & Ducking — stay in the player */}
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
      )}

      {isMidiTrack && deckTab === 'midi' && (
        <MidiChannelMixer onToggleMuteChannel={onToggleMuteChannel} />
      )}
    </div>
  );
};
