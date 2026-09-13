import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Folder, FolderOpen, Download, Settings, Volume2, Globe, Clock, ShieldCheck, Headphones, FileText, Terminal, Trash2, RefreshCw, CheckCircle2, AlertCircle, Heart, Coffee, ExternalLink } from 'lucide-react';
import { useKaraokeStore } from '../store/karaokeStore';
import { AppTheme, YtDlpStatus } from '../../shared/types';
import appLogo from '../assets/logo.png';

const THEME_OPTIONS: { id: AppTheme; label: string }[] = [
  { id: 'dark-stage', label: 'Dark Stage (Predefinito)' },
  { id: 'midnight-neon', label: 'Midnight Neon (Cyberpunk)' },
  { id: 'club-gold', label: 'Club Gold (VIP Lounge)' },
  { id: 'ocean-breeze', label: 'Ocean Breeze (Deep Cyan)' },
  { id: 'sunset-crimson', label: 'Sunset Crimson (Warm Red)' },
  { id: 'emerald-matrix', label: 'Emerald Matrix (Live Green)' },
  { id: 'royal-amethyst', label: 'Royal Amethyst (Deep Purple)' },
  { id: 'high-contrast', label: 'High Contrast (Accessibile)' },
  { id: 'light', label: 'Light Studio (Clean)' },
];

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * SettingsModal
 *
 * Comprehensive Preferences and Hardware Configuration Modal.
 * Sections:
 * 1. Audio Routing:
 *    - Master Output Device selection.
 *    - CUE Headphone Output Device selection for DJ monitoring.
 * 2. SoundFont & Synthesis:
 *    - Custom SoundFont (.sf2 / .sf3 / .dls) file selector.
 *    - Automatic fallback detection to OS-installed General MIDI SoundFonts.
 * 3. Playback & Timing:
 *    - Audio-video sync latency calibration offset (milliseconds).
 *    - Auto-advance next song toggle and crossfade duration.
 *    - Banner timers (intro, outro, transition pause, and video song title overlay duration).
 * 4. Venue & Legal:
 *    - SIAE borderò automated song tracking toggle and CSV export.
 * 5. Network Guest Portal:
 *    - Enable/disable local mobile audience request server.
 * 6. UI & Localization:
 *    - Multi-language switcher (Italian, English, Spanish, French, Auto-detect).
 *    - Visual theme selection for Host and Stage screens (9 distinct palettes).
 * 7. Diagnostic Logging:
 *    - Configurable log level ('debug' | 'info' | 'warn' | 'error' | 'off')
 *    - Log file inspection, opening folder/file, and log clearing.
 */
