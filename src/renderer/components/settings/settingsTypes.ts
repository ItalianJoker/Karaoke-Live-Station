import type { TFunction, i18n as I18nInstance } from 'i18next';
import type { AppSettings, AppTheme, YtDlpStatus } from '../../../shared/types';
import type { SoundFontCatalogEntry } from '../../../shared/soundFontPath';
import type { GpuStatus } from '../../../shared/gpuStatus';

/**
 * Theme option row for Host / Stage theme selects.
 *
 * **Audience (humans):** Label shown in the General tab theme dropdowns.
 *
 * **Audience (AI):** `id` must stay an `AppTheme` literal; labels are display-only (not i18n keys).
 */
export interface SettingsThemeOption {
  id: AppTheme;
  label: string;
}

/**
 * Built-in theme catalog used by the General settings tab.
 * Labels are fixed EN/IT display strings (not locale keys) — preserve as-is.
 */
export const THEME_OPTIONS: SettingsThemeOption[] = [
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

/**
 * Shortcut row for the Shortcuts settings tab (keys + localized label).
 */
export interface SettingsShortcutItem {
  keys: string[];
  label: string;
}

/**
 * Shared props bag for Settings modal tab bodies.
 *
 * **Audience (humans):** Everything Regia operators configure across General / Library /
 * Audio / Stage / Shortcuts panels.
 *
 * **Audience (AI):** Presentational contract only. Match flags stay computed in
 * `SettingsModal` (search + `showCategory`). Do not alter `updateSettings` keys,
 * `karaokeApi` IPC call sites, or store shape from tab components.
 */
export interface SettingsTabSharedProps {
  t: TFunction;
  i18n: I18nInstance;
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;
  isSearching: boolean;

  // --- General match flags ---
  matchThemeLang: boolean;
  matchMaximize: boolean;
  matchFairQueue: boolean;
  matchGuestPortal: boolean;
  matchSiae: boolean;
  matchLogs: boolean;

  // --- Library match flags ---
  matchLibraryPath: boolean;
  matchAutoArchive: boolean;
  matchMaxDownloads: boolean;
  matchInstrumentalVocal: boolean;
  /** Settings search: Download Instrumental subtitle policy (ask/always/never). */
  matchInstrumentalSubtitles: boolean;
  matchAiThreads: boolean;
  matchYtdlp: boolean;

  // --- Audio match flags ---
  matchSoundfont: boolean;
  matchDevices: boolean;
  matchAvSync: boolean;
  matchDspEngine: boolean;
  matchVocalRemoverAlgo: boolean;
  matchNormalization: boolean;
  matchAutoAdvance: boolean;

  // --- Stage match flags ---
  matchAutoStage: boolean;
  matchBannerIntro: boolean;
  matchBannerOutro: boolean;
  matchTitleOverlay: boolean;
  matchNextSinger: boolean;
  matchPitchStage: boolean;
  matchSpeedStage: boolean;
  matchStageMessages: boolean;

  // --- General local / handlers ---
  portalInfo: { enabled: boolean; url: string; port?: number; ip?: string } | null;
  logFilePath: string;
  handleExportSiae: () => void | Promise<void>;
  handleOpenLogFolder: () => void | Promise<void>;
  handleOpenLogFile: () => void | Promise<void>;
  handleClearLogs: () => void | Promise<void>;

  // --- Library local / handlers ---
  cpuCoreCount: number;
  /** Live GPU probe from `system:get-gpu-status` (shell loads; tab renders badge). */
  gpuStatus: GpuStatus | null;
  isCheckingYtdlp: boolean;
  ytdlpStatus: YtDlpStatus | null;
  ytdlpMessage: string | null;
  setShowAutoArchiveConfirm: (show: boolean) => void;
  handleSelectLibraryPath: () => void | Promise<void>;
  handleCheckYtDlpUpdate: () => void | Promise<void>;

  // --- Audio local / handlers ---
  audioDevices: MediaDeviceInfo[];
  defaultSystemSf: string | null;
  soundFontCatalog: SoundFontCatalogEntry[];
  soundFontSelectValue: string;
  handleResetDefaultSoundFont: () => void;
  handleSoundFontSelectChange: (value: string) => void | Promise<void>;
  handleSelectSoundFont: () => void | Promise<void>;

  // --- Shortcuts ---
  liveShortcuts: SettingsShortcutItem[];
  matchingShortcuts: SettingsShortcutItem[];
}

/** Props for {@link SettingsGeneralTab}. */
export type SettingsGeneralTabProps = Pick<
  SettingsTabSharedProps,
  | 't'
  | 'i18n'
  | 'settings'
  | 'updateSettings'
  | 'isSearching'
  | 'matchThemeLang'
  | 'matchMaximize'
  | 'matchFairQueue'
  | 'matchGuestPortal'
  | 'matchSiae'
  | 'matchLogs'
  | 'portalInfo'
  | 'logFilePath'
  | 'handleExportSiae'
  | 'handleOpenLogFolder'
  | 'handleOpenLogFile'
  | 'handleClearLogs'
>;

/** Props for {@link SettingsLibraryTab}. */
export type SettingsLibraryTabProps = Pick<
  SettingsTabSharedProps,
  | 't'
  | 'settings'
  | 'updateSettings'
  | 'isSearching'
  | 'matchLibraryPath'
  | 'matchAutoArchive'
  | 'matchMaxDownloads'
  | 'matchInstrumentalVocal'
  | 'matchInstrumentalSubtitles'
  | 'matchAiThreads'
  | 'matchYtdlp'
  | 'cpuCoreCount'
  | 'gpuStatus'
  | 'isCheckingYtdlp'
  | 'ytdlpStatus'
  | 'ytdlpMessage'
  | 'setShowAutoArchiveConfirm'
  | 'handleSelectLibraryPath'
  | 'handleCheckYtDlpUpdate'
>;

/** Props for {@link SettingsAudioTab}. */
export type SettingsAudioTabProps = Pick<
  SettingsTabSharedProps,
  | 't'
  | 'settings'
  | 'updateSettings'
  | 'isSearching'
  | 'matchSoundfont'
  | 'matchDevices'
  | 'matchAvSync'
  | 'matchDspEngine'
  | 'matchVocalRemoverAlgo'
  | 'matchNormalization'
  | 'matchAutoAdvance'
  | 'audioDevices'
  | 'defaultSystemSf'
  | 'soundFontCatalog'
  | 'soundFontSelectValue'
  | 'handleResetDefaultSoundFont'
  | 'handleSoundFontSelectChange'
  | 'handleSelectSoundFont'
>;

/** Props for {@link SettingsStageTab}. */
export type SettingsStageTabProps = Pick<
  SettingsTabSharedProps,
  | 't'
  | 'settings'
  | 'updateSettings'
  | 'isSearching'
  | 'matchAutoStage'
  | 'matchBannerIntro'
  | 'matchBannerOutro'
  | 'matchTitleOverlay'
  | 'matchNextSinger'
  | 'matchPitchStage'
  | 'matchSpeedStage'
  | 'matchStageMessages'
>;

/** Props for {@link SettingsShortcutsTab}. */
export type SettingsShortcutsTabProps = Pick<
  SettingsTabSharedProps,
  't' | 'isSearching' | 'liveShortcuts' | 'matchingShortcuts'
>;
