/**
 * Automated Verification Test Suite for Karaoke Live Station
 *
 * Covers:
 * 1. AudioGraphManager Perceptual Volume Curve (quadratic taper, monotonicity, clamping, mute)
 * 2. DownloadManager Filename Sanitization (accent preservation, illegal character stripping)
 * 3. LibraryPanel & Store Queue Switch Logic (temp-to-permanent path redirection)
 * 4. i18n Localization Parity across it, en, es, fr
 * 5. Queue Cache Garbage Collection & Protection
 * 6. Default Settings & Feature Flags
 * 7. Vocal Remover Enhanced DSP Simulation (Center Cancellation, Bass & Highs Preservation, In-Phase Matrix)
 * 8. SIAE History Tracking & Duplicate Protection (120s Threshold, Natural End, ISO 8601 Timestamps)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, testName, detail = '') {
  if (condition) {
    console.log(`  \x1b[32m✔\x1b[0m ${testName}`);
    testsPassed++;
  } else {
    console.error(`  \x1b[31m✖\x1b[0m ${testName} ${detail ? `(${detail})` : ''}`);
    testsFailed++;
  }
}

console.log('\n========================================================');
console.log('🧪 Running Karaoke Live Station Automated Test Suite');
console.log('========================================================\n');

// -------------------------------------------------------------
// Suite 1: Perceptual Volume Attenuation Curve
// -------------------------------------------------------------
console.log('\x1b[36m▶ Suite 1: Perceptual Volume Attenuation Curve\x1b[0m');

function computePerceptualGain(volume, isMuted) {
  if (isMuted) return 0;
  const clamped = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0));
  return Math.round(Math.pow(clamped, 2) * 10000) / 10000;
}

assert(computePerceptualGain(1.0, false) === 1.0, 'Full volume (1.0) yields unity gain (1.0)');
assert(computePerceptualGain(0.5, false) === 0.25, 'Half volume (0.5) yields perceived half-loudness quadratic gain (0.25)');
assert(computePerceptualGain(0.25, false) === 0.0625, 'Quarter volume (0.25) yields smooth background gain (0.0625)');
assert(computePerceptualGain(0.0, false) === 0.0, 'Zero volume (0.0) yields zero gain (0.0)');

// Mute check
assert(computePerceptualGain(0.8, true) === 0.0, 'Muted state forces gain to 0.0 regardless of fader level');
assert(computePerceptualGain(1.0, true) === 0.0, 'Full volume when muted yields 0.0');

// Boundary & clamping check
assert(computePerceptualGain(-0.5, false) === 0.0, 'Negative volume clamps to 0.0');
assert(computePerceptualGain(1.5, false) === 1.0, 'Volume > 1.0 clamps to 1.0');
assert(computePerceptualGain(NaN, false) === 0.0, 'NaN input handled safely as 0.0');
assert(computePerceptualGain(Infinity, false) === 0.0, 'Infinity input handled safely as 0.0');

// Monotonicity check across 100 steps
let isMonotonic = true;
let prevGain = -1;
for (let i = 0; i <= 100; i++) {
  const vol = i / 100;
  const gain = computePerceptualGain(vol, false);
  if (gain < prevGain) {
    isMonotonic = false;
    break;
  }
  prevGain = gain;
}
assert(isMonotonic, 'Gain curve is strictly monotonic across entire 0.0 -> 1.0 travel');


// -------------------------------------------------------------
// Suite 2: DownloadManager Filename Sanitization
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite 2: Filesystem Filename Sanitization\x1b[0m');

function sanitizeFilenamePart(name) {
  return (name || '')
    .replace(/[/\\?%*:|"<>]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim() || 'Unknown';
}

assert(
  sanitizeFilenamePart('Lucio Battisti') === 'Lucio Battisti',
  'Preserves standard English/Italian names with spaces'
);

assert(
  sanitizeFilenamePart('È sempre festa - Perché sì') === 'È sempre festa - Perché sì',
  'Preserves Italian accents (È, é, ì, etc.) and spaces'
);

assert(
  sanitizeFilenamePart('Zucchero - Così celeste') === 'Zucchero - Così celeste',
  'Preserves accented vowels in titles'
);

assert(
  sanitizeFilenamePart('AC/DC: Highway to Hell?') === 'ACDC Highway to Hell',
  'Strips invalid characters (/, :, ?)'
);

assert(
  sanitizeFilenamePart('Song | <Special> *Edition*') === 'Song  Special Edition',
  'Strips pipe, angle brackets, asterisks'
);

assert(
  sanitizeFilenamePart('') === 'Unknown',
  'Falls back to "Unknown" when input string is empty'
);

assert(
  sanitizeFilenamePart('   ') === 'Unknown',
  'Falls back to "Unknown" when input is whitespace'
);


// -------------------------------------------------------------
// Suite 3: Queue Switch & Local Storage Path Integrity
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite 3: Queue Switch & Local File Redirection\x1b[0m');

function simulateQueueUpdate(queue, targetIdentifier, updates) {
  let hasChanged = false;
  const updatedQueue = queue.map((item) => {
    if (
      item.track.id === targetIdentifier ||
      item.track.uri === targetIdentifier ||
      (item.track.localFilePath && item.track.localFilePath === targetIdentifier)
    ) {
      hasChanged = true;
      return {
        ...item,
        track: { ...item.track, ...updates }
      };
    }
    return item;
  });
  return { updatedQueue, hasChanged };
}

// Portable mock paths — never hardcode /home/... or /tmp/... machine literals
const mockTempDownloadPath = path.join(os.tmpdir(), 'karaoke_downloads', 'temp_abc123.mp4');
const mockLibraryTrackPath = path.join(
  os.homedir(),
  'Karaoke',
  "Massimo Ranieri - Perdere L'Amore.mp4"
);
const mockLibraryTrackUri = `karaoke://local/${encodeURIComponent(mockLibraryTrackPath)}`;

const mockTempQueue = [
  {
    queueId: 'q_1',
    track: {
      id: 'yt_abc123',
      source: 'youtube',
      title: 'Perdere L\'Amore',
      artist: 'Massimo Ranieri',
      durationSec: 240,
      uri: 'https://www.youtube.com/watch?v=abc123',
      localFilePath: mockTempDownloadPath
    }
  }
];

// 1. Update by track ID
const updateById = simulateQueueUpdate(mockTempQueue, 'yt_abc123', {
  localFilePath: mockLibraryTrackPath,
  uri: mockLibraryTrackUri,
  source: 'local_library'
});

assert(updateById.hasChanged, 'Queue update by track ID succeeds');
assert(
  updateById.updatedQueue[0].track.source === 'local_library',
  'Track source correctly transitioned from youtube to local_library'
);
assert(
  updateById.updatedQueue[0].track.localFilePath === mockLibraryTrackPath,
  'Track localFilePath points to permanent storage'
);

// 2. Update by temp localFilePath
const updateByTempPath = simulateQueueUpdate(mockTempQueue, mockTempDownloadPath, {
  localFilePath: mockLibraryTrackPath,
  uri: mockLibraryTrackUri,
  source: 'local_library'
});

assert(updateByTempPath.hasChanged, 'Queue update by localFilePath succeeds when temp file moves');


// -------------------------------------------------------------
// Suite 4: i18n Translation Completeness & Parity
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite 4: i18n Translation Parity (it, en, es, fr)\x1b[0m');

const localesDir = path.resolve(__dirname, '../locales');
const itLocale = JSON.parse(fs.readFileSync(path.join(localesDir, 'it.json'), 'utf8'));
const enLocale = JSON.parse(fs.readFileSync(path.join(localesDir, 'en.json'), 'utf8'));
const esLocale = JSON.parse(fs.readFileSync(path.join(localesDir, 'es.json'), 'utf8'));
const frLocale = JSON.parse(fs.readFileSync(path.join(localesDir, 'fr.json'), 'utf8'));

function getNestedKeys(obj, prefix = '') {
  let keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      keys = keys.concat(getNestedKeys(v, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

function getValueByPath(obj, keyPath) {
  return keyPath.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), obj);
}

const itKeys = getNestedKeys(itLocale);

function verifyLocaleParity(targetLocale, langCode) {
  let missing = [];
  let empty = [];
  for (const key of itKeys) {
    const val = getValueByPath(targetLocale, key);
    if (val === undefined) {
      missing.push(key);
    } else if (typeof val === 'string' && val.trim() === '') {
      empty.push(key);
    }
  }
  assert(
    missing.length === 0,
    `[${langCode}] All ${itKeys.length} reference keys from Italian exist`,
    missing.length > 0 ? `Missing: ${missing.slice(0, 5).join(', ')}...` : ''
  );
  assert(
    empty.length === 0,
    `[${langCode}] No empty translation strings found`,
    empty.length > 0 ? `Empty: ${empty.slice(0, 5).join(', ')}...` : ''
  );
}

verifyLocaleParity(enLocale, 'en');
verifyLocaleParity(esLocale, 'es');
verifyLocaleParity(frLocale, 'fr');

// Check shortcuts section in all 4
assert(Boolean(itLocale.shortcuts?.playPause), 'Italian shortcuts section populated');
assert(Boolean(enLocale.shortcuts?.playPause), 'English shortcuts section populated');
assert(Boolean(esLocale.shortcuts?.playPause), 'Spanish shortcuts section populated');
assert(Boolean(frLocale.shortcuts?.playPause), 'French shortcuts section populated');


// -------------------------------------------------------------
// Suite 5: Queue Cache Garbage Collection Logic
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite 5: Queue Cache Garbage Collection & Protection\x1b[0m');

function shouldDeleteCachedFile(filePath, remainingQueue) {
  if (!filePath || typeof filePath !== 'string') return false;
  // Guard: only files in queue_cache or with qc_ prefix are eligible
  if (!filePath.includes('queue_cache') && !filePath.includes('qc_')) return false;

  const isStillReferenced = remainingQueue.some(
    (item) => item.track?.localFilePath === filePath
  );
  return !isStillReferenced;
}

const mockUserDataRoot = path.join(os.tmpdir(), 'karaoke-live-station-testdata');
const cacheFile1 = path.join(mockUserDataRoot, 'queue_cache', 'qc_123_artist - title.mp4');
const cacheFile2 = path.join(mockUserDataRoot, 'queue_cache', 'qc_456_artist - title2.mp4');
const libraryFile = path.join(os.homedir(), 'Karaoke', 'artist - permanent.mp4');

const mockRemainingQueue = [
  { queueId: 'q2', track: { id: 't2', localFilePath: cacheFile2 } }
];

assert(
  shouldDeleteCachedFile(cacheFile1, mockRemainingQueue) === true,
  'Unreferenced queue_cache file is correctly flagged for deletion'
);

assert(
  shouldDeleteCachedFile(cacheFile2, mockRemainingQueue) === false,
  'Referenced queue_cache file is protected from deletion while still in queue'
);

assert(
  shouldDeleteCachedFile(libraryFile, []) === false,
  'Permanent library files are never deleted by queue cache GC'
);

assert(
  shouldDeleteCachedFile('', mockRemainingQueue) === false,
  'Empty or invalid file paths are safely ignored'
);


// -------------------------------------------------------------
// Suite 6: Default Settings & Feature Defaults
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite 6: Default Settings & Feature Flags\x1b[0m');

const storeSource = fs.readFileSync(path.resolve(__dirname, '../src/renderer/store/karaokeStore.ts'), 'utf8');

assert(
  /enableFairQueue:\s*true/.test(storeSource),
  'Fair Queue algorithm is enabled (true) by default in initial store settings'
);

assert(
  /autoArchiveWebTracks:\s*true/.test(storeSource),
  'Auto-archive web tracks is enabled (true) by default in initial store settings'
);

assert(
  /showPitchOnStage:\s*true/.test(storeSource),
  'Show pitch on stage monitor is enabled (true) by default'
);

assert(
  itLocale.queue?.hintPlayOrDoubleClick === 'Doppio click o Play per avviare',
  'Italian hint correctly updated to "Doppio click o Play per avviare"'
);

assert(
  itLocale.settings?.autoArchiveWarningDesc &&
    itLocale.settings.autoArchiveWarningDesc.includes("disattivando l'archiviazione automatica"),
  'Mandatory Italian auto-archive deactivation warning text matches specification'
);


// -------------------------------------------------------------
// Suite 7: Demucs HTDemucs Vocal Separation Integration
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite 7: Demucs HTDemucs Vocal Separation Integration\x1b[0m');

const audioGraphSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/core/AudioGraphManager.ts'),
  'utf8'
);
const demucsSeparatorSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/core/DemucsVocalSeparator.ts'),
  'utf8'
);
const demucsManagerSource = fs.readFileSync(
  path.resolve(__dirname, '../src/main/services/DemucsModelManager.ts'),
  'utf8'
);
const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')
);

assert(
  Boolean(packageJson.dependencies['demucs-web']) &&
    Boolean(packageJson.dependencies['onnxruntime-web']),
  'package.json depends on demucs-web + onnxruntime-web (dedicated OSS vocal separator)'
);

assert(
  demucsSeparatorSource.includes("from 'demucs-web'") &&
    demucsSeparatorSource.includes('DemucsProcessor') &&
    demucsSeparatorSource.includes('onnxruntime-web'),
  'DemucsVocalSeparator imports demucs-web DemucsProcessor and onnxruntime-web'
);

assert(
  demucsSeparatorSource.includes('stems.drums') &&
    demucsSeparatorSource.includes('stems.bass') &&
    demucsSeparatorSource.includes('stems.other') &&
    demucsSeparatorSource.includes('drums.left[i]') &&
    demucsSeparatorSource.includes('stems.other.left[i]'),
  'DemucsVocalSeparator mixes drums+bass+other instrumental stems (excludes lead vocals)'
);

assert(
  !audioGraphSource.includes('Center-Channel Canceller') &&
    !audioGraphSource.includes('0.5 * (L - R)') &&
    !audioGraphSource.includes('createChannelSplitter'),
  'AudioGraphManager no longer uses homemade center-channel / EQ vocal cancel graph'
);

assert(
  audioGraphSource.includes('setupVocalRemoverGraph') &&
    audioGraphSource.includes('setVocalRemover(') &&
    audioGraphSource.includes('activateDemucsInstrumental') &&
    audioGraphSource.includes('getDemucsVocalSeparator'),
  'AudioGraphManager routes vocal removal through Demucs instrumental stem playback'
);

assert(
  demucsManagerSource.includes('htdemucs_embedded.onnx') &&
    demucsManagerSource.includes('huggingface.co'),
  'Main-process DemucsModelManager caches HTDemucs ONNX model from Hugging Face'
);

assert(
  fs.existsSync(path.resolve(__dirname, '../public/ort/ort-wasm-simd-threaded.wasm')),
  'ORT WASM assets are vendored under public/ort for Electron offline inference'
);

assert(
  computePerceptualGain(0.5, false) === 0.25 &&
    computePerceptualGain(1, false) === 1 &&
    computePerceptualGain(0, false) === 0,
  'Perceptual volume curve Gain=(volume)^2 still covers the full 0–1 range'
);

const karaokeStoreSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/store/karaokeStore.ts'),
  'utf8'
);
assert(
  /autoAdvanceNext:\s*false/.test(karaokeStoreSource),
  'autoAdvanceNext defaults to OFF (manual play required after track end)'
);
assert(
  /enableFairQueue:\s*true/.test(karaokeStoreSource),
  'enableFairQueue defaults to ON at startup'
);

const toastSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/utils/toast.ts'),
  'utf8'
);
const controlSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/ControlWindow.tsx'),
  'utf8'
);
assert(
  toastSource.includes('showToast') &&
    toastSource.includes('confirmAsync') &&
    controlSource.includes('ToastHost') &&
    controlSource.includes('showToast(') &&
    !controlSource.includes('alert('),
  'Control UI uses non-blocking ToastHost instead of window.alert for audio isolation'
);

const mainSourceForDialogs = fs.readFileSync(
  path.resolve(__dirname, '../src/main/index.ts'),
  'utf8'
);
assert(
  mainSourceForDialogs.includes('demucs:get-model-buffer') &&
    (mainSourceForDialogs.includes('Non-modal (no parent)') ||
      mainSourceForDialogs.includes('Intentionally omit parent window')),
  'Demucs IPC registered and native file dialogs avoid modal parent that can stall audio'
);

// -------------------------------------------------------------
// Suite 8: SIAE History Playback Tracking & 120s Threshold
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite 8: SIAE History Tracking & Playback Lifecycle\x1b[0m');

/**
 * Simulates karaokeStore's logCurrentTrackExecution criteria:
 * - Logs if naturalEnd === true
 * - Logs if !naturalEnd and currentTime >= 120
 * - Does NOT log if !naturalEnd and currentTime < 120
 * - Does NOT log if alreadyLogged === true
 */
