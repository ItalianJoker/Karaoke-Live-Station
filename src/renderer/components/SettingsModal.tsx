import React, { useState, useEffect } from 'react';
import { showToast, confirmAsync } from '../utils/toast';
import { useTranslation } from 'react-i18next';
import {
  X,
  Folder,
  FolderOpen,
  Download,
  Settings,
  Volume2,
  Globe,
  ShieldCheck,
  Headphones,
  FileText,
  Terminal,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Heart,
  Coffee,
  ExternalLink,
  Search,
  Keyboard,
  Monitor,
  Music2,
  Library,
  Cpu,
  AudioLines,
  Info,
} from 'lucide-react';
import { useKaraokeStore } from '../store/karaokeStore';
import { AppTheme, StageMessageStyle, YtDlpStatus } from '../../shared/types';
import { textMatchesSearch } from '../../shared/textNormalize';
import {
  SOUND_FONT_OTHER_OPTION_ID,
  soundFontPathsEqual,
  type SoundFontCatalogEntry
} from '../../shared/soundFontPath';
import {
  STAGE_MESSAGE_KEYS,
  StageMessageKey,
  createDefaultStageMessages,
  mergeStageMessages,
  patchStageMessages
} from '../../shared/stageMessages';
import {
  clampAiCpuThreadsForUi,
  coerceAiCpuThreads,
  detectUiCpuCoreCount
} from '../../shared/aiCpuThreads';
import { APP_SHORTCUTS } from '../data/appShortcuts';
import { FirewallGuideCard } from './FirewallGuideCard';
import {
  coerceAlgorithmicVocalRemoverMethod,
  coerceInstrumentalVocalRemoverMethod
} from '../../shared/vocalRemover';
import {
  coerceMdxEnableOrt,
  coerceMdxOverlap,
  coerceMdxSegmentSize,
  MDX_OVERLAP_MAX,
  MDX_OVERLAP_MIN,
  MDX_OVERLAP_STEP,
  MDX_OVERLAP_WARN_THRESHOLD,
  MDX_SEGMENT_SIZES,
  isMdxInstrumentalMethod
} from '../../shared/mdxAdvancedSettings';
import {
  coerceDemucsOverlap,
  coerceDemucsSegmentSize,
  coerceDemucsShifts,
  DEMUCS_OVERLAP_MAX,
  DEMUCS_OVERLAP_MIN,
  DEMUCS_OVERLAP_STEP,
  DEMUCS_SEGMENT_MAX,
  DEMUCS_SEGMENT_MIN,
  DEMUCS_SHIFTS_OPTIONS,
  isDemucsInstrumentalMethod
} from '../../shared/demucsAdvancedSettings';
import { coerceAiEnableGpu } from '../../shared/aiOrtProviders';
import type { GpuStatus } from '../../shared/gpuStatus';
import { coerceDspPitchEngine, type DspPitchEngine } from '../../shared/dspPitch';
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

