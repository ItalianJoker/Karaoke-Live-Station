import fs from 'fs';
import path from 'path';
import { app } from 'electron';

/** Minimum plausible size for a real yt-dlp standalone binary (~1 MB floor). */
const YTDLP_MIN_BYTES = 1 * 1024 * 1024;

/**
 * Resolves the absolute path to the FFmpeg executable.
 * Prioritizes:
 * 1. Bundled ffmpeg-static package
 * 2. Bundled binary in process.resourcesPath/bin
 * 3. System PATH fallback ('ffmpeg')
 */
export function resolveFfmpegPath(): string {
  const isWin = process.platform === 'win32';
  const binaryName = isWin ? 'ffmpeg.exe' : 'ffmpeg';

  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', binaryName) : '',
    process.resourcesPath ? path.join(process.resourcesPath, binaryName) : '',
    typeof app?.getPath === 'function' ? path.join(path.dirname(app.getPath('exe')), binaryName) : '',
    path.join(process.cwd(), 'bin', isWin ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux', binaryName),
    path.join(process.cwd(), 'bin', binaryName)
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ffmpegStatic = require('ffmpeg-static');
    if (typeof ffmpegStatic === 'string' && fs.existsSync(ffmpegStatic)) {
      return ffmpegStatic;
    }
  } catch {
    // Fallback
  }

  return 'ffmpeg';
}

/**
 * Returns the platform-specific yt-dlp binary filename.
 */
export function getYtDlpBinaryName(): string {
  return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

/**
 * Returns the path to the user data 'bin' directory where downloaded executables reside.
 * Uses Electron `app.getPath('userData')` when available (AppData / XDG / Library Support).
 */
export function getUserDataBinDir(): string {
  if (typeof app?.getPath === 'function') {
    return path.join(app.getPath('userData'), 'bin');
  }
  return path.join(process.cwd(), 'userData', 'bin');
}

/**
 * Absolute path where the managed yt-dlp binary must live:
 * `<userData>/bin/yt-dlp[.exe]`
 */
export function getManagedYtDlpPath(): string {
  return path.join(getUserDataBinDir(), getYtDlpBinaryName());
}

/**
 * Ensures a directory exists on disk.
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Applies execute permission on POSIX platforms (no-op on Windows).
 */
export function ensureExecutable(filePath: string): void {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(filePath, 0o755);
  } catch {
    // Non-fatal: some filesystems may reject chmod
  }
}

/**
 * Lightweight integrity gate before trusting a yt-dlp candidate path.
 * Checks existence, regular file, and minimum size. Optionally requires execute bit on POSIX.
 */
export function validateYtDlpBinaryIntegrity(
  filePath: string,
  options: { requireExecutableBit?: boolean } = {}
): { ok: boolean; reason?: string; size?: number } {
  try {
    if (!filePath || filePath === getYtDlpBinaryName()) {
      return { ok: false, reason: 'path_unresolved' };
    }
    if (!fs.existsSync(filePath)) {
      return { ok: false, reason: 'missing' };
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return { ok: false, reason: 'not_a_file' };
    }
    if (stat.size < YTDLP_MIN_BYTES) {
      return { ok: false, reason: 'too_small', size: stat.size };
    }
    if (options.requireExecutableBit && process.platform !== 'win32') {
      // Owner-execute bit (0o100)
      if ((stat.mode & 0o111) === 0) {
        return { ok: false, reason: 'not_executable', size: stat.size };
      }
    }
    return { ok: true, size: stat.size };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Enumerates bundled / workspace yt-dlp locations (read-only package resources, not userData).
 */
export function listBundledYtDlpCandidates(): string[] {
  const binaryName = getYtDlpBinaryName();
  const isWin = process.platform === 'win32';
  const platformFolder = isWin ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';

  return [
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', binaryName) : '',
    process.resourcesPath ? path.join(process.resourcesPath, binaryName) : '',
    typeof app?.getPath === 'function' ? path.join(path.dirname(app.getPath('exe')), binaryName) : '',
    path.join(process.cwd(), 'bin', platformFolder, binaryName),
    path.join(process.cwd(), 'bin', binaryName)
  ].filter(Boolean);
}

/**
 * Seeds `<userData>/bin/yt-dlp` from the first intact bundled candidate when the managed
 * copy is missing or fails integrity. Returns the managed path if present/seeded, else null.
 */
export function ensureManagedYtDlpFromBundle(): string | null {
  const managedPath = getManagedYtDlpPath();
  const managedCheck = validateYtDlpBinaryIntegrity(managedPath);
  if (managedCheck.ok) {
    ensureExecutable(managedPath);
    return managedPath;
  }

  for (const candidate of listBundledYtDlpCandidates()) {
    const check = validateYtDlpBinaryIntegrity(candidate);
    if (!check.ok) continue;

    try {
      ensureDir(getUserDataBinDir());
      fs.copyFileSync(candidate, managedPath);
      ensureExecutable(managedPath);
      const after = validateYtDlpBinaryIntegrity(managedPath);
      if (after.ok) {
        return managedPath;
      }
    } catch {
      // Try next candidate
    }
  }

  return null;
}

/**
 * Resolves the absolute path to the yt-dlp executable.
 * Prioritizes:
 * 1. Explicit YTDLP_PATH environment variable (if integrity passes)
 * 2. Managed userData bin folder (`<userData>/bin/`) — seeded from bundle when needed
 * 3. Bundled binary in process.resourcesPath/bin/ (from extraResources)
 * 4. Binary alongside the application executable
 * 5. Local workspace bin folder
 * 6. System PATH fallback ('yt-dlp')
 *
 * Never returns an ephemeral temp-dir path. Integrity is validated for filesystem candidates.
 */
export function resolveYtDlpPath(): string {
  if (process.env.YTDLP_PATH) {
    const envPath = process.env.YTDLP_PATH;
    if (validateYtDlpBinaryIntegrity(envPath).ok) {
      ensureExecutable(envPath);
      return envPath;
    }
  }

  // Prefer a durable managed copy under app userData
  const managed = ensureManagedYtDlpFromBundle();
  if (managed) {
    return managed;
  }

  const binaryName = getYtDlpBinaryName();
  for (const candidate of listBundledYtDlpCandidates()) {
    if (validateYtDlpBinaryIntegrity(candidate).ok) {
      ensureExecutable(candidate);
      return candidate;
    }
  }

  return binaryName;
}
