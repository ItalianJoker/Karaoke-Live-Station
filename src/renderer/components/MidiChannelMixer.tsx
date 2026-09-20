import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2, VolumeX, Music } from 'lucide-react';
import { useKaraokeStore } from '../store/karaokeStore';

interface MidiChannelMixerProps {
  onToggleMuteChannel: (channelIndex: number) => void;
  /**
   * Studio Desk MIDI column: SoundFont on its own line under the header;
   * fill height so Mute/Solo tiles are not crushed. Classic Regia omits this.
   */
  studioColumn?: boolean;
  /**
   * Studio only: poll live per-channel activity (0–1) from AudioGraphManager
   * note-on velocity peaks. Classic Regia does not pass this.
   */
  getChannelActivity?: () => Float32Array | null;
}

/**
 * MidiChannelMixer
 *
 * Dedicated 16-channel mixer for Standard MIDI (.mid) and Karaoke MIDI (.kar) files.
 * Key features:
 * - Channel-specific muting (e.g. silencing guide melody on Ch 4 to let the human singer take over).
 * - Automatic semantic labels for common General MIDI channels (Melody on Ch 4, Bass on Ch 2, Drums on Ch 10).
 * - SoundFont status display showing the active SoundFont filename or default system soundfont.
 * - Studio Desk: compact per-channel activity bar from note-on velocity (not true audio VU).
 */
export const MidiChannelMixer: React.FC<MidiChannelMixerProps> = ({
  onToggleMuteChannel,
  studioColumn = false,
  getChannelActivity
}) => {
  const { t } = useTranslation();
  const mutedMidiChannels = useKaraokeStore((state) => state.playback.mutedMidiChannels);
  const soundFontPath = useKaraokeStore((state) => state.settings.midiSoundFontPath);
  const [activityLevels, setActivityLevels] = useState<number[]>(() => Array(16).fill(0));
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!studioColumn || !getChannelActivity) {
      setActivityLevels(Array(16).fill(0));
      return;
    }
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const levels = getChannelActivity();
      if (levels && levels.length >= 16) {
        const next = Array.from({ length: 16 }, (_, i) => levels[i] || 0);
        setActivityLevels((prev) => {
          // Avoid re-render when silent.
          let changed = false;
          for (let i = 0; i < 16; i++) {
            if (Math.abs(prev[i] - next[i]) > 0.02) {
              changed = true;
              break;
            }
          }
          return changed ? next : prev;
        });
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      alive = false;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [studioColumn, getChannelActivity]);

  const getChannelLabel = (channelIndex: number): string => {
    switch (channelIndex) {
      case 3:
        return t('midi.melodyTrack'); // Ch 4 (0-indexed: 3)
      case 1:
        return t('midi.bassTrack'); // Ch 2 (0-indexed: 1)
      case 9:
        return t('midi.drumsTrack'); // Ch 10 (0-indexed: 9)
      default:
        return t('midi.channel', { num: channelIndex + 1 });
    }
  };

  const soundFontLabel = soundFontPath
    ? t('midi.soundfontLoaded', { path: soundFontPath.split(/[\\/]/).pop() })
    : t('midi.noSoundfontSelected');

  const channelGrid = (
    <div
      className={
        studioColumn
          ? 'grid grid-cols-2 gap-2 content-start flex-1 min-h-0 overflow-y-auto pr-1'
          : 'grid grid-cols-4 sm:grid-cols-8 gap-2'
      }
    >
      {Array.from({ length: 16 }).map((_, index) => {
        const isMuted = mutedMidiChannels.includes(index);
        const isLead = index === 3;
        const isDrum = index === 9;
        const activity = studioColumn ? activityLevels[index] || 0 : 0;
        const activityPct = Math.round(Math.min(1, Math.max(0, activity)) * 100);

        return (
          <button
            key={index}
            type="button"
            onClick={() => onToggleMuteChannel(index)}
            title={
              isMuted
                ? t('midi.unmuteChannel', { num: index + 1 })
                : t('midi.muteChannel', { num: index + 1 })
            }
            className={`flex flex-col items-center justify-center p-2 rounded-2xl border transition-all text-xs select-none active:scale-95 ${
              studioColumn ? 'min-h-[4.75rem]' : ''
            } ${
              isMuted
                ? 'bg-red-950/40 border-red-800/60 text-red-400 hover:bg-red-900/50 shadow-sm'
                : isLead
                  ? 'bg-indigo-950/40 border-indigo-500/70 text-indigo-300 hover:bg-indigo-900/50 shadow-sm'
                  : isDrum
                    ? 'bg-amber-950/30 border-amber-500/70 text-amber-300 hover:bg-amber-900/40 shadow-sm'
                    : 'bg-slate-800/80 border-slate-700/60 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <div className="mb-1">
              {isMuted ? (
                <VolumeX className="w-4 h-4 text-red-400" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </div>
            <span className="font-semibold text-[11px]">Ch {index + 1}</span>
            <span className="text-[9px] truncate max-w-[65px] opacity-80 mt-0.5 font-medium">
              {getChannelLabel(index)}
            </span>
            {studioColumn && (
              <div
                className="w-full mt-1.5 h-1 rounded-full bg-slate-950/80 overflow-hidden border border-slate-700/50"
                data-testid={`midi-channel-activity-${index}`}
                aria-label={t('midi.channelActivity', {
                  num: index + 1,
                  defaultValue: `Channel ${index + 1} activity`
                })}
                aria-valuenow={activityPct}
                aria-valuemin={0}
                aria-valuemax={100}
                role="meter"
              >
                <div
                  className={`h-full rounded-full transition-[width] duration-75 ${
                    isMuted
                      ? 'bg-red-500/40'
                      : activity > 0.55
                        ? 'bg-[color:var(--accent,#00D4F0)]'
                        : 'bg-emerald-400/80'
                  }`}
                  style={{ width: `${isMuted ? 0 : activityPct}%` }}
                />
              </div>
            )}
            <span
              className={`text-[8px] font-bold mt-1 px-2 py-0.5 rounded-full ${
                isMuted ? 'bg-red-500/20 text-red-300' : 'bg-emerald-500/20 text-emerald-300'
              }`}
            >
              {isMuted ? 'MUTE' : 'ON'}
            </span>
          </button>
        );
      })}
    </div>
  );

  if (studioColumn) {
    return (
      <div
        className="flex flex-col h-full min-h-0 p-3 text-slate-100"
        data-testid="midi-mixer-studio-column"
      >
        <div className="flex items-center gap-2 pb-2 shrink-0">
          <div className="w-8 h-8 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Music className="w-4 h-4" />
          </div>
          <h3 className="font-bold text-sm tracking-wide">{t('midi.title')}</h3>
        </div>
        {/* SoundFont on its own line under the header (Studio Desk column IA). */}
        <div
          className="text-[11px] text-slate-400 font-mono truncate border-b border-slate-800 pb-2 mb-3 shrink-0"
          title={soundFontLabel}
        >
          {soundFontLabel}
        </div>
        {channelGrid}
      </div>
    );
  }

  return (
    <div className="bg-slate-900/90 border border-slate-800/80 rounded-3xl p-4 shadow-xl backdrop-blur-sm text-slate-100">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Music className="w-4 h-4" />
          </div>
          <h3 className="font-bold text-sm tracking-wide">{t('midi.title')}</h3>
        </div>
        <span className="text-xs text-slate-400 font-mono">{soundFontLabel}</span>
      </div>
      {channelGrid}
    </div>
  );
};
