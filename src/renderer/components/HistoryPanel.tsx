import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  History,
  FileDown,
  Trash2,
  Search,
  X,
  User,
  Clock,
  Music,
  AlertTriangle,
  RefreshCw,
  CheckCircle2
} from 'lucide-react';

export interface SiaeLogEntry {
  id: number;
  trackTitle: string;
  trackArtist: string;
  singerName: string | null;
  executedAt: number;
  durationSec: number;
}

/**
 * HistoryPanel Component
 *
 * Provides a dedicated view for the historical execution log of played tracks.
 * Key responsibilities:
 * 1. Persistent Execution Memory:
 *    - Fetches and displays all completed track executions from the SQLite `siae_logs` table.
 *    - Preserves data across sessions until explicitly cleared by the operator.
 * 2. SIAE / Royalty CSV Borderò Export:
 *    - Invokes native Electron save dialog to export standard CSV reports for copyright compliance.
 * 3. Clearing History:
 *    - Provides a safe, confirmed workflow to wipe historical execution records.
 * 4. Filtering & Search:
 *    - Allows real-time filtering of executed songs by title, artist, or performer name.
 */
export const HistoryPanel: React.FC = () => {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<SiaeLogEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showConfirmClear, setShowConfirmClear] = useState<boolean>(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'info' | 'error'; text: string } | null>(null);

  /**
   * Fetches historical execution records from the main process SQLite database.
   */
  const loadLogs = useCallback(async () => {
    if (typeof window === 'undefined' || !window.karaokeApi?.siae?.getLogs) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const data = await window.karaokeApi.siae.getLogs();
      setLogs(data || []);
    } catch (err) {
      console.error('Failed to retrieve SIAE historical logs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load on mount
  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  /**
   * Clears temporary notification message after 4 seconds.
   */
  useEffect(() => {
    if (!feedbackMessage) return;
    const timer = setTimeout(() => {
      setFeedbackMessage(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [feedbackMessage]);

  /**
   * Filters logs by search query (matching track title, artist, or singer name).
   */
  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(
      (item) =>
        item.trackTitle.toLowerCase().includes(q) ||
        item.trackArtist.toLowerCase().includes(q) ||
        (item.singerName && item.singerName.toLowerCase().includes(q))
    );
  }, [logs, searchQuery]);

  /**
   * Triggers native CSV export dialog for copyright reporting.
   */
  const handleExportCsv = async () => {
    if (!window.karaokeApi?.siae?.exportCsv) return;
    try {
      const res = await window.karaokeApi.siae.exportCsv();
      if (res.success && res.filePath) {
        setFeedbackMessage({
          type: 'success',
          text: t('settings.siaeExportSuccess', { path: res.filePath })
        });
      }
    } catch (err) {
      console.error('Failed to export SIAE CSV report:', err);
      setFeedbackMessage({
        type: 'error',
        text: 'Errore durante l\'esportazione del file CSV.'
      });
    }
  };

  /**
   * Clears all historical logs from the persistent SQLite database.
   */
  const handleClearLogs = async () => {
    if (!window.karaokeApi?.siae?.clearLogs) return;
    try {
      const res = await window.karaokeApi.siae.clearLogs();
      if (res.success) {
        setShowConfirmClear(false);
        await loadLogs();
        setFeedbackMessage({
          type: 'info',
          text: t('history.cleared')
        });
      }
    } catch (err) {
      console.error('Failed to clear historical logs:', err);
      setShowConfirmClear(false);
    }
  };

  /**
   * Formats duration seconds into mm:ss format.
   */
  const formatDuration = (sec: number): string => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  /**
   * Formats execution timestamp into readable date and time.
   */
  const formatExecutedAt = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleString(undefined, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800/80 rounded-3xl p-4 shadow-xl backdrop-blur-sm flex-1 min-h-0 flex flex-col overflow-hidden relative">
      {/* Header bar */}
      <div className="mb-3 shrink-0 flex items-center justify-between px-3.5 py-2 bg-slate-950/70 rounded-full border border-slate-800/80">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
          <History className="w-4 h-4 text-indigo-400" />
          <span>{t('history.title')}</span>
          <span className="text-[10px] bg-indigo-950/80 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-500/30">
            {logs.length}
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={loadLogs}
            disabled={loading}
            className="p-1.5 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            title="Aggiorna storico"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={logs.length === 0}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-800/90 hover:bg-emerald-600/30 text-slate-200 hover:text-emerald-300 border border-slate-700/60 hover:border-emerald-500/50 text-xs font-semibold transition-all disabled:opacity-40 disabled:pointer-events-none active:scale-95"
            title={t('history.exportCsv')}
          >
            <FileDown className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">{t('history.exportCsv')}</span>
            <span className="sm:hidden">SIAE</span>
          </button>

          <button
            type="button"
            onClick={() => setShowConfirmClear(true)}
            disabled={logs.length === 0}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-800/90 hover:bg-rose-600/30 text-slate-200 hover:text-rose-300 border border-slate-700/60 hover:border-rose-500/50 text-xs font-semibold transition-all disabled:opacity-40 disabled:pointer-events-none active:scale-95"
            title={t('history.clear')}
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
            <span className="hidden sm:inline">{t('history.clear')}</span>
            <span className="sm:hidden">Svuota</span>
          </button>
        </div>
      </div>

      {/* Optional feedback banner */}
      {feedbackMessage && (
        <div
          className={`mb-3 px-3 py-2 rounded-xl text-xs flex items-center gap-2 border transition-all ${
            feedbackMessage.type === 'success'
              ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40'
              : feedbackMessage.type === 'error'
              ? 'bg-rose-950/60 text-rose-300 border-rose-500/40'
              : 'bg-indigo-950/60 text-indigo-300 border-indigo-500/40'
          }`}
        >
          {feedbackMessage.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
          {feedbackMessage.type === 'error' && <AlertTriangle className="w-4 h-4 shrink-0" />}
          {feedbackMessage.type === 'info' && <History className="w-4 h-4 shrink-0" />}
          <span className="truncate flex-1">{feedbackMessage.text}</span>
          <button
            type="button"
            onClick={() => setFeedbackMessage(null)}
            className="text-slate-400 hover:text-white"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Search Bar */}
      <div className="mb-3 shrink-0 relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className="w-3.5 h-3.5 text-slate-500" />
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('history.searchPlaceholder')}
          className="w-full pl-9 pr-8 py-1.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-500 hover:text-slate-300"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Main List of Historical Executions */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
        {filteredLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
            <History className="w-10 h-10 text-slate-700 mb-2" />
            <p className="text-xs font-medium">
              {searchQuery ? 'Nessun brano corrisponde alla ricerca.' : t('history.empty')}
            </p>
            {!searchQuery && (
              <p className="text-[11px] text-slate-600 mt-1 max-w-xs">
                I brani completati appariranno qui automaticamente e rimarranno salvati fino a quando non deciderai di svuotare lo storico.
              </p>
            )}
          </div>
        ) : (
          filteredLogs.map((entry, index) => (
            <div
              key={entry.id}
              className="p-2.5 rounded-2xl border bg-slate-950/60 border-slate-800/80 text-slate-300 hover:border-slate-700/80 hover:bg-slate-950/90 transition-all flex items-center justify-between gap-3 group"
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                {/* Index / Counter Badge */}
                <div className="w-7 h-7 rounded-full bg-slate-800/90 text-slate-400 border border-slate-700/60 flex items-center justify-center shrink-0 text-[11px] font-mono">
                  {filteredLogs.length - index}
                </div>

                {/* Track and Singer Information */}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-slate-200 truncate flex items-center gap-1.5">
                    <Music className="w-3 h-3 text-indigo-400 shrink-0" />
                    <span className="truncate">{entry.trackTitle}</span>
                  </div>
                  <div className="text-[11px] text-slate-400 truncate flex items-center gap-1.5 mt-0.5">
                    <span className="truncate">{entry.trackArtist}</span>
                    <span>•</span>
                    <div className="flex items-center gap-1 text-slate-300 truncate">
                      <User className="w-2.5 h-2.5 text-indigo-400 shrink-0" />
                      <span className="truncate font-medium">
                        {entry.singerName || <span className="italic text-slate-500">{t('history.noSinger')}</span>}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Timestamp & Duration Metatags */}
              <div className="shrink-0 text-right text-[10px] text-slate-400 font-mono space-y-0.5">
                <div className="flex items-center justify-end gap-1 text-slate-300">
                  <Clock className="w-2.5 h-2.5 text-slate-500" />
                  <span>{formatExecutedAt(entry.executedAt)}</span>
                </div>
                <div className="text-slate-500">
                  {formatDuration(entry.durationSec)}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Confirmation Modal for Clearing History */}
      {showConfirmClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="w-10 h-10 rounded-full bg-rose-950/60 border border-rose-500/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-100">{t('history.clear')}</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">Azione distruttiva permanente</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              {t('history.confirmClear')}
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800/80">
              <button
                type="button"
                onClick={() => setShowConfirmClear(false)}
                className="px-4 py-1.5 rounded-full text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
              >
                {t('singers.cancel')}
              </button>
              <button
                type="button"
                onClick={handleClearLogs}
                className="px-4 py-1.5 rounded-full text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 shadow-md shadow-rose-600/30 transition-all active:scale-95"
              >
                {t('history.clear')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

