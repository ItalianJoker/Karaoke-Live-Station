import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Music2 } from 'lucide-react';
import type { KaraokeMediaTrack } from '../../shared/types';

export type InstrumentalSubtitlesChoice = 'with-subs' | 'without-subs' | 'cancel';

interface InstrumentalSubtitlesModalProps {
  isOpen: boolean;
  track: KaraokeMediaTrack | null;
  onClose: () => void;
  /**
   * Called when the operator picks an action.
   * `remember` true → persist policy as always (with-subs) or never (without-subs).
   */
  onConfirm: (choice: Exclude<InstrumentalSubtitlesChoice, 'cancel'>, remember: boolean) => void;
}

/**
 * InstrumentalSubtitlesModal
 *
 * Shown before Download Instrumental starts (when policy is `ask`).
 * Operator chooses whether yt-dlp should fetch YouTube auto-subs for lyric burn-in.
 * Amber warning: YT captions are often ASR/auto and imperfect.
 * Esc / backdrop click / Annulla = no download.
 */
export const InstrumentalSubtitlesModal: React.FC<InstrumentalSubtitlesModalProps> = ({
  isOpen,
  track,
  onClose,
  onConfirm
}) => {
  const { t } = useTranslation();
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setRemember(false);
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !track) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      data-testid="instrumental-subtitles-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="instrumental-subtitles-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl p-5 space-y-4 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-emerald-950/50 border border-emerald-500/40 text-emerald-300 shrink-0">
            <Music2 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3
              id="instrumental-subtitles-modal-title"
              className="font-bold text-base text-white"
            >
              {t('library.instrumentalSubtitlesTitle')}
            </h3>
            <p className="text-slate-300 text-xs mt-1 truncate" title={`${track.title} — ${track.artist}`}>
              <span className="text-white font-medium">{track.title}</span>
              {track.artist ? (
                <span className="text-slate-400"> — {track.artist}</span>
              ) : null}
            </p>
          </div>
        </div>

        <p className="text-slate-300 text-sm leading-relaxed">
          {t('library.instrumentalSubtitlesAsk')}
        </p>

        <div
          className="flex items-start gap-2 rounded-xl border border-amber-500/50 bg-amber-950/40 px-3 py-2.5 text-amber-100"
          data-testid="instrumental-subtitles-warning"
          role="note"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
          <p className="text-xs leading-relaxed text-amber-100/95">
            {t('library.instrumentalSubtitlesWarning')}
          </p>
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500/40"
            data-testid="instrumental-subtitles-remember"
          />
          {t('library.instrumentalSubtitlesRemember')}
        </label>

        <div className="flex flex-col sm:flex-row sm:flex-wrap justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-full text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 transition-all order-3 sm:order-1"
            data-testid="instrumental-subtitles-cancel"
          >
            {t('library.instrumentalSubtitlesCancel')}
          </button>
          <button
            type="button"
            onClick={() => onConfirm('without-subs', remember)}
            className="px-4 py-2 rounded-full text-xs font-semibold text-slate-200 bg-slate-700 hover:bg-slate-600 border border-slate-600 transition-all order-2"
            data-testid="instrumental-subtitles-without"
          >
            {t('library.instrumentalSubtitlesWithout')}
          </button>
          <button
            type="button"
            onClick={() => onConfirm('with-subs', remember)}
            className="px-4 py-2 rounded-full text-xs font-semibold text-emerald-50 bg-emerald-700 hover:bg-emerald-600 border border-emerald-500/60 transition-all order-1 sm:order-3"
            data-testid="instrumental-subtitles-with"
          >
            {t('library.instrumentalSubtitlesWith')}
          </button>
        </div>
      </div>
    </div>
  );
};
