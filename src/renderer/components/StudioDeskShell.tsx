import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Library,
  Search,
  ListMusic,
  History,
  Users,
  Download,
  QrCode,
  HelpCircle,
  Settings,
  Smartphone,
  Info,
  AudioLines,
} from 'lucide-react';
import appLogo from '../assets/logo.png';

export type StudioNavId =
  | 'library'
  | 'search'
  | 'queue'
  | 'history'
  | 'singers'
  | 'downloads'
  | 'guestRequests'
  | 'qr'
  | 'shortcuts'
  | 'settings'
  | 'dsp';

export interface StudioDeskShellProps {
  /** Which right-panel content maps to classic activeRightTab. */
  activeRightTab: 'queue' | 'library' | 'history';
  setActiveRightTab: (tab: 'queue' | 'library' | 'history') => void;
  /** Focus library search (Ricerca menu / Ctrl+F parity). */
  onFocusLibrarySearch: () => void;
  pendingGuestCount: number;
  onOpenGuestRequests: () => void;
  onOpenPortalQr: () => void;
  onOpenSingers: () => void;
  onOpenShortcuts: () => void;
  onOpenSettings: () => void;
  /** Downloads popover content (wired in ControlWindow). */
  downloadsSlot: React.ReactNode;
  showDownloadsMenu: boolean;
  setShowDownloadsMenu: (open: boolean) => void;
  downloadsMenuRef: React.RefObject<HTMLDivElement | null>;
  downloadBadgeCount: number;
  /** DSP compare popover (same content as classic header Info). */
  showDspCompare: boolean;
  setShowDspCompare: (open: boolean | ((v: boolean) => boolean)) => void;
  dspCompareBody: React.ReactNode;
  /** Center now-playing card (video + scrub) — owned by ControlWindow for videoRef. */
  nowPlaying: React.ReactNode;
  /** Studio deck controls under now-playing. */
  playerDeck: React.ReactNode;
  libraryColumn: React.ReactNode;
  queueColumn: React.ReactNode;
  historyColumn: React.ReactNode;
  /** True when current track is .mid/.kar — enables MIDI mixer toggle. */
  isMidiTrack: boolean;
  midiColumn: React.ReactNode;
}

/**
 * Opt-in Studio Desk Regia shell (themeHost === `studio-desk` only).
 *
 * IA: logo + menu (no subtitle) | library | center player+queue | optional MIDI column.
 * Classic ControlWindow header/grid is untouched when this shell is not mounted.
 */
