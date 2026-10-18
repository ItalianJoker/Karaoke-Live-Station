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
    // Prefer host arch when packaging on macOS CI (macos-latest = arm64).
    ffmpegAsset:
      process.platform === 'darwin' && process.arch === 'arm64'
        ? 'ffmpeg-darwin-arm64.gz'
        : 'ffmpeg-darwin-x64.gz',
    sqliteArch:
      process.platform === 'darwin' && process.arch === 'arm64'
        ? 'darwin-arm64'
        : 'darwin-x64',
    isPosix: true
  },
  darwin: {
    folder: 'mac',
    ytdlpName: 'yt-dlp',
    ytdlpAsset: 'yt-dlp_macos',
    ffmpegName: 'ffmpeg',
    ffmpegAsset:
      process.platform === 'darwin' && process.arch === 'arm64'
        ? 'ffmpeg-darwin-arm64.gz'
        : 'ffmpeg-darwin-x64.gz',
    sqliteArch:
      process.platform === 'darwin' && process.arch === 'arm64'
        ? 'darwin-arm64'
        : 'darwin-x64',
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

/** Prefer Actions tokens so CI is not blocked by anonymous GitHub API rate limits. */
function githubAuthHeaders(extra = {}) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  const headers = {
    'User-Agent': 'KaraokeLiveStation-Packager/1.0',
    ...extra
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers['X-GitHub-Api-Version'] = '2022-11-28';
  }
  return headers;
}

