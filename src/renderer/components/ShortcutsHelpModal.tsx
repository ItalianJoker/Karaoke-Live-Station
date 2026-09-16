import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, X, Search, Play, Volume2, Monitor } from 'lucide-react';
import { APP_SHORTCUTS } from '../data/appShortcuts';
import { textMatchesSearch } from '../../shared/textNormalize';

interface ShortcutsHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShortcutsHelpModal: React.FC<ShortcutsHelpModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const [filterQuery, setFilterQuery] = useState('');

  // Shared inventory — must stay aligned with ControlWindow / StageWindow handlers.
  const shortcutsList = useMemo(
    () =>
      APP_SHORTCUTS.map((s) => ({
        keys: s.keys,
        descriptionKey: s.descriptionKey,
        category: s.category
      })),
    []
  );

  const filteredShortcuts = useMemo(() => {
    if (!filterQuery.trim()) return shortcutsList;
    const q = filterQuery.trim();
    return shortcutsList.filter((item) => {
      const desc = t(item.descriptionKey);
      const keys = item.keys.join(' ');
      return textMatchesSearch(desc, q) || textMatchesSearch(keys, q);
    });
  }, [filterQuery, shortcutsList, t]);

  if (!isOpen) return null;

  const categories = [
    {
      id: 'playback',
      label: t('shortcuts.categoryPlayback'),
      icon: <Play className="w-4 h-4 text-emerald-400" />
    },
    {
      id: 'audio',
      label: t('shortcuts.categoryAudio'),
      icon: <Volume2 className="w-4 h-4 text-indigo-400" />
    },
    {
      id: 'navigation',
      label: t('shortcuts.categoryNavigation'),
      icon: <Monitor className="w-4 h-4 text-amber-400" />
    }
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl max-h-[85vh] shadow-2xl flex flex-col overflow-hidden text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
              <Keyboard className="w-6 h-6" />
            </div>
            <div>
              <h2 id="shortcuts-modal-title" className="text-lg font-bold text-white tracking-wide">
                {t('shortcuts.title')}
              </h2>
              <p className="text-xs text-slate-400">{t('shortcuts.subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="px-5 pt-4 pb-2 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder={t('shortcuts.searchPlaceholder')}
              className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-all"
              autoFocus
            />
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {categories.map((cat) => {
            const items = filteredShortcuts.filter((s) => s.category === cat.id);
            if (items.length === 0) return null;

            return (
              <div key={cat.id} className="space-y-2.5">
                <div className="flex items-center gap-2 pb-1.5 border-b border-slate-800/60">
                  {cat.icon}
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">{cat.label}</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {items.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2.5 bg-slate-950/60 rounded-xl border border-slate-800/80 hover:border-slate-700 transition-colors"
                    >
                      <span className="text-xs text-slate-300 font-medium pr-2">
                        {t(item.descriptionKey)}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        {item.keys.map((k, kIdx) => (
                          <kbd
                            key={kIdx}
                            className="px-2 py-1 text-[11px] font-mono font-bold text-indigo-300 bg-slate-800 border border-slate-700 rounded-md shadow-sm"
                          >
                            {k}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {filteredShortcuts.length === 0 && (
            <div className="text-center py-8 text-xs text-slate-500">
              {t('library.noResults')}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 shrink-0 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition-all"
          >
            {t('shortcuts.close')}
          </button>
        </div>
      </div>
    </div>
  );
};