export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { t, i18n } = useTranslation();
  const settings = useKaraokeStore((state) => state.settings);
  const updateSettings = useKaraokeStore((state) => state.updateSettings);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [defaultSystemSf, setDefaultSystemSf] = useState<string | null>(null);
  const [logFilePath, setLogFilePath] = useState<string>('');
  const [portalInfo, setPortalInfo] = useState<{ enabled: boolean; url: string; port?: number; ip?: string } | null>(null);
  const [ytdlpStatus, setYtdlpStatus] = useState<YtDlpStatus | null>(null);
  const [isCheckingYtdlp, setIsCheckingYtdlp] = useState(false);
  const [ytdlpMessage, setYtdlpMessage] = useState<string | null>(null);

  useEffect(() => {
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        const audioOutputs = devices.filter((d) => d.kind === 'audiooutput');
        setAudioDevices(audioOutputs);
      }).catch((err) => console.warn('Could not enumerate audio devices:', err));
    }

    if (window.karaokeApi?.system?.getDefaultSoundFont) {
      window.karaokeApi.system.getDefaultSoundFont().then(setDefaultSystemSf);
    }

    if (window.karaokeApi?.logger?.getLogFilePath) {
      window.karaokeApi.logger.getLogFilePath().then(setLogFilePath);
    }

    if (window.karaokeApi?.guestPortal?.getInfo) {
      window.karaokeApi.guestPortal.getInfo().then(setPortalInfo);
    }

    if (window.karaokeApi?.ytdlp?.getStatus) {
      window.karaokeApi.ytdlp.getStatus().then(setYtdlpStatus);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSelectSoundFont = async () => {
    if (!window.karaokeApi) return;
    const path = await window.karaokeApi.dialog.openSoundFontFile();
    if (path) {
      updateSettings({ midiSoundFontPath: path });
    }
  };

  const handleResetDefaultSoundFont = () => {
    if (defaultSystemSf) {
      updateSettings({ midiSoundFontPath: defaultSystemSf });
    }
  };

  const handleOpenDonation = () => {
    const url = 'https://www.paypal.com/paypalme/LucaAbagnale';
    if (window.karaokeApi?.system?.openExternal) {
      window.karaokeApi.system.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  };

  const handleSelectLibraryPath = async () => {
    if (!window.karaokeApi) return;
    const folder = await window.karaokeApi.dialog.openDirectory();
    if (folder) {
      updateSettings({ libraryPath: folder });
    }
  };

  const handleExportSiae = async () => {
    if (!window.karaokeApi) return;
    const res = await window.karaokeApi.siae.exportCsv();
    if (res.success && res.filePath) {
      alert(t('settings.siaeExportSuccess', { path: res.filePath }));
    }
  };

  const handleOpenLogFolder = async () => {
    if (window.karaokeApi?.logger?.openLogFolder) {
      await window.karaokeApi.logger.openLogFolder();
    }
  };

  const handleOpenLogFile = async () => {
    if (window.karaokeApi?.logger?.openLogFile) {
      await window.karaokeApi.logger.openLogFile();
    }
  };

  const handleClearLogs = async () => {
    if (window.karaokeApi?.logger?.clearLogs) {
      if (confirm(t('settings.confirmClearLogs'))) {
        await window.karaokeApi.logger.clearLogs();
        alert(t('settings.logsCleared'));
      }
    }
  };

  const handleCheckYtDlpUpdate = async () => {
    if (!window.karaokeApi?.ytdlp) return;
    setIsCheckingYtdlp(true);
    setYtdlpMessage(null);
    try {
      const updated = await window.karaokeApi.ytdlp.checkUpdate();
      setYtdlpStatus(updated);
      if (updated.error) {
        setYtdlpMessage(t('settings.ytdlpUpdateFailed', { error: updated.error }));
      } else if (updated.version) {
        setYtdlpMessage(t('settings.ytdlpUpdateSuccess', { version: updated.version }));
      }
    } catch (err: any) {
      setYtdlpMessage(t('settings.ytdlpUpdateFailed', { error: err?.message || String(err) }));
    } finally {
      setIsCheckingYtdlp(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-bold text-white">{t('settings.title')}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <div className="flex-1 overflow-y-auto py-4 space-y-6 text-xs pr-4 md:pr-5">
          {/* Section 1: Themes & Localization */}
          <div className="space-y-3">
            <h3 className="font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Globe className="w-4 h-4 text-indigo-400" /> {t('settings.theme')} & {t('settings.language')}
            </h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">{t('settings.theme')}</label>
                <select
                  value={settings.themeHost}
                  onChange={(e) => updateSettings({ themeHost: e.target.value as any })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                >
                  {THEME_OPTIONS.map((th) => (
                    <option key={th.id} value={th.id}>
                      {th.label}
                    </option>
                  ))}
                </select>
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
                      {th.label}
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

          {/* Section 2: Audio, Routing & SoundFont */}
          <div className="space-y-3">
            <h3 className="font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Volume2 className="w-4 h-4 text-emerald-400" /> Audio DSP, Routing & SoundFont
            </h3>

            {/* SoundFont Path */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <label className="text-slate-400 font-medium">{t('settings.soundfont')}</label>
                  {settings.midiSoundFontPath && defaultSystemSf && settings.midiSoundFontPath === defaultSystemSf && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-800/80 text-emerald-400 text-[10px] font-semibold">
                      Default di Sistema
                    </span>
                  )}
                </div>
                {defaultSystemSf && settings.midiSoundFontPath !== defaultSystemSf && (
                  <button
                    type="button"
                    onClick={handleResetDefaultSoundFont}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 underline font-medium cursor-pointer"
                  >
                    Usa soundfont di sistema
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={settings.midiSoundFontPath || ''}
                  placeholder={t('midi.noSoundfontSelected')}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white text-xs font-mono"
                />
                <button
                  type="button"
                  onClick={handleSelectSoundFont}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl flex items-center gap-1.5 font-semibold transition-colors"
                >
                  <FolderOpen className="w-4 h-4 text-amber-400" />
                  {t('settings.browse')}
                </button>
              </div>
            </div>

            {/* Karaoke Media Library Folder */}
            <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800/80">
              <label className="block text-slate-400 mb-1.5 flex items-center gap-1.5 font-medium text-xs">
                <Folder className="w-4 h-4 text-emerald-400" />
                {t('settings.libraryPath')}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={settings.libraryPath || ''}
                  placeholder={t('settings.noLibraryPathSelected')}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white text-xs font-mono"
                />
                <button
                  type="button"
                  onClick={handleSelectLibraryPath}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl flex items-center gap-1.5 font-semibold transition-colors"
                >
                  <FolderOpen className="w-4 h-4 text-emerald-400" />
                  {t('settings.browse')}
                </button>
              </div>
            </div>

            {/* CUE and Master Audio Devices */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1 flex items-center gap-1">
                  <Headphones className="w-3.5 h-3.5 text-amber-400" />
                  {t('settings.cueDevice')}
                </label>
                <select
                  value={settings.cueAudioDeviceId}
                  onChange={(e) => updateSettings({ cueAudioDeviceId: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                >
                  <option value="default">Default Device</option>
                  {audioDevices.map((dev) => (
                    <option key={dev.deviceId} value={dev.deviceId}>
                      {dev.label || `Device ${dev.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">{t('settings.masterDevice')}</label>
                <select
                  value={settings.masterAudioDeviceId}
                  onChange={(e) => updateSettings({ masterAudioDeviceId: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                >
                  <option value="default">Default Device</option>
                  {audioDevices.map((dev) => (
                    <option key={dev.deviceId} value={dev.deviceId}>
                      {dev.label || `Device ${dev.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Sync Latency Offset */}
            <div>
              <div className="flex justify-between text-slate-400 mb-1">
                <span>{t('settings.audioVideoSync')}</span>
                <span className="font-mono text-indigo-400">{settings.audioVideoSyncOffsetMs} ms</span>
              </div>
              <input
                type="range"
                min="-500"
                max="500"
                step="10"
                value={settings.audioVideoSyncOffsetMs}
                onChange={(e) => updateSettings({ audioVideoSyncOffsetMs: parseInt(e.target.value, 10) })}
                className="w-full accent-indigo-600"
              />
            </div>

            {/* Audio Volume Normalization (Auto-Leveling) */}
            <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800/80">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.enableAudioNormalization ?? true}
                  onChange={(e) => updateSettings({ enableAudioNormalization: e.target.checked })}
                  className="w-4 h-4 accent-indigo-600 rounded mt-0.5"
                />
                <div>
                  <span className="font-semibold text-white text-xs flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
                    {t('settings.audioNormalization')}
                  </span>
                  <span className="text-[11px] text-slate-400 leading-relaxed block mt-0.5">
                    {t('settings.audioNormalizationDesc')}
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Section 3: Timers e Banner */}
          <div className="space-y-3">
            <h3 className="font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-amber-400" /> Timers & Banner
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">{t('settings.bannerIntro')}</label>
                <input
                  type="number"
                  min="2"
                  max="15"
                  value={settings.bannerIntroDurationSec}
                  onChange={(e) => updateSettings({ bannerIntroDurationSec: parseInt(e.target.value, 10) || 6 })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">{t('settings.bannerOutro')}</label>
                <input
                  type="number"
                  min="10"
                  max="45"
                  value={settings.bannerOutroTriggerSec}
                  onChange={(e) => updateSettings({ bannerOutroTriggerSec: parseInt(e.target.value, 10) || 20 })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">{t('settings.transitionPause')}</label>
                <input
                  type="number"
                  min="0"
                  max="15"
                  value={settings.transitionPauseSec}
                  onChange={(e) => updateSettings({ transitionPauseSec: parseInt(e.target.value, 10) || 3 })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">{t('settings.titleOverlayDuration')}</label>
                <input
                  type="number"
                  min="2"
                  max="30"
                  value={settings.titleOverlayDurationSec ?? 8}
                  onChange={(e) => updateSettings({ titleOverlayDurationSec: parseInt(e.target.value, 10) || 8 })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800/80">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.showNextSingerAtIntro ?? true}
                  onChange={(e) => updateSettings({ showNextSingerAtIntro: e.target.checked })}
                  className="w-4 h-4 accent-indigo-600 rounded mt-0.5"
                />
                <div>
                  <span className="text-sm font-medium text-slate-200 block">{t('settings.showNextSingerAtIntro')}</span>
                  <span className="text-xs text-slate-400 block mt-0.5">{t('settings.showNextSingerAtIntroDesc')}</span>
                </div>
              </label>
            </div>
          </div>

          {/* Section 4: Moduli Live & SIAE */}
          <div className="space-y-3">
            <h3 className="font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-rose-400" /> {t('settings.title')}
            </h3>
            <div className="space-y-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.enableFairQueue}
                  onChange={(e) => updateSettings({ enableFairQueue: e.target.checked })}
                  className="w-4 h-4 accent-indigo-600 rounded"
                />
                <span>{t('settings.fairQueue')}</span>
              </label>

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
                    <div className="text-[10px] text-amber-400/90 pt-1 leading-relaxed">
                      🔒 <strong>Nota Firewall:</strong> Se gli smartphone nella stessa rete Wi-Fi non caricano la pagina, sblocca la porta nel firewall di sistema (su Linux: <code className="text-emerald-400 bg-black/60 px-1 py-0.5 rounded select-all font-mono">sudo ufw allow 3000:3010/tcp</code>).
                    </div>
                  </div>
                )}
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.autoAdvanceNext}
                  onChange={(e) => updateSettings({ autoAdvanceNext: e.target.checked })}
                  className="w-4 h-4 accent-indigo-600 rounded"
                />
                <span>{t('settings.autoAdvance')}</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.autoArchiveWebTracks}
                  onChange={(e) => updateSettings({ autoArchiveWebTracks: e.target.checked })}
                  className="w-4 h-4 accent-indigo-600 rounded"
                />
                <span>{t('settings.autoArchive')}</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.enableSiaeReporting}
                  onChange={(e) => updateSettings({ enableSiaeReporting: e.target.checked })}
                  className="w-4 h-4 accent-indigo-600 rounded"
                />
                <span>{t('settings.siaeReporting')}</span>
              </label>
            </div>

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
          </div>

          {/* Section 5: Diagnostica & File di Log */}
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
              <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
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

          {/* Section 8: Web Download Engine (yt-dlp) */}
          <div className="space-y-3 pt-3 border-t border-slate-800">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Download className="w-4 h-4 text-cyan-400" /> {t('settings.ytdlpTitle')}
              </h3>
              <button
                type="button"
                onClick={handleCheckYtDlpUpdate}
                disabled={isCheckingYtdlp}
                className="px-3 py-1.5 bg-cyan-950/40 hover:bg-cyan-900/60 text-cyan-300 rounded-xl flex items-center gap-1.5 font-semibold border border-cyan-800/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isCheckingYtdlp ? 'animate-spin' : ''}`} />
                <span>{isCheckingYtdlp ? t('settings.ytdlpChecking') : t('settings.ytdlpCheckUpdate')}</span>
              </button>
            </div>

            <div className="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-3 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                <span className="text-slate-400 font-medium">{t('settings.ytdlpStatus')}:</span>
                {ytdlpStatus?.available ? (
                  <span className="text-emerald-400 font-semibold flex items-center gap-1 bg-emerald-950/30 px-2 py-0.5 rounded-lg border border-emerald-800/40">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {t('settings.ytdlpInstalled', { version: ytdlpStatus.version || 'OK' })}
                  </span>
                ) : (
                  <span className="text-amber-400 font-semibold flex items-center gap-1 bg-amber-950/30 px-2 py-0.5 rounded-lg border border-amber-800/40">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {t('settings.ytdlpNotInstalled')}
                  </span>
                )}
              </div>

              {ytdlpStatus?.path && (
                <div className="space-y-1">
                  <span className="text-slate-500 text-[11px] block">{t('settings.ytdlpPath')}:</span>
                  <div className="font-mono text-[11px] text-slate-400 bg-slate-900/90 rounded-lg p-2 overflow-x-auto select-all border border-slate-800 break-all">
                    {ytdlpStatus.path}
                  </div>
                </div>
              )}

              {ytdlpMessage && (
                <div className={`text-[11px] p-2 rounded-lg border leading-relaxed ${
                  ytdlpStatus?.error
                    ? 'bg-rose-950/30 border-rose-800/40 text-rose-300'
                    : 'bg-emerald-950/30 border-emerald-800/40 text-emerald-300'
                }`}>
                  {ytdlpMessage}
                </div>
              )}
            </div>
          </div>

          {/* Section 9: Support & Donations */}
          <div className="pt-3 border-t border-slate-800">
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-950/40 via-indigo-950/30 to-purple-950/40 border border-indigo-500/30 p-4 shadow-lg shadow-indigo-950/20">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center shrink-0 text-indigo-400">
                    <Heart className="w-5 h-5 text-rose-400 animate-pulse" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      <span>{t('settings.supportTitle')}</span>
                      <span className="text-[10px] font-semibold bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full border border-blue-500/30">
                        PayPal
                      </span>
                    </h4>
                    <p className="text-xs text-slate-300 mt-1 max-w-xl leading-relaxed">
                      {t('settings.supportDescription')}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleOpenDonation}
                  className="px-4 py-2.5 bg-[#0070BA] hover:bg-[#005ea6] active:scale-95 text-white text-xs font-bold rounded-xl flex items-center gap-2 shadow-lg shadow-blue-900/30 border border-blue-400/30 transition-all shrink-0 cursor-pointer"
                >
                  <Coffee className="w-4 h-4 text-amber-200" />
                  <span>{t('settings.donateButton')}</span>
                  <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer & Branding */}
        <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={appLogo} alt="Logo" className="w-9 h-9 object-contain drop-shadow" />
            <div>
              <p className="text-xs font-bold text-white leading-tight">Karaoke Live Station</p>
              <p className="text-[10px] text-slate-500">v1.0.0 • Professional Karaoke Suite</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-indigo-600/20 active:scale-95 transition-all"
          >
            {t('settings.saveAndClose')}
          </button>
        </div>
      </div>
    </div>
  );
};