async function fetchLatestYtDlpRelease() {
  const url = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
  const response = await fetch(url, {
    headers: githubAuthHeaders({ Accept: 'application/vnd.github+json' }),
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`GitHub API HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Download a yt-dlp release asset into destFile.
 * Tries authenticated API asset URL first, then the public
 * `/releases/latest/download/<name>` redirect (works without API quota).
 */
async function downloadYtDlpAsset(assetName, destFile, releaseData) {
  const candidates = [];
  if (releaseData && Array.isArray(releaseData.assets)) {
    const asset = releaseData.assets.find(
      (a) => a.name.toLowerCase() === assetName.toLowerCase()
    );
    if (asset?.browser_download_url) {
      candidates.push(asset.browser_download_url);
    }
  }
  // Direct latest/download URL — no releases API call required.
  candidates.push(
    `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${assetName}`
  );

  const tempFile = `${destFile}.tmp.${Date.now()}`;
  let lastErr = null;

  for (const url of candidates) {
    try {
      console.log(`[prepare-binaries] Downloading yt-dlp (${assetName}) from ${url}...`);
      const res = await fetch(url, {
        headers: githubAuthHeaders({ Accept: 'application/octet-stream' }),
        redirect: 'follow',
        signal: AbortSignal.timeout(180000)
      });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }
      const outStream = fs.createWriteStream(tempFile);
      await pipeline(Readable.fromWeb(res.body), outStream);

      if (fs.existsSync(destFile)) {
        try {
          fs.unlinkSync(destFile);
        } catch {
          /* ignore */
        }
      }
      fs.renameSync(tempFile, destFile);
      return;
    } catch (err) {
      lastErr = err;
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch {
        /* ignore */
      }
      console.warn(
        `[prepare-binaries] yt-dlp download candidate failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Failed to download yt-dlp asset ${assetName}`);
}

function assertYtDlpPresent(platformKey) {
  const cfg = PLATFORM_MAP[platformKey];
  if (!cfg) return;
  const destFile = path.join(BIN_DIR, cfg.folder, cfg.ytdlpName);
  if (!fs.existsSync(destFile)) {
    throw new Error(
      `yt-dlp binary missing after prepare for ${cfg.folder}: ${destFile}. ` +
        `Cannot package a release without it.`
    );
  }
  const stat = fs.statSync(destFile);
  if (stat.size < 5 * 1024 * 1024) {
    throw new Error(
      `yt-dlp binary too small for ${cfg.folder}: ${destFile} (${stat.size} bytes)`
    );
  }
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

  await downloadYtDlpAsset(cfg.ytdlpAsset, destFile, releaseData);

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

  // Prefer copying the binary already fetched by ffmpeg-static's postinstall
  // (avoids a second GitHub Releases download that can 500 on CI).
  const nodeModulesFfmpeg = path.join(
    ROOT_DIR,
    'node_modules',
    'ffmpeg-static',
    cfg.isPosix ? 'ffmpeg' : 'ffmpeg.exe'
  );
  if (fs.existsSync(nodeModulesFfmpeg)) {
    try {
      const nmStat = fs.statSync(nodeModulesFfmpeg);
      if (nmStat.size > 10 * 1024 * 1024) {
        console.log(
          `[prepare-binaries] Copying ffmpeg for ${cfg.folder} from node_modules/ffmpeg-static...`
        );
        fs.copyFileSync(nodeModulesFfmpeg, destFile);
        if (cfg.isPosix && process.platform !== 'win32') {
          fs.chmodSync(destFile, 0o755);
        }
        return;
      }
    } catch {
      // Fall through to download
    }
  }

  console.log(`[prepare-binaries] Downloading ffmpeg for ${cfg.folder} from ffmpeg-static b6.1.1 release...`);
  const downloadUrl = `https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/${cfg.ffmpegAsset}`;
  const tempFile = path.join(targetDir, `${cfg.ffmpegName}.tmp.${Date.now()}`);

  let lastErr = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
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
        try {
          fs.unlinkSync(destFile);
        } catch {
          /* ignore */
        }
      }
      fs.renameSync(tempFile, destFile);

      if (cfg.isPosix && process.platform !== 'win32') {
        fs.chmodSync(destFile, 0o755);
      }

      const finalStat = fs.statSync(destFile);
      console.log(
        `[prepare-binaries] Downloaded ffmpeg for ${cfg.folder} (${(finalStat.size / 1024 / 1024).toFixed(2)} MB)`
      );
      return;
    } catch (err) {
      lastErr = err;
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch {
        /* ignore */
      }
      console.warn(
        `[prepare-binaries] ffmpeg download attempt ${attempt}/5 failed: ${err instanceof Error ? err.message : String(err)}`
      );
      await new Promise((r) => setTimeout(r, attempt * 8000));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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
  if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) {
    console.log('[prepare-binaries] Using authenticated GitHub token for yt-dlp release lookups');
  } else {
    console.warn(
      '[prepare-binaries] No GITHUB_TOKEN/GH_TOKEN — anonymous API may hit rate limits; ' +
        'will fall back to /releases/latest/download/'
    );
  }

  let releaseData = null;
  try {
    releaseData = await fetchLatestYtDlpRelease();
  } catch (err) {
    console.warn(
      `[prepare-binaries] Warning: Unable to query GitHub releases API (${err.message}). ` +
        `Will try direct latest/download URLs.`
    );
  }

  const errors = [];
  for (const plat of targetPlatforms) {
    try {
      await prepareYtDlp(plat, releaseData);
      await prepareFfmpeg(plat);
      assertYtDlpPresent(plat);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[prepare-binaries] ERROR preparing ${plat}: ${msg}`);
      errors.push(`${plat}: ${msg}`);
    }
  }

  // If a single target platform is specified (e.g. 'win' or 'mac' or 'linux'), configure SQLite module for it
  if (targetPlatforms.length === 1) {
    prepareSqlite(targetPlatforms[0]);
  }

  if (errors.length > 0) {
    throw new Error(
      `prepare-binaries failed for: ${errors.join('; ')}. ` +
        `Refusing to continue with a package missing yt-dlp.`
    );
  }

  console.log('[prepare-binaries] Preparation complete.');
}

main().catch((err) => {
  console.error('[prepare-binaries] Unexpected failure:', err);
  // Must fail the release build — silent exit(0) previously shipped mac/linux without yt-dlp.
  process.exit(1);
});
