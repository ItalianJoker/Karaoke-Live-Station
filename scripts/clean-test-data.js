#!/usr/bin/env node

/**
 * scripts/clean-test-data.js
 *
 * Cleans all development/test artifacts, databases, and temporary caches
 * before packaging a clean production release.
 *
 * Ensures:
 * 1. Zero test songs or test data in SQLite database.
 * 2. Zero cached thumbnails or temp downloads.
 * 3. Fresh first-run state for settings and library initialization.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();

// Potential userData directories across platforms
const CANDIDATE_USER_DATA_DIRS = [
  // Linux
  path.join(HOME, '.config', 'karaoke-live-station'),
  path.join(HOME, '.config', 'Karaoke Live Station'),
  // macOS
  path.join(HOME, 'Library', 'Application Support', 'karaoke-live-station'),
  path.join(HOME, 'Library', 'Application Support', 'Karaoke Live Station'),
  // Windows (if run under Wine or Windows)
  process.env.APPDATA ? path.join(process.env.APPDATA, 'karaoke-live-station') : null,
  process.env.APPDATA ? path.join(process.env.APPDATA, 'Karaoke Live Station') : null,
  // Local workspace temp
  path.resolve(__dirname, '..', 'userData'),
  path.resolve(__dirname, '..', 'temp')
].filter(Boolean);

function cleanDirectory(dirPath, isRoot = false) {
  if (!fs.existsSync(dirPath)) return;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    // Preserve managed durable assets (yt-dlp under bin/, ORT under ort/, AI models under models/)
    if (entry.name === 'bin' || entry.name === 'ort' || entry.name === 'models' || entry.name === 'soundfonts') {
      continue;
    }

    if (entry.isDirectory()) {
      cleanDirectory(fullPath);
      try {
        fs.rmdirSync(fullPath);
      } catch {}
    } else {
      try {
        fs.unlinkSync(fullPath);
        console.log(`[clean-test-data] Removed: ${fullPath}`);
      } catch (err) {
        console.warn(`[clean-test-data] Could not remove ${fullPath}: ${err.message}`);
      }
    }
  }

  if (!isRoot) {
    try {
      fs.rmdirSync(dirPath);
    } catch {}
  }
}

console.log('[clean-test-data] Cleaning test databases, thumbnails, and cache files...');

let cleanedCount = 0;

for (const dir of CANDIDATE_USER_DATA_DIRS) {
  if (fs.existsSync(dir)) {
    console.log(`[clean-test-data] Found userData directory: ${dir}`);
    
    // Target specific test data files
    const targets = [
      path.join(dir, 'karaoke_station.db'),
      path.join(dir, 'karaoke_station.db-wal'),
      path.join(dir, 'karaoke_station.db-shm'),
      path.join(dir, 'Preferences'),
      path.join(dir, 'Local Storage'),
      path.join(dir, 'Session Storage'),
      path.join(dir, 'thumbnails'),
      path.join(dir, 'temp'),
      path.join(dir, 'logs')
    ];

    for (const target of targets) {
      if (fs.existsSync(target)) {
        try {
          const stat = fs.statSync(target);
          if (stat.isDirectory()) {
            cleanDirectory(target);
            try { fs.rmdirSync(target); } catch {}
          } else {
            fs.unlinkSync(target);
          }
          console.log(`[clean-test-data] Cleaned: ${target}`);
          cleanedCount++;
        } catch (err) {
          console.warn(`[clean-test-data] Warning on ${target}: ${err.message}`);
        }
      }
    }
  }
}

// Also check project directory for any stray .sqlite or .db files
const projectRoot = path.resolve(__dirname, '..');
const projectEntries = fs.readdirSync(projectRoot);
for (const entry of projectEntries) {
  if (/\.(db|sqlite|sqlite3)$/i.test(entry)) {
    const strayPath = path.join(projectRoot, entry);
    try {
      fs.unlinkSync(strayPath);
      console.log(`[clean-test-data] Removed stray project file: ${strayPath}`);
      cleanedCount++;
    } catch {}
  }
}

console.log(`[clean-test-data] Database and test cache cleanup complete (${cleanedCount} items cleaned).`);

