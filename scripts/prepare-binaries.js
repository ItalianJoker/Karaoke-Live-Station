#!/usr/bin/env node

/**
 * scripts/prepare-binaries.js
 *
 * Pre-packaging utility to ensure each platform release contains EXCLUSIVELY
 * the binaries appropriate for that operating system:
 * - Windows releases contain only bin/win/ (yt-dlp.exe, ffmpeg.exe)
 * - Linux releases contain only bin/linux/ (yt-dlp, ffmpeg)
 * - macOS releases contain only bin/mac/ (yt-dlp, ffmpeg)
 *
 * Also configures the correct native better_sqlite3.node module for the target OS
 * to ensure that cross-packaged releases run without architecture/ABI mismatch.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const targetArg = (process.argv[2] || 'current').toLowerCase();

const ROOT_DIR = path.resolve(__dirname, '..');
const BIN_DIR = path.join(ROOT_DIR, 'bin');
const CACHE_DIR = path.join(BIN_DIR, '.cache');

const PLATFORM_MAP = {
  win: {
    folder: 'win',
    ytdlpName: 'yt-dlp.exe',
    ytdlpAsset: 'yt-dlp.exe',
    ffmpegName: 'ffmpeg.exe',
    ffmpegAsset: 'ffmpeg-win32-x64.gz',
    sqliteArch: 'win32-x64',
    isPosix: false
  },
  windows: {
    folder: 'win',
    ytdlpName: 'yt-dlp.exe',
    ytdlpAsset: 'yt-dlp.exe',
    ffmpegName: 'ffmpeg.exe',
    ffmpegAsset: 'ffmpeg-win32-x64.gz',
    sqliteArch: 'win32-x64',
    isPosix: false
  },
  linux: {
    folder: 'linux',
    ytdlpName: 'yt-dlp',
    ytdlpAsset: 'yt-dlp_linux',
    ffmpegName: 'ffmpeg',
    ffmpegAsset: 'ffmpeg-linux-x64.gz',
    sqliteArch: 'linux-x64',
    isPosix: true
  },
  mac: {
    folder: 'mac',
    ytdlpName: 'yt-dlp',
    ytdlpAsset: 'yt-dlp_macos',
    ffmpegName: 'ffmpeg',
    ffmpegAsset: 'ffmpeg-darwin-x64.gz',
    sqliteArch: 'darwin-x64',
    isPosix: true
  },
  darwin: {
    folder: 'mac',
    ytdlpName: 'yt-dlp',
    ytdlpAsset: 'yt-dlp_macos',
    ffmpegName: 'ffmpeg',
    ffmpegAsset: 'ffmpeg-darwin-x64.gz',
    sqliteArch: 'darwin-x64',
    isPosix: true
  }
};

function resolveTargets(arg) {
  if (arg === 'all') {
    return ['linux', 'win', 'mac'];
  }
  if (arg === 'current') {
    if (process.platform === 'win32') return ['win'];
    if (process.platform === 'darwin') return ['mac'];
    return ['linux'];
  }
  const mapped = PLATFORM_MAP[arg];
  return mapped ? [mapped.folder] : ['linux'];
}

async function fetchLatestYtDlpRelease() {
  const url = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'KaraokeLiveStation-Packager/1.0',
      Accept: 'application/vnd.github.v3+json'
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`GitHub API HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

async function prepareYtDlp(platformKey, releaseData) {
  const cfg = PLATFORM_MAP[platformKey];
  if (!cfg) return;

  const targetDir = path.join(BIN_DIR, cfg.folder);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const destFile = path.join(targetDir, cfg.ytdlpName);

  if (fs.existsSync(destFile)) {
    try {
      const stat = fs.statSync(destFile);
      if (stat.size > 5 * 1024 * 1024) {
        console.log(`[prepare-binaries] Valid yt-dlp binary exists for ${cfg.folder}: ${destFile} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
        if (cfg.isPosix && process.platform !== 'win32') {
          fs.chmodSync(destFile, 0o755);
        }
        return;
      }
    } catch {
      // Continue to download
    }
  }

  if (!releaseData) return;

  const asset = releaseData.assets.find(
    (a) => a.name.toLowerCase() === cfg.ytdlpAsset.toLowerCase()
  );

  if (!asset) {
    console.warn(`[prepare-binaries] Warning: Could not find asset '${cfg.ytdlpAsset}' in GitHub release.`);
    return;
  }

  console.log(`[prepare-binaries] Downloading yt-dlp (${cfg.ytdlpAsset}) for ${cfg.folder}...`);
  const tempFile = path.join(targetDir, `${cfg.ytdlpName}.tmp.${Date.now()}`);

  const res = await fetch(asset.browser_download_url, {
    headers: {
      'User-Agent': 'KaraokeLiveStation-Packager/1.0',
      Accept: 'application/octet-stream'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(180000)
  });

  if (!res.ok || !res.body) {
    throw new Error(`Failed to download asset: HTTP ${res.status}`);
  }

  const outStream = fs.createWriteStream(tempFile);
  await pipeline(Readable.fromWeb(res.body), outStream);

  if (fs.existsSync(destFile)) {
    try { fs.unlinkSync(destFile); } catch {}
  }
  fs.renameSync(tempFile, destFile);

  if (cfg.isPosix && process.platform !== 'win32') {
    fs.chmodSync(destFile, 0o755);
  }

  const finalStat = fs.statSync(destFile);
  console.log(`[prepare-binaries] Downloaded yt-dlp for ${cfg.folder} (${(finalStat.size / 1024 / 1024).toFixed(2)} MB)`);
}

async function prepareFfmpeg(platformKey) {
  const cfg = PLATFORM_MAP[platformKey];
  if (!cfg) return;

  const targetDir = path.join(BIN_DIR, cfg.folder);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const destFile = path.join(targetDir, cfg.ffmpegName);

  if (fs.existsSync(destFile)) {
    try {
      const stat = fs.statSync(destFile);
      if (stat.size > 10 * 1024 * 1024) {
        console.log(`[prepare-binaries] Valid ffmpeg binary exists for ${cfg.folder}: ${destFile} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
        if (cfg.isPosix && process.platform !== 'win32') {
          fs.chmodSync(destFile, 0o755);
        }
        return;
      }
    } catch {
      // Continue to download
    }
  }

  // Check if we can copy from node_modules for linux
  if (cfg.folder === 'linux') {
    const nodeModulesFfmpeg = path.join(ROOT_DIR, 'node_modules', 'ffmpeg-static', 'ffmpeg');
    if (fs.existsSync(nodeModulesFfmpeg)) {
      console.log(`[prepare-binaries] Copying ffmpeg for linux from node_modules/ffmpeg-static...`);
      fs.copyFileSync(nodeModulesFfmpeg, destFile);
      fs.chmodSync(destFile, 0o755);
      return;
    }
  }

  console.log(`[prepare-binaries] Downloading ffmpeg for ${cfg.folder} from ffmpeg-static b6.1.1 release...`);
  const downloadUrl = `https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/${cfg.ffmpegAsset}`;
  const tempFile = path.join(targetDir, `${cfg.ffmpegName}.tmp.${Date.now()}`);

  const res = await fetch(downloadUrl, {
    headers: { 'User-Agent': 'KaraokeLiveStation-Packager/1.0' },
    redirect: 'follow',
    signal: AbortSignal.timeout(180000)
  });

  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ffmpeg asset: HTTP ${res.status}`);
  }

  const gunzip = zlib.createGunzip();
  const outStream = fs.createWriteStream(tempFile);
  await pipeline(Readable.fromWeb(res.body), gunzip, outStream);

  if (fs.existsSync(destFile)) {
    try { fs.unlinkSync(destFile); } catch {}
  }
  fs.renameSync(tempFile, destFile);

  if (cfg.isPosix && process.platform !== 'win32') {
    fs.chmodSync(destFile, 0o755);
  }

  const finalStat = fs.statSync(destFile);
  console.log(`[prepare-binaries] Downloaded ffmpeg for ${cfg.folder} (${(finalStat.size / 1024 / 1024).toFixed(2)} MB)`);
}

function prepareSqlite(platformKey) {
  const cfg = PLATFORM_MAP[platformKey];
  if (!cfg) return;

  const targetNodePath = path.join(ROOT_DIR, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  const cachedNodePath = path.join(CACHE_DIR, 'better-sqlite3', cfg.sqliteArch, 'better_sqlite3.node');

  if (fs.existsSync(cachedNodePath)) {
    console.log(`[prepare-binaries] Configuring better_sqlite3.node for ${cfg.sqliteArch}...`);
    fs.mkdirSync(path.dirname(targetNodePath), { recursive: true });
    fs.copyFileSync(cachedNodePath, targetNodePath);
  } else {
    console.warn(`[prepare-binaries] Note: No cached better_sqlite3.node found for ${cfg.sqliteArch} at ${cachedNodePath}`);
  }
}

async function main() {
  const targetPlatforms = resolveTargets(targetArg);
  console.log(`[prepare-binaries] Preparing platform-exclusive binaries for: ${targetPlatforms.join(', ')}`);

  let releaseData = null;
  try {
    releaseData = await fetchLatestYtDlpRelease();
  } catch (err) {
    console.warn(`[prepare-binaries] Warning: Unable to query GitHub releases (${err.message}). Using existing local binaries.`);
  }

  for (const plat of targetPlatforms) {
    try {
      await prepareYtDlp(plat, releaseData);
      await prepareFfmpeg(plat);
    } catch (err) {
      console.warn(`[prepare-binaries] Warning: Failed to prepare binaries for ${plat}: ${err.message}`);
    }
  }

  // If a single target platform is specified (e.g. 'win' or 'mac' or 'linux'), configure SQLite module for it
  if (targetPlatforms.length === 1) {
    prepareSqlite(targetPlatforms[0]);
  }

  console.log('[prepare-binaries] Preparation complete.');
}

main().catch((err) => {
  console.error('[prepare-binaries] Unexpected failure:', err);
  process.exit(0);
});