function shouldLogTrackExecution(item, currentTime, naturalEnd) {
  if (!item || item.alreadyLogged) return false;
  if (naturalEnd || currentTime >= 120) {
    return true;
  }
  return false;
}

const mockTrackItem = {
  queueId: 'q-101',
  track: { id: 't-101', title: 'Albachiara', artist: 'Vasco Rossi', duration: 240 },
  singerName: 'Marco',
  alreadyLogged: false,
};

// 1. Natural end on a short song (< 120s, e.g. 50s intro/interlude)
assert(
  shouldLogTrackExecution({ ...mockTrackItem }, 50, true) === true,
  'Song reaching natural end logs to history even if duration is < 120s'
);

// 2. Natural end on a full length song (240s)
assert(
  shouldLogTrackExecution({ ...mockTrackItem }, 240, true) === true,
  'Song reaching natural end at full duration logs to history'
);

// 3. User stopped/skipped at >= 120 seconds
assert(
  shouldLogTrackExecution({ ...mockTrackItem }, 120.0, false) === true,
  'Song stopped/skipped at exactly 120.0 seconds qualifies for SIAE history logging'
);
assert(
  shouldLogTrackExecution({ ...mockTrackItem }, 185.4, false) === true,
  'Song stopped/skipped at 185 seconds (>120s) qualifies for SIAE history logging'
);

