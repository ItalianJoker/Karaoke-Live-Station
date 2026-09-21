import React from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Download, ExternalLink, X, ArrowUpCircle, HardDrive } from 'lucide-react';
import { useKaraokeStore } from '../store/karaokeStore';

/**
 * Formats byte size into human readable string (MB).
 */
function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

/**
 * Modal shown when a newer release of Karaoke Live Station is detected on GitHub.
 * Displays version differences, asset details, and release notes with a direct download action.
 */
export const UpdateAvailableModal: React.FC = () => {
  const { t } = useTranslation();
  const showUpdateModal = useKaraokeStore((s) => s.showUpdateModal);
  const setShowUpdateModal = useKaraokeStore((s) => s.setShowUpdateModal);
  const appUpdateInfo = useKaraokeStore((s) => s.appUpdateInfo);

  if (!showUpdateModal || !appUpdateInfo || !appUpdateInfo.hasUpdate) {
    return null;
  }

  const handleDownload = () => {
    const targetUrl = appUpdateInfo.downloadUrl || appUpdateInfo.releaseUrl;
    if (targetUrl) {
      if (window.karaokeApi?.system?.openExternal) {
        window.karaokeApi.system.openExternal(targetUrl);
      } else {
        window.open(targetUrl, '_blank');
      }
    }
  };

  const handleOpenReleasePage = () => {
    const url = appUpdateInfo.releaseUrl;
    if (url) {
      if (window.karaokeApi?.system?.openExternal) {
        window.karaokeApi.system.openExternal(url);
      } else {
        window.open(url, '_blank');
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-slate-900 border border-emerald-500/40 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-gradient-to-r from-slate-900 via-emerald-950/20 to-slate-900">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <ArrowUpCircle className="w-6 h-6 animate-bounce" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>{t('settings.updateAvailable', { version: appUpdateInfo.latestVersion })}</span>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  NEW
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {appUpdateInfo.releaseName || `Karaoke Live Station v${appUpdateInfo.latestVersion}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowUpdateModal(false)}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar flex-1 text-xs">
          {/* Versions Bar */}
          <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-slate-950/80 border border-slate-800/80">
            <div>
              <span className="text-[11px] text-slate-500 uppercase tracking-wider block">
                {t('settings.currentVersion', 'Versione attuale')}
              </span>
              <span className="text-xs font-mono font-semibold text-slate-400">
                v{appUpdateInfo.currentVersion}
              </span>
            </div>
            <div>
              <span className="text-[11px] text-emerald-400/80 uppercase tracking-wider block">
                Disponibile
              </span>
              <span className="text-xs font-mono font-bold text-emerald-300">
                v{appUpdateInfo.latestVersion}
              </span>
            </div>
          </div>

          {/* Asset Info if matched */}
          {appUpdateInfo.assetName && (
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/40 border border-slate-800/60 text-slate-300">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-indigo-400 shrink-0" />
                <span className="font-mono text-xs truncate max-w-xs">{appUpdateInfo.assetName}</span>
              </div>
              {appUpdateInfo.assetSize && (
                <span className="text-[11px] text-slate-400 font-mono">
                  {formatSize(appUpdateInfo.assetSize)}
                </span>
              )}
            </div>
          )}

          {/* Release Notes */}
          {appUpdateInfo.releaseNotes && (
            <div className="space-y-1.5">
              <h4 className="font-semibold text-slate-300 text-xs flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                {t('settings.releaseNotes', 'Novità della versione')}
              </h4>
              <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3 max-h-48 overflow-y-auto text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap select-text font-mono">
                {appUpdateInfo.releaseNotes}
              </div>
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleOpenReleasePage}
            className="text-xs text-slate-400 hover:text-indigo-300 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <span>GitHub Release</span>
            <ExternalLink className="w-3 h-3" />
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowUpdateModal(false)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-medium text-xs transition-colors cursor-pointer"
            >
              {t('settings.updateLater', 'Più tardi')}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="px-5 py-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-950/40 border border-emerald-400/30 flex items-center gap-2 transition-all cursor-pointer transform active:scale-95"
            >
              <Download className="w-4 h-4" />
              <span>{t('settings.downloadUpdate', 'Scarica aggiornamento')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

