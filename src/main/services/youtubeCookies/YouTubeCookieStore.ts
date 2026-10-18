/**
 * Secure on-disk store for the Netscape cookies.txt used by yt-dlp.
 *
 * Path (cross-platform via Electron):
 *   `<app.getPath('userData')>/youtube/cookies.txt`
 *
 * Windows: `%APPDATA%/karaoke-live-station/youtube/cookies.txt`
 * macOS:   `~/Library/Application Support/karaoke-live-station/youtube/cookies.txt`
 * Linux:   `~/.config/karaoke-live-station/youtube/cookies.txt` (XDG)
 *
 * Never writes under asar / Program Files. File mode 0o600 on POSIX.
 */

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { ensureDir } from '../BinaryResolver';
import { netscapeFileLooksAuthenticated } from './netscapeCookies';

export interface YouTubeCookieFileStatus {
  /** Absolute path where cookies.txt is (or will be) stored */
  path: string;
  /** File exists on disk */
  present: boolean;
  /** File parses as a logged-in YouTube/Google session */
  valid: boolean;
  /** Epoch ms of last successful write, when known from mtime */
  lastSavedAt?: number;
  /** Byte size when present */
  sizeBytes?: number;
}

/**
 * Resolve `<userData>/youtube` — writable, portable across app updates.
 */
export function getYouTubeCookieDir(): string {
  if (typeof app?.getPath === 'function') {
    return path.join(app.getPath('userData'), 'youtube');
  }
  return path.join(process.cwd(), 'userData', 'youtube');
}

/**
 * Absolute path of the Netscape cookies file for yt-dlp `--cookies`.
 */
export function getYouTubeCookiesFilePath(): string {
  return path.join(getYouTubeCookieDir(), 'cookies.txt');
}

/**
 * Inspect the on-disk cookie file without exposing cookie values.
 */
export function getYouTubeCookieFileStatus(): YouTubeCookieFileStatus {
  const filePath = getYouTubeCookiesFilePath();
  try {
    if (!fs.existsSync(filePath)) {
      return { path: filePath, present: false, valid: false };
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0) {
      return { path: filePath, present: true, valid: false, sizeBytes: stat.size };
    }
    const contents = fs.readFileSync(filePath, 'utf8');
    const valid = netscapeFileLooksAuthenticated(contents);
    return {
      path: filePath,
      present: true,
      valid,
      lastSavedAt: Math.floor(stat.mtimeMs),
      sizeBytes: stat.size
    };
  } catch {
    return { path: filePath, present: false, valid: false };
  }
}

/**
 * Atomically write Netscape cookie contents under userData with restrictive perms.
 *
 * @param netscapeBody - Full cookies.txt body (never log this string)
 * @returns Absolute path written
 */
export function saveYouTubeCookiesNetscape(netscapeBody: string): string {
  const dir = getYouTubeCookieDir();
  ensureDir(dir);
  const target = getYouTubeCookiesFilePath();
  const tmp = path.join(dir, `cookies.${process.pid}.${Date.now()}.tmp`);

  fs.writeFileSync(tmp, netscapeBody, { encoding: 'utf8', mode: 0o600 });
  // Atomic replace so yt-dlp never reads a half-written file.
  fs.renameSync(tmp, target);

  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(target, 0o600);
    } catch {
      // Non-fatal on filesystems that ignore chmod
    }
  }

  return target;
}

/**
 * Delete the stored cookies file (Settings "Clear" / logout).
 * Does not clear the Electron partition session — call LoginWindow.clearPartition for that.
 */
export function clearYouTubeCookieFile(): boolean {
  const filePath = getYouTubeCookiesFilePath();
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Return the cookies path only when the file is present and looks authenticated.
 * Safe to pass to yt-dlp `--cookies`.
 */
export function resolveValidCookiesPathForYtDlp(): string | null {
  const status = getYouTubeCookieFileStatus();
  return status.present && status.valid ? status.path : null;
}