export const StudioDeskShell: React.FC<StudioDeskShellProps> = ({
  activeRightTab,
  setActiveRightTab,
  onFocusLibrarySearch,
  pendingGuestCount,
  onOpenGuestRequests,
  onOpenPortalQr,
  onOpenSingers,
  onOpenShortcuts,
  onOpenSettings,
  downloadsSlot,
  showDownloadsMenu,
  setShowDownloadsMenu,
  downloadsMenuRef,
  downloadBadgeCount,
  showDspCompare,
  setShowDspCompare,
  dspCompareBody,
  nowPlaying,
  playerDeck,
  libraryColumn,
  queueColumn,
  historyColumn,
  isMidiTrack,
  midiColumn
}) => {
  const { t } = useTranslation();
  const [showMidiMixer, setShowMidiMixer] = useState(false);

  // Hide MIDI column when leaving MIDI media (default: hidden).
  useEffect(() => {
    if (!isMidiTrack) setShowMidiMixer(false);
  }, [isMidiTrack]);

  const navActive =
    'bg-[color:color-mix(in_srgb,var(--accent)_16%,transparent)] text-[color:var(--accent)] border-[color:var(--accent)] shadow-[0_0_12px_var(--accent-glow)]';
  const navIdle =
    'border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text-main)] hover:bg-[color:var(--bg-subtle)]';

  const selectNav = (id: StudioNavId) => {
    switch (id) {
      case 'library':
        setActiveRightTab('library');
        break;
      case 'search':
        setActiveRightTab('library');
        onFocusLibrarySearch();
        break;
      case 'queue':
        setActiveRightTab('queue');
        break;
      case 'history':
        setActiveRightTab('history');
        break;
      case 'singers':
        onOpenSingers();
        break;
      case 'downloads':
        setShowDownloadsMenu(!showDownloadsMenu);
        break;
      case 'guestRequests':
        onOpenGuestRequests();
        break;
      case 'qr':
        onOpenPortalQr();
        break;
      case 'shortcuts':
        onOpenShortcuts();
        break;
      case 'settings':
        onOpenSettings();
        break;
      case 'dsp':
        setShowDspCompare((v) => !v);
        break;
      default:
        break;
    }
  };

  const menuItems: Array<{
    id: StudioNavId;
    label: string;
    icon: React.ReactNode;
    active?: boolean;
    badge?: number;
  }> = [
    {
      id: 'library',
      label: t('studio.navLibrary', t('library.title')),
      icon: <Library className="w-4 h-4 shrink-0" />,
      active: activeRightTab === 'library'
    },
    {
      id: 'search',
      label: t('studio.navSearch', 'Search'),
      icon: <Search className="w-4 h-4 shrink-0" />,
      active: activeRightTab === 'library'
    },
    {
      id: 'queue',
      label: t('studio.navQueue', t('queue.title')),
      icon: <ListMusic className="w-4 h-4 shrink-0" />,
      active: activeRightTab === 'queue'
    },
    {
      id: 'history',
      label: t('studio.navHistory', t('history.tabTitle')),
      icon: <History className="w-4 h-4 shrink-0" />,
      active: activeRightTab === 'history'
    },
    {
      id: 'singers',
      label: t('studio.navSingers', t('singers.title')),
      icon: <Users className="w-4 h-4 shrink-0" />
    },
    {
      id: 'downloads',
      label: t('studio.navDownloads', t('library.downloadsMenu')),
      icon: <Download className="w-4 h-4 shrink-0" />,
      badge: downloadBadgeCount
    },
    {
      id: 'guestRequests',
      label: t('guestRequests.badge'),
      icon: <Smartphone className="w-4 h-4 shrink-0" />,
      badge: pendingGuestCount
    },
    {
      id: 'qr',
      label: t('studio.navQrGuest', 'QR Guest'),
      icon: <QrCode className="w-4 h-4 shrink-0" />
    },
    {
      id: 'shortcuts',
      label: t('studio.navShortcuts', t('shortcuts.title')),
      icon: <HelpCircle className="w-4 h-4 shrink-0" />
    }
  ];

  const showMidiColumn = isMidiTrack && showMidiMixer;

  return (
    <div
      className="flex-1 min-h-0 p-3 grid gap-3 overflow-hidden"
      data-testid="studio-desk-shell"
      style={{
        gridTemplateColumns: showMidiColumn
          ? 'minmax(11rem, 14rem) minmax(16rem, 22rem) minmax(0, 1fr) minmax(14rem, 18rem)'
          : 'minmax(11rem, 14rem) minmax(16rem, 22rem) minmax(0, 1fr)'
      }}
    >
      {/* Col 1: logo + menu (no subtitle / no Stage) */}
      <aside className="flex flex-col min-h-0 rounded-2xl border border-[color:var(--border-color)] bg-[color:var(--bg-card)] p-3 overflow-hidden">
        <div className="flex items-center justify-center mb-3 shrink-0">
          <img
            src={appLogo}
            alt={t('app.title')}
            className="w-16 h-16 object-contain drop-shadow-[0_0_12px_var(--accent-glow)]"
            data-testid="studio-brand-logo"
          />
        </div>
        <nav className="flex-1 min-h-0 overflow-y-auto space-y-1 pr-0.5">
          {menuItems.map((item) => {
            const btn = (
              <button
                type="button"
                onClick={() => selectNav(item.id)}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl border text-left text-xs font-semibold transition-all ${
                  item.active ? navActive : navIdle
                }`}
              >
                {item.icon}
                <span className="flex-1 truncate">{item.label}</span>
                {typeof item.badge === 'number' && item.badge > 0 && (
                  <span className="min-w-[1.1rem] h-4 px-1 rounded-full bg-[color:var(--accent-purple,#C026F0)] text-[9px] font-bold text-white flex items-center justify-center">
                    {item.badge}
                  </span>
                )}
              </button>
            );
            if (item.id === 'downloads') {
              return (
                <div
                  key="downloads"
                  className="relative"
                  ref={downloadsMenuRef as React.RefObject<HTMLDivElement>}
                >
                  {btn}
                  {showDownloadsMenu && (
                    <div className="absolute left-0 top-full mt-2 w-80 max-h-80 overflow-y-auto z-50 bg-[color:var(--bg-card)] border border-[color:var(--border-color)] rounded-2xl shadow-2xl p-3">
                      {downloadsSlot}
                    </div>
                  )}
                </div>
              );
            }
            return <React.Fragment key={item.id}>{btn}</React.Fragment>;
          })}
        </nav>
        <div className="pt-2 mt-2 border-t border-[color:var(--border-subtle)] space-y-1 shrink-0 relative">
          <button
            type="button"
            onClick={() => selectNav('dsp')}
            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl border text-left text-xs font-semibold transition-all ${
              showDspCompare ? navActive : navIdle
            }`}
            title={t('settings.dspEngineCompareTitle')}
            aria-expanded={showDspCompare}
          >
            <Info className="w-4 h-4 shrink-0" />
            <span className="truncate">{t('studio.navDsp', 'DSP')}</span>
          </button>
          {showDspCompare && (
            <div className="absolute left-0 bottom-full mb-2 w-72 z-50 bg-[color:var(--bg-card)] border border-[color:var(--border-color)] rounded-2xl shadow-2xl p-3 text-[11px] text-[color:var(--text-muted)]">
              <div className="flex items-center gap-1.5 text-[color:var(--accent)] font-bold uppercase tracking-wider text-[10px] mb-2">
                <AudioLines className="w-3.5 h-3.5" />
                {t('settings.dspEngineCompareTitle')}
              </div>
              {dspCompareBody}
            </div>
          )}
          <button
            type="button"
            onClick={() => selectNav('settings')}
            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl border text-left text-xs font-semibold transition-all ${navIdle}`}
            title={t('settings.title')}
          >
            <Settings className="w-4 h-4 shrink-0" />
            <span className="truncate">{t('settings.title')}</span>
          </button>
        </div>
      </aside>

      {/* Col 2: library (default) or history — queue always under center player */}
      <section className="flex flex-col min-h-0 rounded-2xl border border-[color:var(--border-color)] bg-[color:var(--bg-card)] overflow-hidden">
        <div
          className={
            activeRightTab === 'history' ? 'hidden' : 'flex flex-col flex-1 min-h-0'
          }
        >
          {libraryColumn}
        </div>
        <div className={activeRightTab === 'history' ? 'flex flex-col flex-1 min-h-0' : 'hidden'}>
          {historyColumn}
        </div>
      </section>

      {/* Col 3: now playing + deck + queue */}
      <section className="flex flex-col min-h-0 gap-3 overflow-hidden">
        <div className="rounded-2xl border border-[color:var(--border-color)] bg-[color:var(--bg-card)] p-3.5 shadow-xl overflow-y-auto min-h-0 flex-1 flex flex-col">
          {nowPlaying}
          {playerDeck}
          {isMidiTrack && (
            <button
              type="button"
              onClick={() => setShowMidiMixer((v) => !v)}
              className="mt-3 w-full py-2 rounded-xl text-xs font-semibold border border-[color:var(--border-color)] text-[color:var(--text-muted)] hover:text-[color:var(--accent)] hover:border-[color:var(--accent)] transition-all"
              data-testid="studio-midi-mixer-toggle"
            >
              {showMidiMixer
                ? t('studio.hideMidiMixer', 'Hide MIDI mixer')
                : t('studio.showMidiMixer', 'Show MIDI mixer')}
            </button>
          )}
          <div className="mt-3 flex-1 min-h-0 flex flex-col border-t border-[color:var(--border-subtle)] pt-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--accent)] mb-2">
              {t('queue.title')}
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">{queueColumn}</div>
          </div>
        </div>
      </section>

      {/* Col 4: MIDI mixer on demand */}
      {showMidiColumn && (
        <aside
          className="flex flex-col min-h-0 rounded-2xl border border-[color:var(--border-color)] bg-[color:var(--bg-card)] overflow-hidden"
          data-testid="studio-midi-column"
        >
          {midiColumn}
        </aside>
      )}
    </div>
  );
};
