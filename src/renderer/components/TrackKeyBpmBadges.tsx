import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatBpmTransition, formatKeyTransition } from '../../shared/musicalKeys';

export type TrackKeyBpmBadgesProps = {
  /** Catalog / MIDI key (e.g. "Am"). Missing → placeholder chip. */
  initialKey?: string | null;
  /** Catalog / MIDI BPM. Missing → placeholder chip with BPM unit. */
  initialBpm?: number | null;
  /** Live or per-queue pitch offset (semitones) for `base→result` when ≠ 0. */
  pitchOffset?: number;
  /** Live playback speed for effective BPM when ≠ 1. */
  speed?: number;
  /** Visual density — list rows use `sm`, Regia/Stage can use `md`. */
  size?: 'sm' | 'md';
  /** Extra class on the outer flex wrapper. */
  className?: string;
};

/**
 * Always-visible Key + BPM chips for library / queue / Regia / Stage.
 *
 * **Why always render:** conditional `{keyLabel && …}` hid metadata on tracks
 * still awaiting analysis (or without analyzable audio), which looked like a
 * layout bug. Placeholders keep row height and scanability consistent.
 *
 * Pure display — does not trigger analysis or mutate catalog state.
 */
export const TrackKeyBpmBadges: React.FC<TrackKeyBpmBadgesProps> = ({
  initialKey,
  initialBpm,
  pitchOffset = 0,
  speed = 1,
  size = 'sm',
  className = ''
}) => {
  const { t } = useTranslation();

  const keyLabel = formatKeyTransition(initialKey, pitchOffset);
  const bpmLabel = formatBpmTransition(initialBpm, speed);
  const bpmUnit = t('player.bpm');

  const keyText = keyLabel ?? t('player.keyPlaceholder');
  const bpmText = bpmLabel
    ? `${bpmLabel} ${bpmUnit}`
    : t('player.bpmPlaceholder', { unit: bpmUnit });

  const pad = size === 'md' ? 'px-2 py-0.5 text-[11px]' : 'px-1.5 py-0.5 text-[9px]';
  const baseChip =
    `${pad} font-mono font-bold rounded-full border shrink-0 tabular-nums ` +
    'whitespace-nowrap';

  return (
    <span
      className={`inline-flex items-center gap-1 shrink-0 ${className}`.trim()}
      data-testid="track-key-bpm-badges"
    >
      <span
        className={`${baseChip} bg-indigo-950/50 text-indigo-300/90 border-indigo-800/50`}
        title={t('player.pitch')}
        data-testid="track-key-badge"
        data-has-key={keyLabel ? 'true' : 'false'}
      >
        {keyText}
      </span>
      <span
        className={`${baseChip} bg-emerald-950/50 text-emerald-300/90 border-emerald-800/50`}
        title={t('player.speed')}
        data-testid="track-bpm-badge"
        data-has-bpm={bpmLabel ? 'true' : 'false'}
      >
        {bpmText}
      </span>
    </span>
  );
};
