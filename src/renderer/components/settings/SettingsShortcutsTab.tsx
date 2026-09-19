import React from 'react';
import { Keyboard } from 'lucide-react';
import type { SettingsShortcutsTabProps } from './settingsTypes';

/**
 * Shortcuts reference tab: live Control Window key bindings from APP_SHORTCUTS.
 *
 * **Audience (humans):** Quick lookup of Regia keyboard shortcuts.
 *
 * **Audience (AI):** Rows are computed in SettingsModal (`liveShortcuts` /
 * `matchingShortcuts`). Keep inventory in sync with `appShortcuts.ts` / help modal.
 */
export const SettingsShortcutsTab: React.FC<SettingsShortcutsTabProps> = ({
  t,
  isSearching,
  liveShortcuts,
  matchingShortcuts,
}) => {
  return (
              <div className="space-y-3">
                <h3 className="font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Keyboard className="w-4 h-4 text-indigo-400" />
                  {t('settings.tabShortcuts', 'Scorciatoie')}
                </h3>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {t('shortcuts.subtitle', 'Riferimento rapido alle scorciatoie live della Control Window')}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {(isSearching ? matchingShortcuts : liveShortcuts).map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2.5 bg-slate-950/60 rounded-xl border border-slate-800/80"
                    >
                      <span className="text-xs text-slate-300 font-medium pr-2">{item.label}</span>
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
};