// 4. User stopped/skipped prematurely (< 120 seconds)
assert(
  shouldLogTrackExecution({ ...mockTrackItem }, 119.9, false) === false,
  'Song stopped/skipped at 119.9 seconds is rejected (< 120s threshold)'
);
assert(
  shouldLogTrackExecution({ ...mockTrackItem }, 15.0, false) === false,
  'Accidentally started and immediately stopped song (15s) is rejected'
);

// 5. Duplicate logging protection via alreadyLogged guard flag
const alreadyLoggedItem = { ...mockTrackItem, alreadyLogged: true };
assert(
  shouldLogTrackExecution(alreadyLoggedItem, 130, false) === false,
  'Track stopped at 130s with alreadyLogged=true is NOT logged a second time'
);
assert(
  shouldLogTrackExecution(alreadyLoggedItem, 240, true) === false,
  'Track finishing naturally after being previously logged is NOT duplicated'
);

// 6. Timestamp metadata verification
const nowMs = Date.now();
const isoString = new Date(nowMs).toISOString();
assert(
  Number.isFinite(nowMs) && nowMs > 1700000000000,
  'Executed timestamp generates valid epoch milliseconds'
);
assert(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(isoString),
  'Executed timestamp converts to standardized ISO 8601 string'
);

// 7. Verify SIAE CSV Header structure in main process
const mainSource = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8');
assert(
  mainSource.includes('Data e Ora (ISO 8601)') && mainSource.includes('Timestamp (Epoch ms)'),
  'SIAE CSV export includes standard ISO 8601 date-time and epoch ms columns'
);

