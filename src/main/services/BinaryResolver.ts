import fs from 'fs';
import path from 'path';
import { app } from 'electron';

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
 * Returns the path to the user data 'bin' directory where downloaded executables reside.
 */
export function getUserDataBinDir(): string {
  if (typeof app?.getPath === 'function') {
    return path.join(app.getPath('userData'), 'bin');
  }
  return path.join(process.cwd(), 'userData', 'bin');
}

/**
 * Resolves the absolute path to the yt-dlp executable.
 * Prioritizes:
 * 1. Explicit YTDLP_PATH environment variable
 * 2. User data bin folder (appData/bin/) - so auto-updated binaries take immediate precedence
 * 3. Bundled binary in process.resourcesPath/bin/ (from extraResources)
 * 4. Binary alongside the application executable
 * 5. Local workspace bin folder
 * 6. System PATH fallback ('yt-dlp')
 */
export function resolveYtDlpPath(): string {
  if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) {
    return process.env.YTDLP_PATH;
  }

  const isWin = process.platform === 'win32';
  const binaryName = isWin ? 'yt-dlp.exe' : 'yt-dlp';

  const userDataBin = path.join(getUserDataBinDir(), binaryName);
  const candidates = [
    userDataBin,
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

  return binaryName;
}