type SettingsTab = 'general' | 'library' | 'audio' | 'stage' | 'shortcuts';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * SettingsModal
 *
 * Comprehensive Preferences and Hardware Configuration Modal.
 * Organized in thematic tabs with instant cross-category search.
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
    t('settings.aiEnableGpu'),
    t('settings.aiEnableGpuDesc'),
    'cpu',
    'core',
    'threads',
    'ort',
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

          {/* ===== GENERALE ===== */}
          {showCategory('general', generalHasMatches) && (
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
            </div>
          )}

          {/* ===== LIBRERIA & DOWNLOAD ===== */}
          {showCategory('library', libraryHasMatches) && (
            <div className="space-y-4">
              <h3 className="font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Library className="w-4 h-4 text-emerald-400" />
                {t('settings.tabLibrary', 'Libreria & Download')}
              </h3>

              {(!isSearching || matchLibraryPath) && (
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
              )}

              {(!isSearching || matchAutoArchive) && (
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.autoArchiveWebTracks}
                    onChange={(e) => {
                      if (!e.target.checked) {
                        setShowAutoArchiveConfirm(true);
                      } else {
                        updateSettings({ autoArchiveWebTracks: true });
                      }
                    }}
                    className="w-4 h-4 accent-indigo-600 rounded"
                  />
                  <span>{t('settings.autoArchive')}</span>
                </label>
              )}

              {(!isSearching || matchMaxDownloads) && (
                <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800/80 space-y-2">
                  <label className="block font-semibold text-white text-xs">
                    {t('settings.maxSimultaneousDownloads')}
                  </label>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {t('settings.maxSimultaneousDownloadsDesc')}
                  </p>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={1}
                      max={8}
                      step={1}
                      value={Math.min(8, Math.max(1, settings.maxSimultaneousDownloads || 2))}
                      onChange={(e) =>
                        updateSettings({
                          maxSimultaneousDownloads: Math.min(
                            8,
                            Math.max(1, parseInt(e.target.value, 10) || 2)
                          )
                        })
                      }
                      className="flex-1 accent-indigo-600"
                    />
                    <span className="text-xs font-mono text-indigo-300 w-6 text-right">
                      {Math.min(8, Math.max(1, settings.maxSimultaneousDownloads || 2))}
                    </span>
                  </div>
                </div>
              )}

              {(!isSearching || matchInstrumentalVocal) && (
                <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800/80 space-y-2">
                  <label className="block font-semibold text-white text-xs">
                    {t('settings.instrumentalVocalRemover')}
                  </label>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {t('settings.instrumentalVocalRemoverDesc')}
                  </p>
                  <select
                    value={coerceInstrumentalVocalRemoverMethod(
                      settings.instrumentalVocalRemoverMethod
                    )}
                    onChange={(e) => {
                      const next = coerceInstrumentalVocalRemoverMethod(e.target.value);
                      const prev = coerceInstrumentalVocalRemoverMethod(
                        settings.instrumentalVocalRemoverMethod
                      );
                      updateSettings({ instrumentalVocalRemoverMethod: next });
                      if (prev !== next && window.karaokeApi?.logger?.log) {
                        window.karaokeApi.logger.log(
                          'info',
                          'SettingsModal',
                          `Instrumental vocal remover method → ${next}`
                        );
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-xs"
                  >
                    <option value="aiMdxKaraoke2">{t('settings.vocalAiMdxKaraoke2')}</option>
                    <option value="aiHtDemucs">{t('settings.vocalAiHtDemucs')}</option>
                  </select>

                  {/* MDX-only advanced ETA panel — hidden for Demucs */}
                  {isMdxInstrumentalMethod(
                    coerceInstrumentalVocalRemoverMethod(settings.instrumentalVocalRemoverMethod)
                  ) && (
                    <div className="mt-3 pt-3 border-t border-slate-800/80 space-y-3">
                      <div>
                        <p className="font-semibold text-white text-xs">
                          {t('settings.mdxAdvancedTitle')}
                        </p>
                        <p className="text-[11px] text-slate-400 leading-relaxed mt-1">
                          {t('settings.mdxAdvancedDesc')}
                        </p>
                      </div>

                      {/* A. Segment size (dim_t) */}
                      <div className="space-y-1.5">
                        <label
                          className="block text-[11px] font-medium text-slate-200"
                          title={t('settings.mdxSegmentSizeTooltip')}
                        >
                          {t('settings.mdxSegmentSize')}
                          <span className="ml-2 font-mono text-indigo-300">
                            {coerceMdxSegmentSize(settings.mdxSegmentSize)}
                          </span>
                        </label>
                        <p className="text-[10px] text-slate-400 leading-relaxed">
                          {t('settings.mdxSegmentSizeTooltip')}
                        </p>
                        <input
                          type="range"
                          min={0}
                          max={MDX_SEGMENT_SIZES.length - 1}
                          step={1}
                          value={Math.max(
                            0,
                            MDX_SEGMENT_SIZES.indexOf(
                              coerceMdxSegmentSize(settings.mdxSegmentSize) as (typeof MDX_SEGMENT_SIZES)[number]
                            )
                          )}
                          onChange={(e) => {
                            const idx = parseInt(e.target.value, 10);
                            const next = MDX_SEGMENT_SIZES[idx] ?? 256;
                            updateSettings({ mdxSegmentSize: coerceMdxSegmentSize(next) });
                          }}
                          className="w-full accent-indigo-600"
                        />
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => updateSettings({ mdxSegmentSize: 256 })}
                            className={`px-2 py-0.5 rounded text-[10px] border ${
                              coerceMdxSegmentSize(settings.mdxSegmentSize) === 256
                                ? 'border-indigo-500 bg-indigo-950/60 text-indigo-200'
                                : 'border-slate-700 text-slate-400 hover:border-slate-500'
                            }`}
                          >
                            {t('settings.mdxSegmentChip256')}
                          </button>
                          <button
                            type="button"
                            onClick={() => updateSettings({ mdxSegmentSize: 512 })}
                            className={`px-2 py-0.5 rounded text-[10px] border ${
                              coerceMdxSegmentSize(settings.mdxSegmentSize) === 512
                                ? 'border-indigo-500 bg-indigo-950/60 text-indigo-200'
                                : 'border-slate-700 text-slate-400 hover:border-slate-500'
                            }`}
                          >
                            {t('settings.mdxSegmentChip512')}
                          </button>
                        </div>
                      </div>

                      {/* B. Overlap fraction → mdxStepSamples */}
                      <div className="space-y-1.5">
                        <label
                          className="block text-[11px] font-medium text-slate-200"
                          title={t('settings.mdxOverlapTooltip')}
                        >
                          {t('settings.mdxOverlap')}
                          <span className="ml-2 font-mono text-indigo-300">
                            {coerceMdxOverlap(settings.mdxOverlap).toFixed(2)}
                          </span>
                        </label>
                        <p className="text-[10px] text-slate-400 leading-relaxed">
                          {t('settings.mdxOverlapTooltip')}
                        </p>
                        <input
                          type="range"
                          min={MDX_OVERLAP_MIN}
                          max={MDX_OVERLAP_MAX}
                          step={MDX_OVERLAP_STEP}
                          value={coerceMdxOverlap(settings.mdxOverlap)}
                          onChange={(e) =>
                            updateSettings({
                              mdxOverlap: coerceMdxOverlap(parseFloat(e.target.value))
                            })
                          }
                          className="w-full accent-indigo-600"
                        />
                        <div className="flex flex-wrap gap-1.5">
                          {(
                            [
                              [0.25, 'settings.mdxOverlapChip025'],
                              [0.5, 'settings.mdxOverlapChip050'],
                              [0.75, 'settings.mdxOverlapChip075']
                            ] as const
                          ).map(([value, labelKey]) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() =>
                                updateSettings({ mdxOverlap: coerceMdxOverlap(value) })
                              }
                              className={`px-2 py-0.5 rounded text-[10px] border ${
                                Math.abs(coerceMdxOverlap(settings.mdxOverlap) - value) < 0.001
                                  ? 'border-indigo-500 bg-indigo-950/60 text-indigo-200'
                                  : 'border-slate-700 text-slate-400 hover:border-slate-500'
                              }`}
                            >
                              {t(labelKey)}
                            </button>
                          ))}
                        </div>
                        {coerceMdxOverlap(settings.mdxOverlap) >= MDX_OVERLAP_WARN_THRESHOLD && (
                          <div className="flex items-start gap-1.5 rounded-lg border border-amber-700/60 bg-amber-950/40 px-2 py-1.5 text-[10px] text-amber-200 leading-relaxed">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                            <span>{t('settings.mdxOverlapHighWarning')}</span>
                          </div>
                        )}
                      </div>

                      {/* C. ORT WASM CPU acceleration */}
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={coerceMdxEnableOrt(settings.mdxEnableOrt)}
                          onChange={(e) =>
                            updateSettings({ mdxEnableOrt: coerceMdxEnableOrt(e.target.checked) })
                          }
                          className="w-4 h-4 accent-indigo-600 rounded mt-0.5"
                        />
                        <div>
                          <span className="block text-[11px] font-medium text-slate-200">
                            {t('settings.mdxEnableOrt')}
                          </span>
                          <span className="block text-[10px] text-slate-400 leading-relaxed mt-0.5">
                            {t('settings.mdxEnableOrtDesc')}
                          </span>
                        </div>
                      </label>
                    </div>
                  )}

                  {/* Demucs-only advanced panel — hidden for MDX */}
                  {isDemucsInstrumentalMethod(
                    coerceInstrumentalVocalRemoverMethod(settings.instrumentalVocalRemoverMethod)
                  ) && (
                    <div className="mt-3 pt-3 border-t border-slate-800/80 space-y-3">
                      <div>
                        <p className="font-semibold text-white text-xs">
                          {t('settings.demucsAdvancedTitle')}
                        </p>
                        <p className="text-[11px] text-slate-400 leading-relaxed mt-1">
                          {t('settings.demucsAdvancedDesc')}
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <label className="block text-[11px] font-medium text-slate-200">
                          {t('settings.demucsShifts')}
                          <span className="ml-2 font-mono text-indigo-300">
                            {coerceDemucsShifts(settings.demucsShifts)}
                          </span>
                        </label>
                        <p className="text-[10px] text-slate-400 leading-relaxed">
                          {t('settings.demucsShiftsDesc')}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {DEMUCS_SHIFTS_OPTIONS.map((value) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() =>
                                updateSettings({ demucsShifts: coerceDemucsShifts(value) })
                              }
                              className={`px-2 py-0.5 rounded text-[10px] border ${
                                coerceDemucsShifts(settings.demucsShifts) === value
                                  ? 'border-indigo-500 bg-indigo-950/60 text-indigo-200'
                                  : 'border-slate-700 text-slate-400 hover:border-slate-500'
                              }`}
                            >
                              {value}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="block text-[11px] font-medium text-slate-200">
                          {t('settings.demucsSegmentSize')}
                          <span className="ml-2 font-mono text-indigo-300">
                            {coerceDemucsSegmentSize(settings.demucsSegmentSize).toFixed(1)}s
                          </span>
                        </label>
                        <p className="text-[10px] text-slate-400 leading-relaxed">
                          {t('settings.demucsSegmentSizeDesc')}
                        </p>
                        <input
                          type="range"
                          min={DEMUCS_SEGMENT_MIN}
                          max={DEMUCS_SEGMENT_MAX}
                          step={0.5}
                          value={coerceDemucsSegmentSize(settings.demucsSegmentSize)}
                          onChange={(e) =>
                            updateSettings({
                              demucsSegmentSize: coerceDemucsSegmentSize(parseFloat(e.target.value))
                            })
                          }
                          className="w-full accent-indigo-600"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="block text-[11px] font-medium text-slate-200">
                          {t('settings.demucsOverlap')}
                          <span className="ml-2 font-mono text-indigo-300">
                            {coerceDemucsOverlap(settings.demucsOverlap).toFixed(2)}
                          </span>
                        </label>
                        <p className="text-[10px] text-slate-400 leading-relaxed">
                          {t('settings.demucsOverlapDesc')}
                        </p>
                        <input
                          type="range"
                          min={DEMUCS_OVERLAP_MIN}
                          max={DEMUCS_OVERLAP_MAX}
                          step={DEMUCS_OVERLAP_STEP}
                          value={coerceDemucsOverlap(settings.demucsOverlap)}
                          onChange={(e) =>
                            updateSettings({
                              demucsOverlap: coerceDemucsOverlap(parseFloat(e.target.value))
                            })
                          }
                          className="w-full accent-indigo-600"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {(!isSearching || matchAiThreads) && (() => {
                const aiCpuThreadsUi =
                  settings.aiCpuThreads == null
                    ? cpuCoreCount
                    : clampAiCpuThreadsForUi(settings.aiCpuThreads, cpuCoreCount);
                const gpuOn = coerceAiEnableGpu(settings.aiEnableGpu);
                const gpuSupported = gpuStatus?.isSupported === true;
                const gpuLabel =
                  gpuSupported && gpuStatus?.gpuName
                    ? gpuStatus.gpuName
                    : gpuSupported
                      ? t('settings.aiGpuBadgeSupported')
                      : t('settings.aiGpuBadgeCpuFallback');
                return (
                  <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800/80 space-y-3">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={gpuOn}
                        onChange={(e) =>
                          updateSettings({ aiEnableGpu: coerceAiEnableGpu(e.target.checked) })
                        }
                        className="w-4 h-4 accent-indigo-600 rounded mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="block text-xs font-semibold text-white">
                          {t('settings.aiEnableGpu')}
                        </span>
                        <span className="block text-[11px] text-slate-400 leading-relaxed mt-0.5">
                          {t('settings.aiEnableGpuDesc')}
                        </span>
                        <div
                          className={`mt-2 inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-medium ${
                            gpuOn && gpuSupported
                              ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-200'
                              : 'border-amber-700/60 bg-amber-950/40 text-amber-200'
                          }`}
                          title={gpuStatus?.vendor || undefined}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              gpuOn && gpuSupported ? 'bg-emerald-400' : 'bg-amber-400'
                            }`}
                          />
                          {gpuOn && gpuSupported
                            ? t('settings.aiGpuBadgeGpu', { name: gpuLabel })
                            : t('settings.aiGpuBadgeCpu', { detail: gpuLabel })}
                        </div>
                      </div>
                    </label>

                    <label className="block font-semibold text-white text-xs flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                      {t('settings.aiCpuThreads', 'Core CPU per AI strumentale')}
                    </label>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      {t(
                        'settings.aiCpuThreadsDesc',
                        'Numero di core CPU usati da MDX / Demucs durante il download strumentale'
                      )}
                    </p>
                    <p className="text-[11px] text-slate-300 font-medium">
                      {t('settings.aiCpuCoresAvailable', 'Core CPU disponibili: {{count}}', {
                        count: cpuCoreCount
                      })}
                    </p>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={1}
                        max={cpuCoreCount}
                        step={1}
                        value={aiCpuThreadsUi}
                        onChange={(e) => {
                          const clamped = clampAiCpuThreadsForUi(
                            parseInt(e.target.value, 10),
                            cpuCoreCount
                          );
                          updateSettings({ aiCpuThreads: clamped });
                        }}
                        className="flex-1 accent-indigo-600"
                      />
                      <input
                        type="number"
                        min={1}
                        max={cpuCoreCount}
                        value={aiCpuThreadsUi}
                        onChange={(e) => {
                          const clamped = clampAiCpuThreadsForUi(
                            parseInt(e.target.value, 10),
                            cpuCoreCount
                          );
                          updateSettings({ aiCpuThreads: clamped });
                        }}
                        className="w-16 bg-slate-950 border border-slate-800 rounded-lg p-1.5 text-white text-center text-xs font-mono"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => updateSettings({ aiCpuThreads: coerceAiCpuThreads(null) })}
                      className="text-[11px] text-indigo-400 hover:text-indigo-300 underline font-medium cursor-pointer"
                    >
                      {t('settings.aiCpuThreadsResetMax', 'Reimposta su Massimo ({{count}})', {
                        count: cpuCoreCount
                      })}
                    </button>
                  </div>
                );
              })()}

              {(!isSearching || matchYtdlp) && (
                <div className="space-y-3 pt-1">
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
                        <span className="text-slate-400 text-[11px] block">{t('settings.ytdlpPath')}:</span>
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
              )}
            </div>
          )}

          {/* ===== AUDIO & RIPRODUZIONE ===== */}
          {showCategory('audio', audioHasMatches) && (
            <div className="space-y-4">
              <h3 className="font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Volume2 className="w-4 h-4 text-emerald-400" />
                {t('settings.tabAudio', 'Audio & Riproduzione')}
              </h3>

              {(!isSearching || matchSoundfont) && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <label className="text-slate-400 font-medium">{t('settings.soundfont')}</label>
                      {settings.midiSoundFontPath &&
                        defaultSystemSf &&
                        soundFontPathsEqual(settings.midiSoundFontPath, defaultSystemSf) && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-800/80 text-emerald-400 text-[10px] font-semibold">
                          {t('settings.soundfontDefaultBadge')}
                        </span>
                      )}
                    </div>
                    {defaultSystemSf &&
                      settings.midiSoundFontPath &&
                      !soundFontPathsEqual(settings.midiSoundFontPath, defaultSystemSf) && (
                      <button
                        type="button"
                        onClick={handleResetDefaultSoundFont}
                        className="text-[11px] text-indigo-400 hover:text-indigo-300 underline font-medium cursor-pointer"
                      >
                        {t('settings.soundfontUseDefault')}
                      </button>
                    )}
                  </div>
                  <select
                    value={soundFontSelectValue}
                    onChange={(e) => {
                      void handleSoundFontSelectChange(e.target.value);
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white text-sm"
                    aria-label={t('settings.soundfont')}
                  >
                    {soundFontCatalog.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.displayName}
                        {entry.kind === 'bundled'
                          ? ` (${t('settings.soundfontKindBundled')})`
                          : ` (${t('settings.soundfontKindSystem')})`}
                      </option>
                    ))}
                    <option value={SOUND_FONT_OTHER_OPTION_ID}>
                      {t('settings.soundfontOther')}
                    </option>
                  </select>
                  {soundFontSelectValue === SOUND_FONT_OTHER_OPTION_ID && (
                    <div className="mt-2 flex gap-2">
                      <input
                        type="text"
                        readOnly
                        value={settings.midiSoundFontPath || ''}
                        placeholder={t('midi.noSoundfontSelected')}
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white text-xs font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          void handleSelectSoundFont();
                        }}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl flex items-center gap-1.5 font-semibold transition-colors"
                      >
                        <FolderOpen className="w-4 h-4 text-amber-400" />
                        {t('settings.browse')}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {(!isSearching || matchDevices) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
              )}

              {(!isSearching || matchAvSync) && (
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
              )}


              {(!isSearching || matchDspEngine) && (
                <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800/80 space-y-2">
                  <label className="block font-semibold text-white text-xs flex items-center gap-1.5">
                    <AudioLines className="w-3.5 h-3.5 text-cyan-400" />
                    {t('settings.dspEngine')}
                    <span
                      className="inline-flex text-slate-400"
                      title={t('settings.dspEngineCompareBody')}
                    >
                      <Info className="w-3.5 h-3.5" />
                    </span>
                  </label>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {t('settings.dspEngineDesc')}
                  </p>
                  <select
                    value={coerceDspPitchEngine(settings.dspEngine)}
                    onChange={(e) => {
                      const next = coerceDspPitchEngine(e.target.value as DspPitchEngine);
                      updateSettings({ dspEngine: next });
                      if (window.karaokeApi?.logger?.log) {
                        window.karaokeApi.logger.log(
                          'info',
                          'SettingsModal',
                          `DSP pitch engine → ${next}`
                        );
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-xs"
                  >
                    <option value="bungee">{t('settings.dspEngineBungee')}</option>
                    <option value="soundtouch">{t('settings.dspEngineSoundTouch')}</option>
                  </select>
                  <div className="text-[11px] text-slate-400 leading-relaxed space-y-1 border-t border-slate-800/80 pt-2">
                    <p>
                      <span className="text-indigo-300 font-semibold">Bungee</span>
                      {' — '}
                      {t('settings.dspEngineBungeeBlurb')}
                    </p>
                    <p>
                      <span className="text-amber-300 font-semibold">SoundTouch</span>
                      {' — '}
                      {t('settings.dspEngineSoundTouchBlurb')}
                    </p>
                    <p className="text-slate-500">{t('settings.dspEngineMidiNote')}</p>
                  </div>
                </div>
              )}

              {(!isSearching || matchVocalRemoverAlgo) && (
                <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800/80 space-y-2">
                  <label className="block font-semibold text-white text-xs">
                    {t('settings.vocalRemoverAlgorithm')}
                  </label>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {t('settings.vocalRemoverAlgorithmDesc')}
                  </p>
                  <select
                    value={coerceAlgorithmicVocalRemoverMethod(settings.vocalRemoverAlgorithm)}
                    onChange={(e) => {
                      const next = coerceAlgorithmicVocalRemoverMethod(e.target.value);
                      const prev = coerceAlgorithmicVocalRemoverMethod(
                        settings.vocalRemoverAlgorithm
                      );
                      updateSettings({ vocalRemoverAlgorithm: next });
                      if (prev !== next && window.karaokeApi?.logger?.log) {
                        window.karaokeApi.logger.log(
                          'info',
                          'SettingsModal',
                          `Live vocal remover method → ${next}`
                        );
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white text-xs"
                  >
                    <option value="centerCancelBassKeep">{t('settings.vocalAlgoCenterBass')}</option>
                    <option value="centerCancel">{t('settings.vocalAlgoCenter')}</option>
                    <option value="softMid">{t('settings.vocalAlgoSoftMid')}</option>
                  </select>
                </div>
              )}

              {(!isSearching || matchNormalization) && (
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
              )}

              {(!isSearching || matchAutoAdvance) && (
                <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.autoAdvanceNext}
                      onChange={(e) => updateSettings({ autoAdvanceNext: e.target.checked })}
                      className="w-4 h-4 accent-indigo-600 rounded"
                    />
                    <span className="font-semibold text-white">{t('settings.autoAdvance')}</span>
                  </label>
                  <div className={settings.autoAdvanceNext ? 'opacity-100' : 'opacity-50 pointer-events-none'}>
                    <label className="block text-slate-400 mb-1 text-xs">
                      {t('settings.transitionPause')}
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="0"
                        max="15"
                        step="1"
                        value={settings.transitionPauseSec}
                        onChange={(e) =>
                          updateSettings({ transitionPauseSec: parseInt(e.target.value, 10) || 0 })
                        }
                        className="flex-1 accent-indigo-600"
                      />
                      <input
                        type="number"
                        min="0"
                        max="15"
                        value={settings.transitionPauseSec}
                        onChange={(e) =>
                          updateSettings({ transitionPauseSec: parseInt(e.target.value, 10) || 0 })
                        }
                        className="w-16 bg-slate-950 border border-slate-800 rounded-lg p-1.5 text-white text-center"
                      />
                      <span className="text-xs text-slate-400">sec</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== SCHERMO STAGE ===== */}
          {showCategory('stage', stageHasMatches) && (
            <div className="space-y-4">
              <h3 className="font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Monitor className="w-4 h-4 text-amber-400" />
                {t('settings.tabStage', 'Schermo Stage')}
              </h3>

              {(!isSearching || matchAutoStage) && (
                <label className="flex items-start gap-3 cursor-pointer bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800/80">
                  <input
                    type="checkbox"
                    checked={settings.autoOpenStageOnLaunch ?? true}
                    onChange={(e) => updateSettings({ autoOpenStageOnLaunch: e.target.checked })}
                    className="w-4 h-4 accent-indigo-600 rounded mt-0.5"
                  />
                  <div>
                    <span className="font-semibold text-white text-xs block">
                      {t('settings.autoOpenStage', 'Apri Stage all\'avvio')}
                    </span>
                    <span className="text-[11px] text-slate-400 leading-relaxed block mt-0.5">
                      {t(
                        'settings.autoOpenStageDesc',
                        'Apre automaticamente lo schermo Stage all\'avvio dell\'app'
                      )}
                    </span>
                  </div>
                </label>
              )}

              {(
                !isSearching ||
                matchBannerIntro ||
                matchBannerOutro ||
                matchTitleOverlay
              ) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {(!isSearching || matchBannerIntro) && (
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
                  )}

                  {(!isSearching || matchBannerOutro) && (
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
                  )}

                  {(!isSearching || matchTitleOverlay) && (
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
                  )}
                </div>
              )}

              {(
                !isSearching ||
                matchNextSinger ||
                matchPitchStage ||
                matchSpeedStage
              ) && (
                <div className="pt-2 border-t border-slate-800/80 space-y-3">
                  {(!isSearching || matchNextSinger) && (
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
                  )}

                  {(!isSearching || matchPitchStage) && (
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.showPitchOnStage ?? true}
                        onChange={(e) => updateSettings({ showPitchOnStage: e.target.checked })}
                        className="w-4 h-4 accent-indigo-600 rounded mt-0.5"
                      />
                      <div>
                        <span className="text-sm font-medium text-slate-200 block">{t('settings.showPitchOnStage')}</span>
                        <span className="text-xs text-slate-400 block mt-0.5">{t('settings.showPitchOnStageDesc')}</span>
                      </div>
                    </label>
                  )}

                  {(!isSearching || matchSpeedStage) && (
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.showSpeedOnStage ?? true}
                        onChange={(e) => updateSettings({ showSpeedOnStage: e.target.checked })}
                        className="w-4 h-4 accent-indigo-600 rounded mt-0.5"
                      />
                      <div>
                        <span className="text-sm font-medium text-slate-200 block">{t('settings.showSpeedOnStage')}</span>
                        <span className="text-xs text-slate-400 block mt-0.5">{t('settings.showSpeedOnStageDesc')}</span>
                      </div>
                    </label>
                  )}
                </div>
              )}

              {(!isSearching || matchStageMessages) && (
                <div
                  className="pt-2 border-t border-slate-800/80 space-y-3"
                  data-testid="settings-stage-messages"
                >
                  <div>
                    <h4 className="text-sm font-semibold text-slate-200">
                      {t('settings.stageMessagesTitle')}
                    </h4>
                    <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                      {t('settings.stageMessagesDesc')}
                    </p>
                  </div>

                  {(() => {
                    const stageMessages = mergeStageMessages(settings.stageMessages);
                    const updateStageMessage = (
                      key: StageMessageKey,
                      patch: Partial<StageMessageStyle>
                    ) => {
                      updateSettings({
                        stageMessages: patchStageMessages(settings.stageMessages, {
                          [key]: { ...stageMessages[key], ...patch }
                        })
                      });
                    };
                    const labelKey: Record<StageMessageKey, string> = {
                      nowSinging: 'settings.stageMessageNowSinging',
                      getReady: 'settings.stageMessageGetReady',
                      upNextIntro: 'settings.stageMessageUpNextIntro',
                      nextSong: 'settings.stageMessageNextSong',
                      nextSingerUnassigned: 'settings.stageMessageNextSingerUnassigned',
                      upNextOnStage: 'settings.stageMessageUpNextOnStage',
                      followingSinger: 'settings.stageMessageFollowingSinger'
                    };
                    const bannerKey: Record<StageMessageKey, string> = {
                      nowSinging: 'banner.nowSinging',
                      getReady: 'banner.getReady',
                      upNextIntro: 'banner.upNextIntro',
                      nextSong: 'banner.nextSong',
                      nextSingerUnassigned: 'banner.nextSingerUnassigned',
                      upNextOnStage: 'banner.upNextOnStage',
                      followingSinger: 'banner.followingSinger'
                    };

                    return STAGE_MESSAGE_KEYS.map((key) => {
                      const style = stageMessages[key];
                      const i18nDefault = t(bannerKey[key], { name: '{{name}}' });
                      return (
                        <div
                          key={key}
                          className="p-3 rounded-xl bg-slate-950/50 border border-slate-800/80 space-y-2.5"
                          data-testid={`settings-stage-message-${key}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <span className="text-sm font-medium text-slate-200 block">
                                {t(labelKey[key])}
                              </span>
                              <span className="text-[11px] text-slate-400 block mt-0.5 truncate">
                                {t('settings.stageMessageDefaultHint')}: {i18nDefault}
                              </span>
                            </div>
                            <label className="flex items-center gap-2 shrink-0 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={style.enabled}
                                onChange={(e) =>
                                  updateStageMessage(key, { enabled: e.target.checked })
                                }
                                className="w-4 h-4 accent-indigo-600 rounded"
                              />
                              <span className="text-xs text-slate-300">
                                {t('settings.stageMessageEnabled')}
                              </span>
                            </label>
                          </div>

                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              {t('settings.stageMessageText')}
                            </label>
                            <input
                              type="text"
                              value={style.text}
                              onChange={(e) =>
                                updateStageMessage(key, { text: e.target.value })
                              }
                              placeholder={t('settings.stageMessageTextPlaceholder')}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                              disabled={!style.enabled}
                            />
                          </div>

                          <div className="flex flex-wrap items-center gap-3">
                            <label className="inline-flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={style.bold}
                                onChange={(e) =>
                                  updateStageMessage(key, { bold: e.target.checked })
                                }
                                className="w-3.5 h-3.5 accent-indigo-600 rounded"
                                disabled={!style.enabled}
                              />
                              <span className="text-xs font-bold text-slate-300">
                                {t('settings.stageMessageBold')}
                              </span>
                            </label>
                            <label className="inline-flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={style.italic}
                                onChange={(e) =>
                                  updateStageMessage(key, { italic: e.target.checked })
                                }
                                className="w-3.5 h-3.5 accent-indigo-600 rounded"
                                disabled={!style.enabled}
                              />
                              <span className="text-xs italic text-slate-300">
                                {t('settings.stageMessageItalic')}
                              </span>
                            </label>
                            <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                              <span>{t('settings.stageMessageFontSize')}</span>
                              <input
                                type="number"
                                min={10}
                                max={96}
                                value={style.fontSizePx}
                                onChange={(e) =>
                                  updateStageMessage(key, {
                                    fontSizePx: parseInt(e.target.value, 10) || style.fontSizePx
                                  })
                                }
                                className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                                disabled={!style.enabled}
                              />
                              <span className="text-slate-400">px</span>
                            </label>
                            <button
                              type="button"
                              className="ml-auto text-[11px] text-indigo-300 hover:text-indigo-200 underline-offset-2 hover:underline disabled:opacity-40"
                              disabled={!style.enabled}
                              onClick={() =>
                                updateStageMessage(key, createDefaultStageMessages()[key])
                              }
                            >
                              {t('settings.stageMessageReset')}
                            </button>
                          </div>

                          {/* Per-message Stage backdrop: applies only while this message is visible. */}
                          <div className="pt-2 border-t border-slate-800/60 space-y-2">
                            <label className="block text-[11px] text-slate-400">
                              {t('settings.stageMessageBackground')}
                            </label>
                            <p className="text-[10px] text-slate-400 leading-relaxed">
                              {t('settings.stageMessageBackgroundHint')}
                            </p>
                            <select
                              value={style.backgroundMode || 'none'}
                              onChange={(e) =>
                                updateStageMessage(key, {
                                  backgroundMode: e.target.value as 'none' | 'color' | 'image'
                                })
                              }
                              disabled={!style.enabled}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 disabled:opacity-40"
                              data-testid={`settings-stage-message-bg-mode-${key}`}
                            >
                              <option value="none">{t('settings.stageMessageBackgroundNone')}</option>
                              <option value="color">{t('settings.stageMessageBackgroundColor')}</option>
                              <option value="image">{t('settings.stageMessageBackgroundImage')}</option>
                            </select>

                            {(style.backgroundMode || 'none') === 'color' && (
                              <div className="flex items-center gap-2">
                                <input
                                  type="color"
                                  value={style.backgroundColor || '#0f172a'}
                                  onChange={(e) =>
                                    updateStageMessage(key, { backgroundColor: e.target.value })
                                  }
                                  disabled={!style.enabled}
                                  className="w-10 h-8 rounded border border-slate-700 bg-slate-900 cursor-pointer"
                                  aria-label={t('settings.stageMessageBackgroundColor')}
                                />
                                <input
                                  type="text"
                                  value={style.backgroundColor || '#0f172a'}
                                  onChange={(e) =>
                                    updateStageMessage(key, { backgroundColor: e.target.value })
                                  }
                                  disabled={!style.enabled}
                                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
                                />
                              </div>
                            )}

                            {(style.backgroundMode || 'none') === 'image' && (
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  readOnly
                                  value={style.backgroundImagePath || ''}
                                  placeholder={t('settings.stageMessageBackgroundImagePlaceholder')}
                                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-300 truncate"
                                />
                                <button
                                  type="button"
                                  disabled={!style.enabled}
                                  className="shrink-0 px-3 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-40"
                                  onClick={async () => {
                                    const path = await window.karaokeApi?.dialog?.openImageFile?.();
                                    if (path) {
                                      updateStageMessage(key, {
                                        backgroundMode: 'image',
                                        backgroundImagePath: path
                                      });
                                    }
                                  }}
                                >
                                  {t('settings.stageMessageBackgroundBrowse')}
                                </button>
                                {style.backgroundImagePath ? (
                                  <button
                                    type="button"
                                    disabled={!style.enabled}
                                    className="shrink-0 px-2 py-1.5 text-xs rounded-lg text-slate-400 hover:text-slate-200 disabled:opacity-40"
                                    onClick={() =>
                                      updateStageMessage(key, { backgroundImagePath: '' })
                                    }
                                  >
                                    {t('settings.stageMessageBackgroundClear')}
                                  </button>
                                ) : null}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
          )}

          {/* ===== SCORCIATOIE ===== */}
          {showCategory('shortcuts', shortcutsHasMatches) && (
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
