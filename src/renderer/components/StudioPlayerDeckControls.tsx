import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Play,
  Pause,
  Square,
  SkipForward,
  RotateCcw,
  Volume2,
  VolumeX,
  MicOff,
  Music2,
  AudioLines
} from 'lucide-react';
import { useKaraokeStore } from '../store/karaokeStore';
import {
  clampSpeedForEngine,
  coerceDspPitchEngine,
  type DspPitchEngine
} from '../../shared/dspPitch';
import { formatBpmTransition, formatKeyTransition } from '../../shared/musicalKeys';

export interface StudioPlayerDeckControlsProps {
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
  /** Enables MIDI mixer toggle when true; button stays visible but disabled otherwise. */
  isMidiTrack?: boolean;
  showMidiMixer?: boolean;
  onToggleMidiMixer?: () => void;
}

/**
 * Studio Desk transport + DSP row (opt-in `studio-desk` theme only).
 *
 * Layout: transport (+ always-visible MIDI toggle) on the LEFT with a small
 * gap before the Velocità / Tonalità / Volume panel on the RIGHT — all three
 * DSP controls on **one** compact row (panel height ≈ transport buttons);
 * Volume fills remaining panel width with end padding = left `px-2.5`.
 * Stage reopen lives in {@link StudioDeskShell} menu footer. Classic
 * {@link PlayerDeckControls} unchanged.
 */
