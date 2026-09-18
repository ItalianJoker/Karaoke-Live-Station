/**
 * Pure recursive library media discovery (no Electron / DB).
 *
 * Walks every subdirectory under the library root(s), pairs same-basename
 * companions in the same folder (e.g. .mp3+.cdg), and applies the same
 * incomplete-file / size / extension filters used by the main-process scanner.
 */

import fs from 'fs';
import path from 'path';

/** Incomplete / in-progress download artifacts — never catalogued. */
const INCOMPLETE_EXTENSIONS = new Set([
  '.part',
  '.ytdl',
  '.temp',
  '.tmp',
  '.download',
  '.crdownload'
]);

/** Directory names skipped while walking (not media roots). */
const SKIP_DIR_NAMES = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  '__macosx',
  'system volume information',
  '$recycle.bin'
]);

/** Minimum file size (bytes) to accept — skips tiny incomplete stubs. */
export const LIBRARY_SCAN_MIN_BYTES = 2048;

export type DiscoveredLibraryTrack = {
  /** Absolute path to the primary media file */
  absolutePath: string;
  source: 'local_library' | 'midi';
  title: string;
  artist: string;
  hasEmbeddedLyrics: boolean;
  /**
   * Stable catalog id: YouTube id when filename is `${youtubeId}_…`,
   * otherwise a path-hash placeholder the main process may replace.
   */
  idHint: string;
  /** Basename without extension (after stripping optional YouTube prefix) */
  baseName: string;
};

export type DiscoverLibraryMediaOptions = {
  /** Override fs for tests */
  fsImpl?: Pick<typeof fs, 'existsSync' | 'readdirSync' | 'statSync' | 'realpathSync'>;
  /** Override path helpers for tests */
  pathImpl?: Pick<typeof path, 'join' | 'extname' | 'basename' | 'resolve'>;
};

function shouldSkipDirectoryName(name: string): boolean {
  const lower = name.toLowerCase();
  if (SKIP_DIR_NAMES.has(lower)) return true;
  // Skip hidden/system folders (e.g. .Trash) but keep normal artist/album folders
  if (name.startsWith('.')) return true;
  return false;
}

function isDirectoryEntry(
  entry: fs.Dirent,
  fullPath: string,
  fsImpl: NonNullable<DiscoverLibraryMediaOptions['fsImpl']>
): boolean {
  if (entry.isDirectory()) return true;
  // Symlink → directory (common on Windows junctions / user layouts)
  if (entry.isSymbolicLink()) {
    try {
      return fsImpl.statSync(fullPath).isDirectory();
    } catch {
      return false;
    }
  }
  return false;
}

