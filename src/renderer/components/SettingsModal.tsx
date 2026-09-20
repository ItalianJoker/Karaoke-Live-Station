import React, { useState, useEffect } from 'react';
import { showToast, confirmAsync } from '../utils/toast';
import { useTranslation } from 'react-i18next';
import {
  X,
  Settings,
  Heart,
  Coffee,
  ExternalLink,
  Search,
  Keyboard,
  Monitor,
  Music2,
  Library,
  AlertTriangle,
} from 'lucide-react';
import { useKaraokeStore } from '../store/karaokeStore';
import { YtDlpStatus } from '../../shared/types';
import { textMatchesSearch } from '../../shared/textNormalize';
import {
  SOUND_FONT_OTHER_OPTION_ID,
  soundFontPathsEqual,
  type SoundFontCatalogEntry
} from '../../shared/soundFontPath';
import { detectUiCpuCoreCount } from '../../shared/aiCpuThreads';
import { APP_SHORTCUTS } from '../data/appShortcuts';
import type { GpuStatus } from '../../shared/gpuStatus';
import appLogo from '../assets/logo.png';
import { SettingsGeneralTab } from './settings/SettingsGeneralTab';
import { SettingsLibraryTab } from './settings/SettingsLibraryTab';
import { SettingsAudioTab } from './settings/SettingsAudioTab';
import { SettingsStageTab } from './settings/SettingsStageTab';
import { SettingsShortcutsTab } from './settings/SettingsShortcutsTab';
import { THEME_OPTIONS } from './settings/settingsTypes';

type SettingsTab = 'general' | 'library' | 'audio' | 'stage' | 'shortcuts';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * SettingsModal
 *
 * Preferences shell: search, tab nav, match flags, and confirm dialogs.
 * Tab bodies live under `./settings/*Tab`.
 *
 * **Audience (humans):** Full Preferences modal for Regia operators.
 *
 * **Audience (AI):** Keep IPC/status loading, match* search flags, and
 * `showCategory` gating here. Do not delete seemingly unused karaokeApi calls.
 */