export const StudioPlayerDeckControls: React.FC<StudioPlayerDeckControlsProps> = ({
  pitchRange,
  speedRange,
  dspEngine,
  onPlayPause,
  onStop,
  onRestart,
  onNext,
  isMidiTrack = false,
  showMidiMixer = false,
  onToggleMidiMixer
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
  const bpmUnit = t('player.bpm');
  const keyDisplay = keyLabel ?? t('player.keyPlaceholder');
  const bpmDisplay = bpmLabel
    ? `${bpmLabel} ${bpmUnit}`
    : t('player.bpmPlaceholder', { unit: bpmUnit });

  const transportBtn =
    'flex flex-col items-center gap-1 px-2 py-1.5 rounded-xl border text-[10px] font-semibold transition-all active:scale-95 min-w-[3.75rem]';
  const transportIdle =
    'bg-[color:var(--bg-subtle)] border-[color:var(--border-color)] text-[color:var(--text-muted)] hover:text-[color:var(--text-main)] hover:border-[color:var(--accent)]';
  const transportActive =
    'bg-[color:color-mix(in_srgb,var(--accent)_18%,transparent)] border-[color:var(--accent)] text-[color:var(--accent)]';
  const transportDisabled =
    'bg-[color:var(--bg-subtle)] border-[color:var(--border-color)] text-[color:var(--text-muted)] opacity-40 cursor-not-allowed';

  const midiEnabled = Boolean(isMidiTrack && onToggleMidiMixer);

  return (
    <div
      className="mt-2 flex flex-nowrap items-stretch gap-x-3 min-w-0"
      data-testid="studio-player-deck"
    >
      <div className="flex flex-nowrap items-center content-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onPlayPause}
          className={`${transportBtn} ${isPlaying ? transportActive : transportIdle}`}
          title={(isPlaying ? t('player.pause') : t('player.play')) + ' (Spazio)'}
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          <span>{isPlaying ? t('player.pause') : t('player.play')}</span>
        </button>
        <button
          type="button"
          onClick={onStop}
          className={`${transportBtn} ${transportIdle}`}
          title={t('player.stop') + ' (S)'}
        >
          <Square className="w-4 h-4" />
          <span>{t('player.stop')}</span>
        </button>
        <button
          type="button"
          onClick={onRestart}
          className={`${transportBtn} ${transportIdle}`}
          title={t('player.restart') + ' (R)'}
        >
          <RotateCcw className="w-4 h-4" />
          <span>{t('player.restart')}</span>
        </button>
        <button
          type="button"
          onClick={onNext}
          className={`${transportBtn} ${transportIdle}`}
          title={t('player.next') + ' (N)'}
        >
          <SkipForward className="w-4 h-4" />
          <span>{t('player.next')}</span>
        </button>
        <button
          type="button"
          onClick={() => setVocalRemover(!isVocalRemoverActive)}
          className={`${transportBtn} ${isVocalRemoverActive ? transportActive : transportIdle}`}
          title={t('player.vocalRemover') + ' (V)'}
        >
          <MicOff className="w-4 h-4" />
          <span className="max-w-[4.5rem] truncate">
            {t('studio.vocalShort', t('player.vocalRemover'))}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setDucking(!isDuckingActive)}
          className={`${transportBtn} ${isDuckingActive ? transportActive : transportIdle}`}
          title={t('player.bgmDucking') + ' (D)'}
        >
          <Music2 className="w-4 h-4" />
          <span>{t('studio.bgmShort', 'BGM')}</span>
        </button>
        {/* Always visible; disabled when current media is not .mid/.kar. */}
        <button
          type="button"
          onClick={() => {
            if (midiEnabled) onToggleMidiMixer?.();
          }}
          disabled={!midiEnabled}
          aria-disabled={!midiEnabled}
          className={`${transportBtn} ${
            !midiEnabled
              ? transportDisabled
              : showMidiMixer
                ? transportActive
                : transportIdle
          }`}
          title={
            !midiEnabled
              ? t('studio.midiMixerDisabled', 'MIDI mixer (MIDI/KAR tracks only)')
              : showMidiMixer
                ? t('studio.hideMidiMixer', 'Hide MIDI mixer')
                : t('studio.showMidiMixer', 'Show MIDI mixer')
          }
          data-testid="studio-midi-mixer-toggle"
        >
          <AudioLines className="w-4 h-4" />
          <span className="max-w-[4.5rem] truncate">
            {t('studio.midiMixerShortShow', 'MIDI')}
          </span>
        </button>
      </div>

      {/*
        Single compact row via CSS grid: Velo | Ton | Volume (1fr fills remainder).
        Panel height matches adjacent transport buttons via self-stretch.
        Parent `gap-x-3` separates last transport (MIDI) from this panel.
      */}
      <div
        className="grid grid-cols-[auto_auto_minmax(7rem,1fr)] items-center self-stretch gap-x-3 px-2.5 py-1.5 rounded-xl border border-[color:var(--border-color)] bg-[color:var(--bg-subtle)] flex-1 min-w-0"
        data-testid="studio-dsp-panel"
      >
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex flex-col items-center justify-center min-w-[3.6rem] shrink-0">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)] text-center leading-tight">
              {t('player.speed')}
            </span>
            <span
              className={`font-mono text-[11px] font-medium leading-tight text-center normal-case ${bpmLabel ? 'text-[color:var(--accent)] font-semibold' : 'text-[color:var(--text-muted)]'}`}
              data-testid="regia-bpm-label"
              data-has-bpm={bpmLabel ? 'true' : 'false'}
            >
              {bpmDisplay}
            </span>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-[color:var(--border-color)] bg-[color:var(--bg-card)] px-1 py-0.5">
            <button
              type="button"
              onClick={() =>
                setPlaybackSpeed(clampSpeedForEngine(playbackSpeed - speedRange.step, engine))
              }
              disabled={playbackSpeed <= speedRange.min + 1e-6}
              className="w-6 h-6 rounded-md bg-[color:var(--bg-subtle)] hover:bg-[color:var(--accent)] hover:text-[#0A0B10] disabled:opacity-40 text-xs font-bold"
              title={`−${speedRange.step.toFixed(2)}x`}
            >
              −
            </button>
            <button
              type="button"
              onClick={() => setPlaybackSpeed(1.0)}
              className="font-mono font-bold text-xs min-w-[3rem] text-center text-[color:var(--accent)]"
              title="1.00x"
            >
              {playbackSpeed.toFixed(2)}x
            </button>
            <button
              type="button"
              onClick={() =>
                setPlaybackSpeed(clampSpeedForEngine(playbackSpeed + speedRange.step, engine))
              }
              disabled={playbackSpeed >= speedRange.max - 1e-6}
              className="w-6 h-6 rounded-md bg-[color:var(--bg-subtle)] hover:bg-[color:var(--accent)] hover:text-[#0A0B10] disabled:opacity-40 text-xs font-bold"
              title={`+${speedRange.step.toFixed(2)}x`}
            >
              +
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex flex-col items-center justify-center min-w-[3.6rem] shrink-0">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)] text-center leading-tight">
              {t('player.pitch')}
            </span>
            <span
              className={`font-mono text-[11px] font-medium leading-tight text-center normal-case ${keyLabel ? 'text-[color:var(--accent)] font-semibold' : 'text-[color:var(--text-muted)]'}`}
              data-testid="regia-key-label"
              data-has-key={keyLabel ? 'true' : 'false'}
            >
              {keyDisplay}
            </span>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-[color:var(--border-color)] bg-[color:var(--bg-card)] px-1 py-0.5">
            <button
              type="button"
              onClick={() => setLivePitch(livePitchOffset - 1)}
              disabled={livePitchOffset <= pitchRange.min}
              className="w-6 h-6 rounded-md bg-[color:var(--bg-subtle)] hover:bg-[color:var(--accent)] hover:text-[#0A0B10] disabled:opacity-40 text-xs font-bold"
              title="-1 ST"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => setLivePitch(0)}
              className="font-mono font-bold text-xs min-w-[3.5rem] px-1 text-center text-[color:var(--text-main)]"
              title="0 ST"
              data-testid="studio-pitch-field"
            >
              {livePitchOffset > 0 ? `+${livePitchOffset}` : livePitchOffset}
              <span className="ml-1 text-[color:var(--accent)] pointer-events-none">ST</span>
            </button>
            <button
              type="button"
              onClick={() => setLivePitch(livePitchOffset + 1)}
              disabled={livePitchOffset >= pitchRange.max}
              className="w-6 h-6 rounded-md bg-[color:var(--bg-subtle)] hover:bg-[color:var(--accent)] hover:text-[#0A0B10] disabled:opacity-40 text-xs font-bold"
              title="+1 ST"
            >
              +
            </button>
          </div>
        </div>

        <div
          className="flex flex-nowrap items-center min-w-0"
          data-testid="studio-volume-row"
        >
          <div className="flex flex-nowrap items-center gap-1.5 rounded-lg border border-[color:var(--border-color)] bg-[color:var(--bg-card)] px-1.5 py-0.5 flex-1 min-w-0">
            <button
              type="button"
              onClick={() => setPlaybackState({ isMuted: !isMuted })}
              className="text-[color:var(--text-muted)] hover:text-[color:var(--text-main)] shrink-0"
              title={t('player.mute')}
            >
              {isMuted ? (
                <VolumeX className="w-4 h-4 text-rose-400" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : masterVolume}
              onChange={(e) =>
                setPlaybackState({ masterVolume: parseFloat(e.target.value), isMuted: false })
              }
              className="w-full min-w-0 h-1.5 accent-[color:var(--accent)] cursor-pointer"
              data-testid="studio-volume-slider"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
