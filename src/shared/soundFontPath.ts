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