export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { t, i18n } = useTranslation();
  const settings = useKaraokeStore((state) => state.settings);
  const updateSettings = useKaraokeStore((state) => state.updateSettings);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [defaultSystemSf, setDefaultSystemSf] = useState<string | null>(null);
  const [soundFontCatalog, setSoundFontCatalog] = useState<SoundFontCatalogEntry[]>([]);
  const [logFilePath, setLogFilePath] = useState<string>('');
  const [portalInfo, setPortalInfo] = useState<{ enabled: boolean; url: string; port?: number; ip?: string } | null>(null);
  const [ytdlpStatus, setYtdlpStatus] = useState<YtDlpStatus | null>(null);
  const [isCheckingYtdlp, setIsCheckingYtdlp] = useState(false);
  const [ytdlpMessage, setYtdlpMessage] = useState<string | null>(null);
  const [showAutoArchiveConfirm, setShowAutoArchiveConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [settingsSearch, setSettingsSearch] = useState('');
  const [cpuCoreCount, setCpuCoreCount] = useState(detectUiCpuCoreCount());
  const [gpuStatus, setGpuStatus] = useState<GpuStatus | null>(null);
  const [appVersion, setAppVersion] = useState('1.4.0');

  const isSearching = settingsSearch.trim().length > 0;

  const matchesSearch = (...parts: string[]) => {
    if (!isSearching) return true;
    const q = settingsSearch.trim();
    return parts.some((p) => textMatchesSearch(p || '', q));
  };

  useEffect(() => {
    if (!isOpen) {
      setSettingsSearch('');
      return;
    }

    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        const audioOutputs = devices.filter((d) => d.kind === 'audiooutput');
        setAudioDevices(audioOutputs);
      }).catch((err) => console.warn('Could not enumerate audio devices:', err));
    }

    if (window.karaokeApi?.system?.getDefaultSoundFont) {
      window.karaokeApi.system.getDefaultSoundFont().then(setDefaultSystemSf);
    }

    if (window.karaokeApi?.system?.listSoundFonts) {
      window.karaokeApi.system.listSoundFonts().then((entries) => {
        setSoundFontCatalog(Array.isArray(entries) ? entries : []);
      });
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

    if (window.karaokeApi?.system?.getCpuCoreCount) {
      window.karaokeApi.system
        .getCpuCoreCount()
        .then((n) => {
          const cores = Math.max(1, Math.floor(Number(n)) || detectUiCpuCoreCount());
          setCpuCoreCount(cores);
        })
        .catch(() => setCpuCoreCount(detectUiCpuCoreCount()));
    } else {
      setCpuCoreCount(detectUiCpuCoreCount());
    }

    if (window.karaokeApi?.system?.getGpuStatus) {
      window.karaokeApi.system
        .getGpuStatus()
        .then((status) => {
          if (status && typeof status.isSupported === 'boolean') {
            setGpuStatus(status);
          } else {
            setGpuStatus({ isSupported: false });
          }
        })
        .catch(() => setGpuStatus({ isSupported: false }));
    } else {
      setGpuStatus({ isSupported: false });
    }

    if (window.karaokeApi?.system?.getAppVersion) {
      window.karaokeApi.system
        .getAppVersion()
        .then((v) => {
          if (typeof v === 'string' && v.trim()) setAppVersion(v.trim());
        })
        .catch(() => setAppVersion('1.4.0'));
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

  const soundFontSelectValue = (() => {
    const current = settings.midiSoundFontPath || '';
    if (!current) {
      return soundFontCatalog[0]?.id || SOUND_FONT_OTHER_OPTION_ID;
    }
    const match = soundFontCatalog.find((e) => soundFontPathsEqual(e.path, current));
    if (match) return match.id;
    return SOUND_FONT_OTHER_OPTION_ID;
  })();

  const handleSoundFontSelectChange = async (value: string) => {
    if (value === SOUND_FONT_OTHER_OPTION_ID) {
      await handleSelectSoundFont();
      return;
    }
    const entry = soundFontCatalog.find((e) => e.id === value);
    if (entry?.path) {
      updateSettings({ midiSoundFontPath: entry.path });
    }
  };

  const handleResetDefaultSoundFont = () => {
    if (defaultSystemSf) {
      updateSettings({ midiSoundFontPath: defaultSystemSf });
    } else if (soundFontCatalog[0]?.path) {
      updateSettings({ midiSoundFontPath: soundFontCatalog[0].path });
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
      showToast(t('settings.siaeExportSuccess', { path: res.filePath }));
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
      if (await confirmAsync(t('settings.confirmClearLogs'))) {
        await window.karaokeApi.logger.clearLogs();
        showToast(t('settings.logsCleared'));
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

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'general',
      label: t('settings.tabGeneral', 'Generale'),
      icon: <Settings className="w-3.5 h-3.5" />,
    },
    {
      id: 'library',
      label: t('settings.tabLibrary', 'Libreria & Download'),
      icon: <Library className="w-3.5 h-3.5" />,
    },
    {
      id: 'audio',
      label: t('settings.tabAudio', 'Audio & Riproduzione'),
      icon: <Music2 className="w-3.5 h-3.5" />,
    },
    {
      id: 'stage',
      label: t('settings.tabStage', 'Schermo Stage'),
      icon: <Monitor className="w-3.5 h-3.5" />,
    },
    {
      id: 'shortcuts',
      label: t('settings.tabShortcuts', 'Scorciatoie'),
      icon: <Keyboard className="w-3.5 h-3.5" />,
    },
  ];

  // --- Search match flags per setting block ---
  const matchSupport = matchesSearch(
    t('settings.supportTitle'),
    t('settings.supportDescription'),
    t('settings.donateButton'),
    'PayPal',
    'donazione',
    'donation'
  );
  const matchThemeLang = matchesSearch(
    t('settings.theme'),
    t('settings.stageTheme'),
    t('settings.language'),
    'tema',
    'theme',
    'lingua',
    'language',
    ...THEME_OPTIONS.map((th) => th.label)
  );
  const matchFairQueue = matchesSearch(t('settings.fairQueue'), 'fair queue', 'coda');
  const matchGuestPortal = matchesSearch(
    t('settings.guestPortal'),
    'guest portal',
    'firewall',
    'LAN',
    'smartphone',
    t('firewall.title')
  );
  const matchSiae = matchesSearch(
    t('settings.siaeReporting'),
    t('settings.exportSiae'),
    'SIAE',
    'borderò'
  );
  const matchLogs = matchesSearch(
    t('settings.logsTitle'),
    t('settings.logLevel'),
    t('settings.logLevelHelp'),
    t('settings.logFilePath'),
    t('settings.openLogFolder'),
    t('settings.openLogFile'),
    t('settings.clearLogs'),
    'log',
    'diagnostica',
    'debug'
  );
  const matchMaximize = matchesSearch(
    t('settings.autoMaximizeControl', 'Massimizza Regia all\'avvio'),
    t('settings.autoMaximizeControlDesc', 'Apre la finestra di controllo massimizzata all\'avvio dell\'app'),
    'maximize',
    'massimizza',
    'regia',
    'avvio',
    'launch'
  );

  const matchLibraryPath = matchesSearch(
    t('settings.libraryPath'),
    t('settings.noLibraryPathSelected'),
    'libreria',
    'library',
    'cartella'
  );
  const matchAutoArchive = matchesSearch(
    t('settings.autoArchive'),
    'archivia',
    'archive',
    'download'
  );
  const matchYtdlp = matchesSearch(
    t('settings.ytdlpTitle'),
    t('settings.ytdlpStatus'),
    t('settings.ytdlpPath'),
    t('settings.ytdlpCheckUpdate'),
    'yt-dlp',
    'ytdlp',
    'download'
  );

  const matchSoundfont = matchesSearch(
    t('settings.soundfont'),
    t('settings.soundfontOther'),
    t('settings.soundfontKindBundled'),
    t('settings.soundfontKindSystem'),
    'soundfont',
    'sf2',
    'midi',
    'altro'
  );
  const matchDevices = matchesSearch(
    t('settings.cueDevice'),
    t('settings.masterDevice'),
    'CUE',
    'master',
    'cuffie',
    'headphones',
    'dispositivo'
  );
  const matchAvSync = matchesSearch(
    t('settings.audioVideoSync'),
    'sync',
    'latency',
    'offset',
    'ms'
  );
  const matchVocalRemoverAlgo = matchesSearch(
    t('settings.vocalRemoverAlgorithm'),
    t('settings.vocalRemoverAlgorithmDesc'),
    'vocal',
    'rimozione',
    'algoritmo',
    'mid',
    'side',
    'center',
    'bass',
    'live'
  );
  const matchInstrumentalVocal = matchesSearch(
    t('settings.instrumentalVocalRemover'),
    t('settings.instrumentalVocalRemoverDesc'),
    t('settings.mdxAdvancedTitle'),
    t('settings.mdxSegmentSize'),
    t('settings.mdxOverlap'),
    t('settings.mdxEnableOrt'),
    t('settings.demucsAdvancedTitle'),
    t('settings.demucsShifts'),
    t('settings.demucsSegmentSize'),
    t('settings.demucsOverlap'),
    'instrumental',
    'strumentale',
    'ai',
    'mdx',
    'demucs',
    'download',
    'segment',
    'overlap',
    'onnx',
    'shifts'
  );
  // Same policy as modal “Remember my choice” (ask / always / never)
  const matchInstrumentalSubtitles = matchesSearch(
    t('settings.instrumentalSubtitlesPolicy'),
    t('settings.instrumentalSubtitlesPolicyDesc'),
    t('settings.instrumentalSubtitlesPolicyAsk'),
    t('settings.instrumentalSubtitlesPolicyAlways'),
    t('settings.instrumentalSubtitlesPolicyNever'),
    t('library.instrumentalSubtitlesRemember'),
    'subtitle',
    'subtitles',
    'sottotitoli',
    'sous-titres',
    'subtítulos',
    'instrumental',
    'strumentale',
    'remember',
    'ricorda',
    'ask',
    'always',
    'never'
  );
  const matchMaxDownloads = matchesSearch(
    t('settings.maxSimultaneousDownloads'),
    t('settings.maxSimultaneousDownloadsDesc'),
    'download',
    'simultaneous',
    'concurrent',
    'paralleli',
    'max'
  );
  const matchAiThreads = matchesSearch(
    t('settings.aiCpuThreads', 'Core CPU per AI strumentale'),
    t('settings.aiCpuThreadsDesc', 'Numero di core CPU usati da MDX / Demucs durante il download strumentale'),
    t('settings.aiCpuCoresAvailable', 'Core CPU disponibili: {{count}}', { count: cpuCoreCount }),
    t('settings.aiCpuThreadsResetMax', 'Reimposta su Massimo ({{count}})', { count: cpuCoreCount }),
    t('settings.mdxEnableOrt'),
    t('settings.mdxEnableOrtDesc'),
    t('settings.aiEnableGpu'),
    t('settings.aiEnableGpuDesc'),
    t('settings.aiGpuBadgeWasmWorker'),
    'cpu',
    'core',
    'threads',
    'ort',
    'onnx',
    'wasm',
    'gpu',
    'webgpu',
    'ai'
  );
  const matchNormalization = matchesSearch(
    t('settings.audioNormalization'),
    t('settings.audioNormalizationDesc'),
    'normalizzazione',
    'volume'
  );
  const matchDspEngine = matchesSearch(
    t('settings.dspEngine'),
    t('settings.dspEngineDesc'),
    'signalsmith',
    'bungee',
    'soundtouch',
    'pitch',
    'dsp',
    'tonalità',
    'wsola'
  );
  const matchAutoAdvance = matchesSearch(
    t('settings.autoAdvance'),
    t('settings.transitionPause'),
    'auto-advance',
    'transizione',
    'pausa'
  );

  const matchBannerIntro = matchesSearch(t('settings.bannerIntro'), 'banner', 'intro');
  const matchBannerOutro = matchesSearch(t('settings.bannerOutro'), 'banner', 'outro', 'preparati');
  const matchTitleOverlay = matchesSearch(t('settings.titleOverlayDuration'), 'titolo', 'overlay', 'title');
  const matchAutoStage = matchesSearch(
    t('settings.autoOpenStage', 'Apri Stage all\'avvio'),
    t('settings.autoOpenStageDesc', 'Apre automaticamente lo schermo Stage all\'avvio dell\'app'),
    'stage',
    'avvio',
    'launch',
    'apri'
  );
  const matchNextSinger = matchesSearch(
    t('settings.showNextSingerAtIntro'),
    t('settings.showNextSingerAtIntroDesc'),
    'prossimo',
    'cantante',
    'singer'
  );
  const matchPitchStage = matchesSearch(
    t('settings.showPitchOnStage'),
    t('settings.showPitchOnStageDesc'),
    'pitch',
    'tonalità',
    'semitoni'
  );
  const matchSpeedStage = matchesSearch(
    t('settings.showSpeedOnStage'),
    t('settings.showSpeedOnStageDesc'),
    'speed',
    'velocità',
    'tempo',
    'playback'
  );
  const matchStageMessages = matchesSearch(
    t('settings.stageMessagesTitle'),
    t('settings.stageMessagesDesc'),
    'ora canta',
    'preparati',
    'prossimo',
    'cantante',
    'banner',
    'message',
    'messaggio',
    'overlay'
  );

  // Full inventory (same as "?" help modal) so Settings search can find every live shortcut.
  const liveShortcuts = APP_SHORTCUTS.map((s) => ({
    keys: s.keys,
    label: t(s.descriptionKey)
  }));

  const matchingShortcuts = liveShortcuts.filter((item) =>
    matchesSearch(item.label, item.keys.join(' '), t('settings.tabShortcuts', 'Scorciatoie'), 'scorciatoie', 'shortcuts')
  );

  const showCategory = (tab: SettingsTab, hasMatches: boolean) => {
    if (isSearching) return hasMatches;
    return activeTab === tab;
  };

  const generalHasMatches =
    matchSupport ||
    matchThemeLang ||
    matchMaximize ||
    matchFairQueue ||
    matchGuestPortal ||
    matchSiae ||
    matchLogs;
  const libraryHasMatches =
    matchLibraryPath ||
    matchAutoArchive ||
    matchYtdlp ||
    matchMaxDownloads ||
    matchInstrumentalVocal ||
    matchInstrumentalSubtitles ||
    matchAiThreads;
  const audioHasMatches =
    matchSoundfont ||
    matchDevices ||
    matchAvSync ||
    matchVocalRemoverAlgo ||
    matchNormalization ||
    matchAutoAdvance;
  const stageHasMatches =
    matchBannerIntro ||
    matchBannerOutro ||
    matchTitleOverlay ||
    matchAutoStage ||
    matchNextSinger ||
    matchPitchStage ||
    matchSpeedStage ||
    matchStageMessages;
  const shortcutsHasMatches = matchingShortcuts.length > 0;

  const anySearchResults =
    generalHasMatches || libraryHasMatches || audioHasMatches || stageHasMatches || shortcutsHasMatches;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-5xl w-full p-6 shadow-2xl flex flex-col h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800 shrink-0">
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

        {/* PayPal support banner — always visible above search, all tabs */}
        <div className="pt-4 pb-0 shrink-0">
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

        {/* Instant search */}
        <div className="pt-4 pb-3 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={settingsSearch}
              onChange={(e) => setSettingsSearch(e.target.value)}
              placeholder={t('settings.searchPlaceholder', 'Cerca impostazioni...')}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 transition-all"
            />
          </div>
        </div>

        {/* Sidebar tabs + scrollable content */}
        <div className="flex flex-1 min-h-0 border-t border-slate-800/80">
          {!isSearching && (
            <nav className="w-[220px] shrink-0 border-r border-slate-800/80 overflow-y-auto py-3 pr-3 space-y-1">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full px-3 py-2.5 rounded-xl text-[11px] font-semibold flex items-center gap-2 transition-all border text-left ${
                      isActive
                        ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'
                        : 'bg-transparent border-transparent text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    {tab.icon}
                    <span className="leading-snug">{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          )}

          {/* Form Body */}
          <div className={`flex-1 min-h-0 overflow-y-auto py-4 space-y-6 text-xs ${isSearching ? '' : 'pl-4'} pr-2 md:pr-3`}>
          {isSearching && !anySearchResults && (
            <div className="text-center py-10 text-slate-400 text-xs">
              {t('library.noResults', 'Nessun risultato')}
            </div>
          )}

          {showCategory('general', generalHasMatches) && (
            <SettingsGeneralTab
              t={t}
              i18n={i18n}
              settings={settings}
              updateSettings={updateSettings}
              isSearching={isSearching}
              matchThemeLang={matchThemeLang}
              matchMaximize={matchMaximize}
              matchFairQueue={matchFairQueue}
              matchGuestPortal={matchGuestPortal}
              matchSiae={matchSiae}
              matchLogs={matchLogs}
              portalInfo={portalInfo}
              logFilePath={logFilePath}
              handleExportSiae={handleExportSiae}
              handleOpenLogFolder={handleOpenLogFolder}
              handleOpenLogFile={handleOpenLogFile}
              handleClearLogs={handleClearLogs}
            />
          )}

          {showCategory('library', libraryHasMatches) && (
            <SettingsLibraryTab
              t={t}
              settings={settings}
              updateSettings={updateSettings}
              isSearching={isSearching}
              matchLibraryPath={matchLibraryPath}
              matchAutoArchive={matchAutoArchive}
              matchMaxDownloads={matchMaxDownloads}
              matchInstrumentalVocal={matchInstrumentalVocal}
              matchInstrumentalSubtitles={matchInstrumentalSubtitles}
              matchAiThreads={matchAiThreads}
              matchYtdlp={matchYtdlp}
              cpuCoreCount={cpuCoreCount}
              gpuStatus={gpuStatus}
              isCheckingYtdlp={isCheckingYtdlp}
              ytdlpStatus={ytdlpStatus}
              ytdlpMessage={ytdlpMessage}
              setShowAutoArchiveConfirm={setShowAutoArchiveConfirm}
              handleSelectLibraryPath={handleSelectLibraryPath}
              handleCheckYtDlpUpdate={handleCheckYtDlpUpdate}
            />
          )}

          {showCategory('audio', audioHasMatches) && (
            <SettingsAudioTab
              t={t}
              settings={settings}
              updateSettings={updateSettings}
              isSearching={isSearching}
              matchSoundfont={matchSoundfont}
              matchDevices={matchDevices}
              matchAvSync={matchAvSync}
              matchDspEngine={matchDspEngine}
              matchVocalRemoverAlgo={matchVocalRemoverAlgo}
              matchNormalization={matchNormalization}
              matchAutoAdvance={matchAutoAdvance}
              audioDevices={audioDevices}
              defaultSystemSf={defaultSystemSf}
              soundFontCatalog={soundFontCatalog}
              soundFontSelectValue={soundFontSelectValue}
              handleResetDefaultSoundFont={handleResetDefaultSoundFont}
              handleSoundFontSelectChange={handleSoundFontSelectChange}
              handleSelectSoundFont={handleSelectSoundFont}
            />
          )}

          {showCategory('stage', stageHasMatches) && (
            <SettingsStageTab
              t={t}
              settings={settings}
              updateSettings={updateSettings}
              isSearching={isSearching}
              matchAutoStage={matchAutoStage}
              matchBannerIntro={matchBannerIntro}
              matchBannerOutro={matchBannerOutro}
              matchTitleOverlay={matchTitleOverlay}
              matchNextSinger={matchNextSinger}
              matchPitchStage={matchPitchStage}
              matchSpeedStage={matchSpeedStage}
              matchStageMessages={matchStageMessages}
            />
          )}

          {showCategory('shortcuts', shortcutsHasMatches) && (
            <SettingsShortcutsTab
              t={t}
              isSearching={isSearching}
              liveShortcuts={liveShortcuts}
              matchingShortcuts={matchingShortcuts}
            />
          )}
          </div>
        </div>

        {/* Footer & Branding */}
        <div className="pt-4 border-t border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <img src={appLogo} alt="Logo" className="w-9 h-9 object-contain drop-shadow" />
            <div>
              <p className="text-xs font-bold text-white leading-tight">Karaoke Live Station</p>
              <p className="text-[10px] text-slate-400">v{appVersion} • Professional Karaoke Suite</p>
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

      {/* Auto-Archive Deactivation Mandatory Warning Confirmation Modal */}
      {showAutoArchiveConfirm && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[60] flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-amber-500/60 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 animate-scaleUp">
            <div className="flex items-center gap-3 text-amber-400">
              <AlertTriangle className="w-6 h-6 shrink-0 text-amber-400" />
              <h3 className="font-bold text-base text-white">
                {t('settings.autoArchiveWarningTitle', 'Attenzione disattivazione archiviazione automatica')}
              </h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/70 p-4 rounded-xl border border-slate-800">
              {t(
                'settings.autoArchiveWarningDesc',
                "Attenzione: disattivando l'archiviazione automatica, i brani scaricati non verranno salvati nella libreria permanente. Rimarranno disponibili nella cache temporanea solo finché sono presenti in coda (anche riavviando l'app) e verranno eliminati dal disco solo quando saranno scodati o la coda verrà svuotata."
              )}
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowAutoArchiveConfirm(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors"
              >
                {t('common.cancel', 'Annulla')}
              </button>
              <button
                type="button"
                onClick={() => {
                  updateSettings({ autoArchiveWebTracks: false });
                  setShowAutoArchiveConfirm(false);
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 shadow-md shadow-amber-900/30 transition-colors"
              >
                {t('settings.confirmDisableAutoArchive', 'Conferma disattivazione')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
