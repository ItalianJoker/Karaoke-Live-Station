import {
  Settings,
  Globe,
  ShieldCheck,
  Download,
  Terminal,
  FolderOpen,
  FileText,
  Trash2,
  RefreshCw,
  Sparkles,
  ExternalLink,
  CheckCircle2,
} from 'lucide-react';
import { useKaraokeStore } from '../../store/karaokeStore';
import { FirewallGuideCard } from '../FirewallGuideCard';
import { THEME_OPTIONS, type SettingsGeneralTabProps } from './settingsTypes';

/**
 * General settings tab: themes, language, maximize-on-launch, fair queue, guest portal, SIAE, logs.
 *
 * **Audience (humans):** Look-and-feel, LAN guest portal, SIAE export, and diagnostic logs.
 *
 * **Audience (AI):** JSX moved verbatim from SettingsModal. Keep `updateSettings` keys and
 * `karaokeApi` logger / SIAE IPC call sites unchanged. Match flags stay parent-owned.
 */
export const SettingsGeneralTab: React.FC<SettingsGeneralTabProps> = ({
  t,
  i18n,
  settings,
  updateSettings,
  isSearching,
  matchThemeLang,
  matchMaximize,
  matchFairQueue,
  matchGuestPortal,
  matchSiae,
  matchLogs,
  matchUpdates,
  portalInfo,
  logFilePath,
  handleExportSiae,
  handleOpenLogFolder,
  handleOpenLogFile,
  handleClearLogs,
}) => {
  const appUpdateInfo = useKaraokeStore((s) => s.appUpdateInfo);
  const isCheckingAppUpdate = useKaraokeStore((s) => s.isCheckingAppUpdate);
  const setAppUpdateInfo = useKaraokeStore((s) => s.setAppUpdateInfo);
  const setIsCheckingAppUpdate = useKaraokeStore((s) => s.setIsCheckingAppUpdate);
  const setShowUpdateModal = useKaraokeStore((s) => s.setShowUpdateModal);

  const handleManualCheckUpdates = async () => {
    if (!window.karaokeApi?.system?.checkForAppUpdates || isCheckingAppUpdate) return;
    setIsCheckingAppUpdate(true);
    try {
      const info = await window.karaokeApi.system.checkForAppUpdates(true);
      setAppUpdateInfo(info);
      if (info.hasUpdate) {
        setShowUpdateModal(true);
      }
    } catch (err) {
      console.error('Check update failed:', err);
    } finally {
      setIsCheckingAppUpdate(false);
    }
  };
  return (
              <div className="space-y-4">
                {isSearching && (
                  <h3 className="font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Settings className="w-4 h-4 text-indigo-400" />
                    {t('settings.tabGeneral', 'Generale')}
                  </h3>
                )}


                {/* Themes & Localization */}
                {(!isSearching || matchThemeLang) && (
                  <div className="space-y-3">
                    <h3 className="font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                      <Globe className="w-4 h-4 text-indigo-400" /> {t('settings.theme')} & {t('settings.language')}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-slate-400 mb-1">{t('settings.theme')}</label>
                        <select
                          value={settings.themeHost}
                          onChange={(e) => {
                            const next = e.target.value as typeof settings.themeHost;
                            if (next === settings.themeHost) return;
                            // Persist first, then clean relaunch so Studio ↔ classic shell swaps reliably.
                            updateSettings({ themeHost: next });
                            window.setTimeout(() => {
                              void window.karaokeApi?.system?.relaunchApp?.();
                            }, 300);
                          }}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                        >
                          {THEME_OPTIONS.map((th) => (
                            <option key={th.id} value={th.id}>
                              {t(`settings.themeOptions.${th.id}`, { defaultValue: th.label })}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1.5 text-[10px] text-slate-500 leading-snug">
                          {t(
                            'settings.themeRestartNote',
                            'Changing the Control Room theme restarts the app so the layout applies cleanly.'
                          )}
                        </p>
                      </div>

                      <div>
                        <label className="block text-slate-400 mb-1">{t('settings.stageTheme')}</label>
                        <select
                          value={settings.themeStage}
                          onChange={(e) => updateSettings({ themeStage: e.target.value as any })}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                        >
                          {THEME_OPTIONS.map((th) => (
                            <option key={th.id} value={th.id}>
                              {t(`settings.themeOptions.${th.id}`, { defaultValue: th.label })}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-slate-400 mb-1">{t('settings.language')}</label>
                        <select
                          value={settings.language}
                          onChange={(e) => {
                            const lang = e.target.value as any;
                            updateSettings({ language: lang });
                            i18n.changeLanguage(lang === 'autodetect' ? 'it' : lang);
                          }}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                        >
                          <option value="autodetect">Auto Detect</option>
                          <option value="it">Italiano (IT)</option>
                          <option value="en">English (EN)</option>
                          <option value="es">Español (ES)</option>
                          <option value="fr">Français (FR)</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {(!isSearching || matchMaximize) && (
                  <label className="flex items-start gap-3 cursor-pointer bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800/80">
                    <input
                      type="checkbox"
                      checked={settings.autoMaximizeControlOnLaunch ?? true}
                      onChange={(e) => updateSettings({ autoMaximizeControlOnLaunch: e.target.checked })}
                      className="w-4 h-4 accent-indigo-600 rounded mt-0.5"
                    />
                    <div>
                      <span className="font-semibold text-white text-xs block">
                        {t('settings.autoMaximizeControl', 'Massimizza Regia all\'avvio')}
                      </span>
                      <span className="text-[11px] text-slate-400 leading-relaxed block mt-0.5">
                        {t(
                          'settings.autoMaximizeControlDesc',
                          'Apre la finestra di controllo massimizzata all\'avvio dell\'app'
                        )}
                      </span>
                    </div>
                  </label>
                )}

                {/* Fair Queue, Guest Portal, SIAE */}
                {(
                  !isSearching ||
                  matchFairQueue ||
                  matchGuestPortal ||
                  matchSiae
                ) && (
                  <div className="space-y-3">
                    {(!isSearching || matchFairQueue || matchGuestPortal || matchSiae) && (
                      <h3 className="font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-rose-400" /> {t('settings.title')}
                      </h3>
                    )}
                    <div className="space-y-2">
                      {(!isSearching || matchFairQueue) && (
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={settings.enableFairQueue}
                            onChange={(e) => updateSettings({ enableFairQueue: e.target.checked })}
                            className="w-4 h-4 accent-indigo-600 rounded"
                          />
                          <span>{t('settings.fairQueue')}</span>
                        </label>
                      )}

                      {(!isSearching || matchGuestPortal) && (
                        <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 space-y-2">
                          <label className="flex items-center gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={settings.enableGuestPortal}
                              onChange={(e) => updateSettings({ enableGuestPortal: e.target.checked })}
                              className="w-4 h-4 accent-indigo-600 rounded"
                            />
                            <span className="font-semibold text-white">{t('settings.guestPortal')}</span>
                          </label>

                          {portalInfo && settings.enableGuestPortal && (
                            <div className="pl-7 space-y-1.5 text-slate-400 text-[11px]">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span>URL Smartphone:</span>
                                <code className="font-mono text-indigo-400 font-semibold select-all bg-black/50 px-2 py-0.5 rounded border border-slate-800">
                                  {portalInfo.url || `http://${portalInfo.ip || '127.0.0.1'}:${portalInfo.port || settings.guestPortalPort}`}
                                </code>
                              </div>
                              <div className="text-[10px] text-slate-400">
                                Porta attiva: <span className="text-white font-mono">{portalInfo.port || settings.guestPortalPort}</span> | IP LAN: <span className="text-white font-mono">{portalInfo.ip || '127.0.0.1'}</span>
                              </div>
                              <div className="pt-2">
                                <FirewallGuideCard />
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {(!isSearching || matchSiae) && (
                        <>
                          <label className="flex items-center gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={settings.enableSiaeReporting}
                              onChange={(e) => updateSettings({ enableSiaeReporting: e.target.checked })}
                              className="w-4 h-4 accent-indigo-600 rounded"
                            />
                            <span>{t('settings.siaeReporting')}</span>
                          </label>

                          {settings.enableSiaeReporting && (
                            <div className="pt-2">
                              <button
                                type="button"
                                onClick={handleExportSiae}
                                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg flex items-center gap-2 font-semibold border border-slate-700"
                              >
                                <Download className="w-4 h-4 text-emerald-400" />
                                {t('settings.exportSiae')}
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Logs & Diagnostics */}
                {(!isSearching || matchLogs) && (
                  <div className="space-y-3 pt-2 border-t border-slate-800/80">
                    <h3 className="font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                      <Terminal className="w-4 h-4 text-amber-400" /> {t('settings.logsTitle')}
                    </h3>

                    <div>
                      <label className="block text-slate-400 mb-1.5 font-medium">{t('settings.logLevel')}</label>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                        {(['debug', 'info', 'warn', 'error', 'off'] as const).map((level) => {
                          const isSelected = (settings.logLevel || 'info') === level;
                          return (
                            <button
                              key={level}
                              type="button"
                              onClick={() => updateSettings({ logLevel: level })}
                              className={`px-3 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider transition-all border ${
                                isSelected
                                  ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 shadow-md shadow-amber-950/30'
                                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800/60'
                              }`}
                            >
                              {level}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                        {t('settings.logLevelHelp')}
                      </p>
                    </div>

                    {logFilePath && (
                      <div className="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-3 space-y-2">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <span className="text-slate-400 font-medium">{t('settings.logFilePath')}:</span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={handleOpenLogFolder}
                              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg flex items-center gap-1.5 font-medium border border-slate-700 hover:border-slate-600 transition-colors"
                              title={t('settings.openLogFolder')}
                            >
                              <FolderOpen className="w-3.5 h-3.5 text-indigo-400" />
                              <span>{t('settings.openLogFolder')}</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleOpenLogFile}
                              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg flex items-center gap-1.5 font-medium border border-slate-700 hover:border-slate-600 transition-colors"
                              title={t('settings.openLogFile')}
                            >
                              <FileText className="w-3.5 h-3.5 text-emerald-400" />
                              <span>{t('settings.openLogFile')}</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleClearLogs}
                              className="px-2 py-1 bg-rose-950/30 hover:bg-rose-900/50 text-rose-300 rounded-lg flex items-center gap-1 font-medium border border-rose-800/40 transition-colors"
                              title={t('settings.clearLogs')}
                            >
                              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                            </button>
                          </div>
                        </div>
                        <div className="font-mono text-[11px] text-slate-400 bg-slate-900/90 rounded-lg p-2 overflow-x-auto select-all border border-slate-800">
                          {logFilePath}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Software Updates (Phase 1) */}
                {(!isSearching || matchUpdates) && (
                  <div className="space-y-3 pt-2">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4 text-indigo-400" /> {t('settings.updatesTitle', 'Aggiornamenti Software')}
                      </h3>
                      {appUpdateInfo?.hasUpdate && (
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse">
                          {t('settings.updateAvailable', { version: appUpdateInfo.latestVersion })}
                        </span>
                      )}
                    </div>
                    <div className="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-4 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400 font-medium">
                              {t('settings.currentVersion', 'Versione attuale')}:
                            </span>
                            <span className="font-mono font-bold text-white bg-slate-800/80 px-2 py-0.5 rounded-md border border-slate-700/60">
                              v{appUpdateInfo?.currentVersion || '2.1.0'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            {t('settings.updatesDesc', 'Verifica la disponibilità di nuove release ufficiali su GitHub.')}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={isCheckingAppUpdate}
                          onClick={handleManualCheckUpdates}
                          className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl flex items-center justify-center gap-2 font-semibold text-xs shadow-md shadow-indigo-950/40 border border-indigo-500/40 transition-all shrink-0 cursor-pointer"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isCheckingAppUpdate ? 'animate-spin' : ''}`} />
                          <span>
                            {isCheckingAppUpdate
                              ? t('settings.checkingUpdates', 'Verifica in corso...')
                              : t('settings.checkUpdates', 'Verifica aggiornamenti')}
                          </span>
                        </button>
                      </div>

                      {appUpdateInfo && (
                        <div className="pt-2 border-t border-slate-800/60">
                          {appUpdateInfo.hasUpdate ? (
                            <div className="flex items-center justify-between flex-wrap gap-2 p-3 rounded-xl bg-emerald-950/20 border border-emerald-500/30 text-emerald-300">
                              <div className="flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
                                <div>
                                  <div className="font-semibold text-xs">
                                    {t('settings.updateAvailable', { version: appUpdateInfo.latestVersion })}
                                  </div>
                                  <div className="text-[11px] text-emerald-400/80">
                                    {appUpdateInfo.releaseName || `Karaoke Live Station v${appUpdateInfo.latestVersion}`}
                                  </div>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => setShowUpdateModal(true)}
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded-lg flex items-center gap-1.5 shadow transition-all cursor-pointer"
                              >
                                <span>{t('settings.viewRelease', 'Vedi note di rilascio e scarica')}</span>
                                <ExternalLink className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-slate-300 text-xs">
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                              <span>{t('settings.upToDateDesc', { version: appUpdateInfo.currentVersion })}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
  );
};