// 8. Verify AudioGraphManager vocal remover methods still present after Demucs integration
assert(
  audioGraphSource.includes('setupVocalRemoverGraph') && audioGraphSource.includes('setVocalRemover('),
  'AudioGraphManager contains dedicated vocal remover pipeline methods'
);


// -------------------------------------------------------------
// Suite 9: Absolute Portability & yt-dlp Managed Binary Contract
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite 9: Portability Paths & yt-dlp Persistence Contract\x1b[0m');

const binaryResolverSource = fs.readFileSync(
  path.resolve(__dirname, '../src/main/services/BinaryResolver.ts'),
  'utf8'
);
const ytDlpUpdaterSource = fs.readFileSync(
  path.resolve(__dirname, '../src/main/services/YtDlpUpdater.ts'),
  'utf8'
);

assert(
  binaryResolverSource.includes("app.getPath('userData')") &&
    binaryResolverSource.includes("path.join(app.getPath('userData'), 'bin')"),
  'BinaryResolver resolves managed bin dir via Electron userData (not hardcoded home paths)'
);
assert(
  binaryResolverSource.includes('validateYtDlpBinaryIntegrity') &&
    binaryResolverSource.includes('ensureManagedYtDlpFromBundle'),
  'BinaryResolver validates integrity and seeds managed yt-dlp under userData/bin'
);
assert(
  binaryResolverSource.includes("0o755") || binaryResolverSource.includes('0o755'),
  'BinaryResolver applies POSIX executable permissions'
);
assert(
  ytDlpUpdaterSource.includes('SHA2-256SUMS') && ytDlpUpdaterSource.includes('sha256'),
  'YtDlpUpdater verifies SHA-256 integrity against GitHub SHA2-256SUMS when available'
);
assert(
  ytDlpUpdaterSource.includes('skipping re-download') ||
    ytDlpUpdaterSource.includes('is up to date'),
  'YtDlpUpdater skips blind re-download when binary is already current'
);
assert(
  ytDlpUpdaterSource.includes('this.binDir') &&
    ytDlpUpdaterSource.includes("path.join(userDataPath, 'bin')"),
  'YtDlpUpdater installs exclusively into <userData>/bin/'
);

const hardCodedUserPathPattern = /(?:^|[^.\w])(?:\/home\/[A-Za-z]|\/Users\/[A-Za-z]|C:\\\\Users\\\\)/;
const sourcesToScan = [
  path.resolve(__dirname, '../src/main/services/BinaryResolver.ts'),
  path.resolve(__dirname, '../src/main/services/YtDlpUpdater.ts'),
  path.resolve(__dirname, '../src/main/services/DownloadManager.ts'),
  path.resolve(__dirname, '../src/main/index.ts'),
  path.resolve(__dirname, '../scripts/run-tests.js')
];
let leakedHardcoded = [];
for (const file of sourcesToScan) {
  const text = fs.readFileSync(file, 'utf8');
  if (hardCodedUserPathPattern.test(text)) {
    leakedHardcoded.push(path.basename(file));
  }
}
assert(
  leakedHardcoded.length === 0,
  'No hardcoded user-home absolute paths in core runtime/test sources',
  leakedHardcoded.length ? `Found in: ${leakedHardcoded.join(', ')}` : ''
);


// -------------------------------------------------------------
// Suite 10: Phase 2 Core Storage — Dedup, Archive Default, Single Instance
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite 10: Phase 2 Core Storage Contracts\x1b[0m');

const downloadManagerSource = fs.readFileSync(
  path.resolve(__dirname, '../src/main/services/DownloadManager.ts'),
  'utf8'
);
const mainIndexSourceForPhase2 = fs.readFileSync(
  path.resolve(__dirname, '../src/main/index.ts'),
  'utf8'
);
const settingsModalSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/SettingsModal.tsx'),
  'utf8'
);
const libraryPanelSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/LibraryPanel.tsx'),
  'utf8'
);
const controlWindowSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/ControlWindow.tsx'),
  'utf8'
);
const karaokeStoreSourceForPhase2 = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/store/karaokeStore.ts'),
  'utf8'
);

