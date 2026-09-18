/**
 * SoundFont path helpers shared by main (resolution) and tests.
 *
 * AppImage mounts under /tmp/.mount_* change every launch. Persisting those
 * absolute paths in renderer localStorage makes karaoke://local 404 on the
 * next run even when GeneralUser-GS.sf2 is correctly shipped in extraResources.
 */

/**
 * True when a persisted SoundFont path lives on an ephemeral extract/mount
 * (AppImage FUSE, Electron portable temp, macOS temp).
 */
export function isEphemeralSoundFontPath(filePath: string): boolean {
  const normalized = (filePath || '').replace(/\\/g, '/');
  if (!normalized) return false;
  // Linux AppImage: /tmp/.mount_XXXX/resources/soundfonts/...
  if (normalized.includes('/.mount_')) return true;
  // Windows portable / electron-builder extract-to-temp layouts
  if (/\/AppData\/Local\/Temp\//i.test(normalized)) return true;
  // macOS per-session temp extracts
  if (/\/var\/folders\/[^/]+\/[^/]+\/T\//i.test(normalized)) return true;
  return false;
}

/** Bundled GeneralUser GS bank filename (extraResources + vite publicDir). */
export const BUNDLED_SOUNDFONT_FILENAME = 'GeneralUser-GS.sf2';

/** Sentinel <select> value for “Altro…” / browse external .sf2 */
export const SOUND_FONT_OTHER_OPTION_ID = '__soundfont_other__';

/** Catalog entry for Settings SoundFont dropdown (bundled + present system banks). */
export interface SoundFontCatalogEntry {
  /** Stable id for <select> (e.g. bundled:GeneralUser-GS.sf2) */
  id: string;
  /** Absolute filesystem path suitable for karaoke://local */
  path: string;
  /** Basename including extension */
  fileName: string;
  /** Human label without kind suffix (renderer localizes kind) */
  displayName: string;
  /** Origin of the bank */
  kind: 'bundled' | 'system';
}

/** Friendly label from filename: GeneralUser-GS.sf2 → GeneralUser GS */
export function soundFontDisplayName(fileName: string): string {
  const base = (fileName || '').replace(/\.(sf2|sf3|dls)$/i, '');
  return base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || fileName;
}

/** Compare two absolute SoundFont paths (normalize separators). */
export function soundFontPathsEqual(a: string, b: string): boolean {
  const norm = (p: string) => (p || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na.toLowerCase() === nb.toLowerCase();
}
