import React, { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Library,
  Search,
  History,
  Users,
  Download,
  QrCode,
  HelpCircle,
  Settings,
  Smartphone
} from 'lucide-react';
import appLogo from '../assets/logo.png';

export type StudioNavId =
  | 'library'
  | 'search'
  | 'history'
  | 'singers'
  | 'downloads'
  | 'guestRequests'
  | 'qr'
  | 'shortcuts'
  | 'settings'
  | 'stage';

export interface StudioDeskShellProps {
  /** Which right-panel content maps to classic activeRightTab. */
  activeRightTab: 'queue' | 'library' | 'history';
  setActiveRightTab: (tab: 'queue' | 'library' | 'history') => void;
  /**
   * Studio «Libreria»: open library on Locale (mirror Ricerca → Web).
   */
  onOpenLocalLibrary: () => void;
  /**
   * Studio «Ricerca»: open library on Web/YouTube and focus search.
   */
  onOpenWebSearch: () => void;
  pendingGuestCount: number;
  onOpenGuestRequests: () => void;
  onOpenPortalQr: () => void;
  onOpenSingers: () => void;
  onOpenShortcuts: () => void;
  onOpenSettings: () => void;
  /** Stage open/reopen — menu footer; classic Dark Stage status colors. */
  stageOpen: boolean;
  onReopenStage: () => void;
  /** Downloads popover content (wired in ControlWindow). */
  downloadsSlot: React.ReactNode;
  showDownloadsMenu: boolean;
  setShowDownloadsMenu: (open: boolean) => void;
  downloadsMenuRef: React.RefObject<HTMLDivElement | null>;
  downloadBadgeCount: number;
  /** Center now-playing card (video + scrub) — owned by ControlWindow for videoRef. */
  nowPlaying: React.ReactNode;
  /** Studio deck controls under now-playing (includes MIDI toggle when applicable). */
  playerDeck: React.ReactNode;
  libraryColumn: React.ReactNode;
  queueColumn: React.ReactNode;
  historyColumn: React.ReactNode;
  /** True when MIDI mixer column should be visible (owned by ControlWindow). */
  showMidiColumn: boolean;
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
  onOpenLocalLibrary,
  onOpenWebSearch,
  pendingGuestCount,
  onOpenGuestRequests,
  onOpenPortalQr,
  onOpenSingers,
  onOpenShortcuts,
  onOpenSettings,
  stageOpen,
  onReopenStage,
  downloadsSlot,
  showDownloadsMenu,
  setShowDownloadsMenu,
  downloadsMenuRef,
  downloadBadgeCount,
  nowPlaying,
  playerDeck,
  libraryColumn,
  queueColumn,
  historyColumn,
  showMidiColumn,
  midiColumn
}) => {
  const { t } = useTranslation();
  /** Distinguishes Libreria vs Ricerca highlight while both target the library column. */
  const [libraryNavKind, setLibraryNavKind] = useState<'library' | 'search'>('library');
  const [downloadsMenuPos, setDownloadsMenuPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  // Position Download submenu in a body portal so aside overflow cannot clip it.
  useLayoutEffect(() => {
    if (!showDownloadsMenu) {
      setDownloadsMenuPos(null);
      return;
    }
    const update = () => {
      const anchor = downloadsMenuRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const menuWidth = 320;
      const gap = 8;
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      let left = rect.right + gap;
      if (left + menuWidth > vw - 8) {
        left = Math.max(8, rect.left - menuWidth - gap);
      }
      const maxHeight = Math.min(320, vh - 16);
      let top = rect.top;
      if (top + maxHeight > vh - 8) {
        top = Math.max(8, vh - 8 - maxHeight);
      }
      setDownloadsMenuPos({ top, left, width: menuWidth });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [showDownloadsMenu, downloadsMenuRef]);

  const navActive =
    'bg-[color:color-mix(in_srgb,var(--accent)_16%,transparent)] text-[color:var(--accent)] border-[color:var(--accent)] shadow-[0_0_12px_var(--accent-glow)]';
  const navIdle =
    'border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text-main)] hover:bg-[color:var(--bg-subtle)]';

  const selectNav = (id: StudioNavId) => {
    switch (id) {
      case 'library':
        setLibraryNavKind('library');
        onOpenLocalLibrary();
        break;
      case 'search':
        setLibraryNavKind('search');
        onOpenWebSearch();
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
      case 'stage':
        onReopenStage();
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
      active: activeRightTab === 'library' && libraryNavKind === 'library'
    },
    {
      id: 'search',
      label: t('studio.navSearch', 'Search'),
      icon: <Search className="w-4 h-4 shrink-0" />,
      active: activeRightTab === 'library' && libraryNavKind === 'search'
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
    }
  ];

  const footerNavClass =
    'w-full flex items-center gap-2 px-2.5 py-2 rounded-xl border text-left text-xs font-semibold transition-all border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text-main)] hover:bg-[color:var(--bg-subtle)]';

  const downloadsPortal =
    showDownloadsMenu &&
    downloadsMenuPos &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        className="fixed z-[200] max-h-80 overflow-y-auto bg-[color:var(--bg-card)] border border-[color:var(--border-color)] rounded-2xl shadow-2xl p-3"
        style={{
          top: downloadsMenuPos.top,
          left: downloadsMenuPos.left,
          width: downloadsMenuPos.width
        }}
        data-testid="studio-downloads-menu"
        role="dialog"
        aria-label={t('studio.navDownloads', t('library.downloadsMenu'))}
      >
        {downloadsSlot}
      </div>,
      document.body
    );

  return (
    <div
      className="flex-1 min-h-0 p-3 grid gap-3 overflow-hidden"
      data-testid="studio-desk-shell"
      style={{
        gridTemplateColumns: showMidiColumn
          ? 'minmax(10rem, 12rem) minmax(22rem, 28rem) minmax(0, 1fr) minmax(14rem, 18rem)'
          : 'minmax(10rem, 12rem) minmax(22rem, 28rem) minmax(0, 1fr)'
      }}
    >
      {/* Col 1: logo + menu */}
      <aside className="flex flex-col min-h-0 rounded-2xl border border-[color:var(--border-color)] bg-[color:var(--bg-card)] p-3 overflow-hidden">
        {/* Slightly more gap under logo before Libreria / menu (Luca polish). */}
        <div className="px-2.5 mb-5 shrink-0 flex items-center justify-center">
          <img
            src={appLogo}
            alt={t('app.title')}
            className="w-full h-auto max-h-[7.5rem] object-contain drop-shadow-[0_0_12px_var(--accent-glow)]"
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
                </div>
              );
            }
            return <React.Fragment key={item.id}>{btn}</React.Fragment>;
          })}
        </nav>

        <div className="pt-2 mt-2 shrink-0">
          {/* Match classic Dark Stage header Stage pill: green active / red inactive + status dot. */}
          <button
            type="button"
            onClick={() => selectNav('stage')}
            className={`w-full px-3 py-2 rounded-full text-xs font-semibold flex items-center justify-center gap-2 border shadow-sm transition-all duration-200 active:scale-95 ${
              stageOpen
                ? 'bg-emerald-950/40 border-emerald-800/70 text-emerald-400 hover:bg-emerald-900/50'
                : 'bg-red-950/40 border-red-800/70 text-red-400 animate-pulse hover:bg-red-900/50'
            }`}
            title={stageOpen ? t('app.stageWindow') : t('app.reopenStage')}
            data-testid="studio-stage-reopen"
          >
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                stageOpen
                  ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50'
                  : 'bg-red-400'
              }`}
            />
            <span className="truncate">
              {stageOpen ? t('app.stageWindow') : t('app.reopenStage')}
            </span>
          </button>

          {/* Slightly more gap under Stage before the footer separator (Luca pass 3). */}
          <div className="border-t border-[color:var(--border-subtle)] mt-3.5 pt-2 space-y-1">
            <button
              type="button"
              onClick={() => selectNav('qr')}
              className={footerNavClass}
              title={t('studio.navQrGuest', 'QR Guest')}
            >
              <QrCode className="w-4 h-4 shrink-0" />
              <span className="truncate">{t('studio.navQrGuest', 'QR Guest')}</span>
            </button>
            <button
              type="button"
              onClick={() => selectNav('shortcuts')}
              className={footerNavClass}
              title={t('studio.navShortcuts', t('shortcuts.title'))}
            >
              <HelpCircle className="w-4 h-4 shrink-0" />
              <span className="truncate">
                {t('studio.navShortcuts', t('shortcuts.title'))}
              </span>
            </button>
            <button
              type="button"
              onClick={() => selectNav('settings')}
              className={footerNavClass}
              title={t('studio.navSettings', 'Settings')}
            >
              <Settings className="w-4 h-4 shrink-0" />
              <span className="truncate">{t('studio.navSettings', 'Settings')}</span>
            </button>
          </div>
        </div>
      </aside>

      {downloadsPortal}

      {/* Col 2: library / history — slight top pad relative to logo column */}
      <section className="flex flex-col min-h-0 rounded-2xl border border-[color:var(--border-color)] bg-[color:var(--bg-card)] overflow-hidden pt-1">
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

      {/* Col 3: now playing + compact deck + queue (grows) */}
      <section className="flex flex-col min-h-0 gap-3 overflow-hidden">
        <div className="rounded-2xl border border-[color:var(--border-color)] bg-[color:var(--bg-card)] p-3.5 shadow-xl min-h-0 flex-1 flex flex-col overflow-hidden">
          <div className="shrink-0">
            {nowPlaying}
            {playerDeck}
          </div>
          <div className="mt-2 flex-1 min-h-0 flex flex-col border-t border-[color:var(--border-subtle)] pt-2 overflow-hidden">
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{queueColumn}</div>
          </div>
        </div>
      </section>

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
