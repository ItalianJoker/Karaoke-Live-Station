import React from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2, VolumeX, Music } from 'lucide-react';
import { useKaraokeStore } from '../store/karaokeStore';

interface MidiChannelMixerProps {
  onToggleMuteChannel: (channelIndex: number) => void;
}

/**
 * MidiChannelMixer
 *
 * Dedicated 16-channel mixer for Standard MIDI (.mid) and Karaoke MIDI (.kar) files.
 * Key features:
 * - Channel-specific muting (e.g. silencing guide melody on Ch 4 to let the human singer take over).
 * - Automatic semantic labels for common General MIDI channels (Melody on Ch 4, Bass on Ch 2, Drums on Ch 10).
 * - SoundFont status display showing the active SoundFont filename or default system soundfont.
 */
export const MidiChannelMixer: React.FC<MidiChannelMixerProps> = ({ onToggleMuteChannel }) => {
  const { t } = useTranslation();
  const mutedMidiChannels = useKaraokeStore((state) => state.playback.mutedMidiChannels);
  const soundFontPath = useKaraokeStore((state) => state.settings.midiSoundFontPath);

  const getChannelLabel = (channelIndex: number): string => {
    switch (channelIndex) {
      case 3:
        return t('midi.melodyTrack'); // Ch 4 (0-indexed: 3)
      case 1:
        return t('midi.bassTrack');   // Ch 2 (0-indexed: 1)
      case 9:
        return t('midi.drumsTrack');  // Ch 10 (0-indexed: 9)
      default:
        return t('midi.channel', { num: channelIndex + 1 });
    }
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800/80 rounded-3xl p-4 shadow-xl backdrop-blur-sm text-slate-100">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Music className="w-4 h-4" />
          </div>
          <h3 className="font-bold text-sm tracking-wide">{t('midi.title')}</h3>
        </div>
        <span className="text-xs text-slate-400 font-mono">
          {soundFontPath ? t('midi.soundfontLoaded', { path: soundFontPath.split(/[\\/]/).pop() }) : t('midi.noSoundfontSelected')}
        </span>
      </div>

      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        {Array.from({ length: 16 }).map((_, index) => {
          const isMuted = mutedMidiChannels.includes(index);
          const isLead = index === 3;
          const isDrum = index === 9;

          return (
            <button
              key={index}
              type="button"
              onClick={() => onToggleMuteChannel(index)}
              title={isMuted ? t('midi.unmuteChannel', { num: index + 1 }) : t('midi.muteChannel', { num: index + 1 })}
              className={`flex flex-col items-center justify-center p-2 rounded-2xl border transition-all text-xs select-none active:scale-95 ${
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
                {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
              </div>
              <span className="font-semibold text-[11px]">Ch {index + 1}</span>
              <span className="text-[9px] truncate max-w-[65px] opacity-80 mt-0.5 font-medium">
                {getChannelLabel(index)}
              </span>
              <span className={`text-[8px] font-bold mt-1 px-2 py-0.5 rounded-full ${isMuted ? 'bg-red-500/20 text-red-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                {isMuted ? 'MUTE' : 'ON'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
