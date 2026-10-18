#!/usr/bin/env node
/**
 * Fail the build when a packaged release is missing yt-dlp / ffmpeg.
 *
 * Why: v2.1.0 macOS GitHub release zip shipped without yt-dlp while the CI
 * artifact was correct — catch that class of packaging/upload regression here.
 *
 * Usage:
 *   node scripts/verify-packaged-bins.js [releaseDir]
 * Default releaseDir: ./release
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const releaseDir = path.resolve(process.argv[2] || path.join(ROOT, 'release'));
const MIN_YTDLP = 1 * 1024 * 1024;
const MIN_FFMPEG = 1 * 1024 * 1024;

function fail(msg) {
  console.error(`[verify-packaged-bins] FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`[verify-packaged-bins] OK: ${msg}`);
}

function listFilesRecursive(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) listFilesRecursive(full, acc);
    else acc.push(full);
  }
  return acc;
}

function assertBinary(filePath, label, minBytes) {
  if (!fs.existsSync(filePath)) fail(`Missing ${label}: ${filePath}`);
  const st = fs.statSync(filePath);
  if (!st.isFile() || st.size < minBytes) {
    fail(`${label} too small or not a file (${st.size} bytes): ${filePath}`);
  }
  if (process.platform !== 'win32' && (st.mode & 0o111) === 0) {
    fail(`${label} is not executable: ${filePath}`);
  }
  ok(`${label} (${(st.size / 1024 / 1024).toFixed(2)} MB) @ ${filePath}`);
}

function verifyMacAppBundle(appDir) {
  const binDir = path.join(appDir, 'Contents', 'Resources', 'bin');
  assertBinary(path.join(binDir, 'yt-dlp'), 'mac yt-dlp', MIN_YTDLP);
  assertBinary(path.join(binDir, 'ffmpeg'), 'mac ffmpeg', MIN_FFMPEG);
}

function verifyWinDir(unpackedDir) {
  const binDir = path.join(unpackedDir, 'resources', 'bin');
  assertBinary(path.join(binDir, 'yt-dlp.exe'), 'win yt-dlp.exe', MIN_YTDLP);
  assertBinary(path.join(binDir, 'ffmpeg.exe'), 'win ffmpeg.exe', MIN_FFMPEG);
}

function verifyLinuxDir(unpackedDir) {
  const binDir = path.join(unpackedDir, 'resources', 'bin');
  assertBinary(path.join(binDir, 'yt-dlp'), 'linux yt-dlp', MIN_YTDLP);
  assertBinary(path.join(binDir, 'ffmpeg'), 'linux ffmpeg', MIN_FFMPEG);
}

function verifyZipArchive(zipPath) {
  // List entries without full extract (fast gate for CI artifacts / release zips).
  let listing = '';
  try {
    listing = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  } catch (err) {
    fail(`Cannot list zip ${zipPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const isMac = /arm64-mac|mac\.zip|-mac\.zip/i.test(path.basename(zipPath)) ||
    listing.includes('.app/Contents/Resources/bin/');
  const isWin = /-win\.zip/i.test(path.basename(zipPath)) || listing.includes('resources/bin/yt-dlp.exe');

  if (isMac) {
    if (!/Resources\/bin\/yt-dlp\b/.test(listing)) {
      fail(`mac zip missing Contents/Resources/bin/yt-dlp: ${zipPath}`);
    }
    if (!/Resources\/bin\/ffmpeg\b/.test(listing)) {
      fail(`mac zip missing Contents/Resources/bin/ffmpeg: ${zipPath}`);
    }
    ok(`mac zip contains yt-dlp + ffmpeg: ${path.basename(zipPath)}`);
    return;
  }

  if (isWin) {
    if (!/resources\/bin\/yt-dlp\.exe\b/.test(listing)) {
      fail(`win zip missing resources/bin/yt-dlp.exe: ${zipPath}`);
    }
    if (!/resources\/bin\/ffmpeg\.exe\b/.test(listing)) {
      fail(`win zip missing resources/bin/ffmpeg.exe: ${zipPath}`);
    }
    ok(`win zip contains yt-dlp.exe + ffmpeg.exe: ${path.basename(zipPath)}`);
  }
}

function main() {
  if (!fs.existsSync(releaseDir)) {
    fail(`Release directory not found: ${releaseDir}`);
  }

  const all = listFilesRecursive(releaseDir);
  let checks = 0;

  // Unpacked electron-builder output dirs
  for (const dirName of ['mac', 'mac-arm64', 'mac-x64', 'win-unpacked', 'linux-unpacked']) {
    const dir = path.join(releaseDir, dirName);
    if (!fs.existsSync(dir)) continue;
    if (dirName.startsWith('mac')) {
      const apps = fs.readdirSync(dir).filter((n) => n.endsWith('.app'));
      for (const app of apps) {
        verifyMacAppBundle(path.join(dir, app));
        checks++;
      }
    } else if (dirName === 'win-unpacked') {
      verifyWinDir(dir);
      checks++;
    } else if (dirName === 'linux-unpacked') {
      verifyLinuxDir(dir);
      checks++;
    }
  }

  // Packed zips (mac / win)
  for (const file of all) {
    if (!file.endsWith('.zip')) continue;
    if (/blockmap/i.test(file)) continue;
    verifyZipArchive(file);
    checks++;
  }

  // AppImage: look for squashfs yt-dlp via --appimage-extract is heavy; skip unless linux-unpacked missing
  // Deb packages are validated via linux-unpacked when present.

  if (checks === 0) {
    fail(`No packaged mac/win/linux outputs found under ${releaseDir}`);
  }

  ok(`Verified ${checks} package surface(s) under ${releaseDir}`);
}

main();
