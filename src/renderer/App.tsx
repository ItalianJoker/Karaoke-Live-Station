import React, { useEffect } from 'react';
import { ControlWindow } from './components/ControlWindow';
import { StageWindow } from './components/StageWindow';
import { useKaraokeStore } from './store/karaokeStore';
import './i18n';

/**
 * Root App Component
 *
 * Inspects URL query parameters (`?window=stage` vs `?window=control`) to route
 * Electron windows to either the audience StageWindow or the operator ControlWindow.
 * Dynamically applies the user-configured host/stage theme classes (from 10 distinct visual palettes)
 * to `document.documentElement`.
 */
export const App: React.FC = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const windowMode = urlParams.get('window') || 'control';

  const themeHost = useKaraokeStore((state) => state.settings.themeHost);
  const themeStage = useKaraokeStore((state) => state.settings.themeStage);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove(
      'dark-stage',
      'midnight-neon',
      'club-gold',
      'ocean-breeze',
      'sunset-crimson',
      'emerald-matrix',
      'royal-amethyst',
      'high-contrast',
      'light',
      'studio-desk'
    );
    const activeTheme = windowMode === 'stage' ? themeStage : themeHost;
    root.classList.add(activeTheme || 'studio-desk');
  }, [windowMode, themeHost, themeStage]);

  if (windowMode === 'stage') {
    return <StageWindow />;
  }

  return <ControlWindow />;
};