function isFileEntry(
  entry: fs.Dirent,
  fullPath: string,
  fsImpl: NonNullable<DiscoverLibraryMediaOptions['fsImpl']>
): boolean {
  if (entry.isFile()) return true;
  if (entry.isSymbolicLink()) {
    try {
      return fsImpl.statSync(fullPath).isFile();
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Recursively discover karaoke media under one library root.
 * Relative subfolders are included at every depth; pairing (.mp3+.cdg) is
 * per-directory so companions in different folders are not merged.
 */
export function discoverLibraryMedia(
  folderPath: string,
  options: DiscoverLibraryMediaOptions = {}
): DiscoveredLibraryTrack[] {
  const fsImpl = options.fsImpl || fs;
  const pathImpl = options.pathImpl || path;
  const discovered: DiscoveredLibraryTrack[] = [];
  const root = (folderPath || '').trim();
  if (!root || !fsImpl.existsSync(root)) return discovered;

  const visited = new Set<string>();

  const walk = (dir: string) => {
    let realDir = dir;
    try {
      realDir = fsImpl.realpathSync(dir);
    } catch {
      // Fall through with original path if realpath fails
    }
    if (visited.has(realDir)) return;
    visited.add(realDir);

    try {
      const entries = fsImpl.readdirSync(dir, { withFileTypes: true });
      const filesMap = new Map<string, string[]>();

      for (const entry of entries) {
        const full = pathImpl.join(dir, entry.name);
        if (isDirectoryEntry(entry, full, fsImpl)) {
          if (shouldSkipDirectoryName(entry.name)) continue;
          walk(full);
        } else if (isFileEntry(entry, full, fsImpl)) {
          const ext = pathImpl.extname(entry.name).toLowerCase();
          const base = pathImpl.basename(entry.name, ext);
          if (!filesMap.has(base)) filesMap.set(base, []);
          filesMap.get(base)!.push(ext);
        }
      }

      for (const [baseName, exts] of filesMap.entries()) {
        const incompleteExt = exts.some((e) => INCOMPLETE_EXTENSIONS.has(e));
        if (incompleteExt || /\.part$/i.test(baseName)) {
          continue;
        }

        const hasCdg = exts.includes('.cdg');
        const hasMp3 = exts.includes('.mp3');
        const hasMp4 = exts.includes('.mp4');
        const hasWebm = exts.includes('.webm');
        const hasMid = exts.includes('.mid');
        const hasKar = exts.includes('.kar');

        let source: DiscoveredLibraryTrack['source'] = 'local_library';
        let targetExt = '';

        if (hasMid || hasKar) {
          source = 'midi';
          targetExt = hasKar ? '.kar' : '.mid';
        } else if (hasMp4) {
          targetExt = '.mp4';
        } else if (hasWebm) {
          targetExt = '.webm';
        } else if (hasMp3) {
          targetExt = '.mp3';
        }

        if (!targetExt) continue;

        const fullFilePath = pathImpl.join(dir, `${baseName}${targetExt}`);

        try {
          const st = fsImpl.statSync(fullFilePath);
          if (!st.isFile() || st.size < LIBRARY_SCAN_MIN_BYTES) continue;
        } catch {
          continue;
        }

        // Prefer stable YouTube id when filename is `${youtubeId}_Artist - Title`
        const ytPrefix = baseName.match(/^([\w-]{11})_(.+)$/);
        const stableYtId = ytPrefix ? ytPrefix[1] : null;
        const nameForMeta = ytPrefix ? ytPrefix[2] : baseName;
        const parts = nameForMeta.split(' - ');
        const artist = parts.length > 1 ? parts[0].trim() : 'Unknown Artist';
        const title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : nameForMeta.trim();

        discovered.push({
          absolutePath: fullFilePath,
          source,
          title,
          artist,
          hasEmbeddedLyrics: hasCdg || hasKar,
          idHint: stableYtId || `track_${Buffer.from(fullFilePath).toString('base64url')}`,
          baseName
        });
      }
    } catch (err) {
      console.warn(`Error scanning directory ${dir}:`, err);
    }
  };

  walk(pathImpl.resolve(root));
  return discovered;
}

/**
 * Recursively find the first media file under `directory` matching id / hash / filename keys.
 * Used by download dedup so library subfolders are not invisible.
 */
export function findMediaMatchInTree(
  directory: string,
  keys: { ytId: string | null; fingerprint: string; expectedBase: string | null },
  mediaExtensions: Set<string>,
  options: DiscoverLibraryMediaOptions = {}
): { localFilePath: string; matchedBy: 'id' | 'hash' | 'filename' } | null {
  const fsImpl = options.fsImpl || fs;
  const pathImpl = options.pathImpl || path;
  const root = (directory || '').trim();
  if (!root || !fsImpl.existsSync(root)) return null;

  const expectedLower = keys.expectedBase?.toLowerCase() || null;
  const fpToken = keys.fingerprint.startsWith('yt:')
    ? keys.fingerprint.slice(3)
    : keys.fingerprint.slice(0, 12);

  const visited = new Set<string>();

  const walk = (dir: string): { localFilePath: string; matchedBy: 'id' | 'hash' | 'filename' } | null => {
    let realDir = dir;
    try {
      realDir = fsImpl.realpathSync(dir);
    } catch {
      /* keep dir */
    }
    if (visited.has(realDir)) return null;
    visited.add(realDir);

    let entries: fs.Dirent[];
    try {
      entries = fsImpl.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      console.warn('Failed scanning directory for existing media:', dir, err);
      return null;
    }

    for (const entry of entries) {
      const fullPath = pathImpl.join(dir, entry.name);
      if (isDirectoryEntry(entry, fullPath, fsImpl)) {
        if (shouldSkipDirectoryName(entry.name)) continue;
        const nested = walk(fullPath);
        if (nested) return nested;
        continue;
      }
      if (!isFileEntry(entry, fullPath, fsImpl)) continue;

      const ext = pathImpl.extname(entry.name).toLowerCase();
      if (!mediaExtensions.has(ext)) continue;

      const nameLower = entry.name.toLowerCase();
      const baseLower = pathImpl.basename(entry.name, ext).toLowerCase();
      const resolved = pathImpl.resolve(fullPath);

      if (keys.ytId && nameLower.includes(keys.ytId.toLowerCase())) {
        return { localFilePath: resolved, matchedBy: 'id' };
      }
      if (fpToken && nameLower.includes(fpToken.toLowerCase())) {
        return { localFilePath: resolved, matchedBy: 'hash' };
      }
      if (expectedLower && (baseLower === expectedLower || baseLower.endsWith(expectedLower))) {
        return { localFilePath: resolved, matchedBy: 'filename' };
      }
      if (expectedLower && baseLower.includes(expectedLower)) {
        return { localFilePath: resolved, matchedBy: 'filename' };
      }
    }
    return null;
  };

  return walk(pathImpl.resolve(root));
}