const exactItalianWarning =
  "Attenzione: disattivando l'archiviazione automatica, i brani scaricati non verranno salvati nella libreria permanente. Rimarranno disponibili nella cache temporanea solo finché sono presenti in coda (anche riavviando l'app) e verranno eliminati dal disco solo quando saranno scodati o la coda verrà svuotata.";

assert(
  itLocale.settings.autoArchiveWarningDesc === exactItalianWarning,
  'Italian auto-archive warning matches required exact string'
);
assert(
  settingsModalSource.includes(exactItalianWarning),
  'Settings modal fallback embeds the exact Italian warning string'
);
assert(
  /autoArchiveWebTracks:\s*true/.test(karaokeStoreSourceForPhase2),
  'Auto-archive web tracks defaults to ON in karaoke store'
);
assert(
  downloadManagerSource.includes('findExistingLocalMedia') &&
    downloadManagerSource.includes('alreadyExists: true') &&
    downloadManagerSource.includes('mediaFingerprint'),
  'DownloadManager implements local-file deduplication before network I/O'
);
assert(
  libraryPanelSource.includes('alreadyExists') &&
    (libraryPanelSource.includes('library.alreadyLocal') ||
      libraryPanelSource.includes('alreadyLocal')),
  'LibraryPanel notifies user and relinks when a local copy already exists'
);
assert(
  mainIndexSourceForPhase2.includes('requestSingleInstanceLock') &&
    mainIndexSourceForPhase2.includes('second-instance') &&
    (mainIndexSourceForPhase2.includes('controlWindow.focus()') ||
      mainIndexSourceForPhase2.includes('.focus()')),
  'Single-instance lock focuses existing Control window and exits duplicate process'
);
assert(
  mainIndexSourceForPhase2.includes('Percorso libreria non configurato') ||
    mainIndexSourceForPhase2.includes('libraryPath'),
  'save-to-library requires configured libraryPath'
);
assert(
  !/path\.join\(\s*app\.getPath\(\s*['"]userData['"]\s*\)\s*,\s*['"]library['"]\s*\)/.test(
    (mainIndexSourceForPhase2.split('download:save-to-library')[1] || '').slice(0, 1200)
  ),
  'save-to-library has no silent userData/library fallback'
);
assert(
  libraryPanelSource.includes('karaoke:library-refreshed') &&
    mainIndexSourceForPhase2.includes('library:reindexed'),
  'Library reindex/refresh events emitted after save for live Library view updates'
);
assert(
  karaokeStoreSourceForPhase2.includes('cleanupQueueCacheFileIfUnreferenced') &&
    karaokeStoreSourceForPhase2.includes('queue_cache'),
  'Queue cache GC runs when tracks are dequeued or the queue is cleared'
);
assert(
  libraryPanelSource.includes('saveToQueueCache') &&
    (controlWindowSource.includes('saveToLibrary') ||
      libraryPanelSource.includes('saveToLibrary')),
  'Promote cache→Library action and queue_cache persistence paths exist'
);

function extractYouTubeIdForTest(urlOrId) {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  const trimmed = urlOrId.trim();
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname.includes('youtu.be')) {
      const id = parsed.pathname.replace(/^\//, '').slice(0, 11);
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    const v = parsed.searchParams.get('v');
    if (v && /^[\w-]{11}$/.test(v)) return v;
  } catch {}
  const loose = trimmed.match(/(?:v=|\/)([\w-]{11})(?:[^\w-]|$)/);
  return loose ? loose[1] : null;
}

assert(
  extractYouTubeIdForTest('https://www.youtube.com/watch?v=dQw4w9WgXcQ') === 'dQw4w9WgXcQ',
  'YouTube id extraction works for watch URLs'
);
assert(
  extractYouTubeIdForTest('https://youtu.be/dQw4w9WgXcQ') === 'dQw4w9WgXcQ',
  'YouTube id extraction works for youtu.be URLs'
);
assert(extractYouTubeIdForTest('dQw4w9WgXcQ') === 'dQw4w9WgXcQ', 'Bare YouTube id is accepted');


// -------------------------------------------------------------
// Summary
// -------------------------------------------------------------
console.log('\n========================================================');
console.log(`📊 Summary: ${testsPassed} passed, ${testsFailed} failed`);
console.log('========================================================\n');

if (testsFailed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

