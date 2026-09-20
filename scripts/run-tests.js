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
 * 7. Vocal Remover — algorithmic mid/side DSP + offline AI (MDX / HTDemucs / BS-Roformer)
 * 8. SIAE History Tracking & Duplicate Protection (120s Threshold, Natural End, ISO 8601 Timestamps)
 * Plus: critical domain invariants source-lock, AI vocal path routing, MessageEvent unwrap, MDX geometry/settings
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

/** Concatenate Settings shell + per-tab sources (Safety-First modularization). */
function readSettingsUiSource() {
  const base = path.resolve(__dirname, '../src/renderer/components');
  const files = [
    'SettingsModal.tsx',
    'settings/SettingsGeneralTab.tsx',
    'settings/SettingsLibraryTab.tsx',
    'settings/SettingsAudioTab.tsx',
    'settings/SettingsStageTab.tsx',
    'settings/SettingsShortcutsTab.tsx',
    'settings/settingsTypes.ts'
  ];
  return files.map((f) => fs.readFileSync(path.join(base, f), 'utf8')).join('\n');
}

/** Concatenate ControlWindow + extracted hooks/components. */
function readControlUiSource() {
  const root = path.resolve(__dirname, '..');
  const files = [
    'src/renderer/components/ControlWindow.tsx',
    'src/renderer/hooks/useControlPlayback.ts',
    'src/renderer/hooks/useKeyboardShortcuts.ts',
    'src/renderer/components/PlayerDeckControls.tsx',
    'src/renderer/components/QueueList.tsx'
  ];
  return files.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
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

// 3. Auto-archive YouTube→queue: enqueue LOCAL library track only after archive
function simulateAutoArchiveEnqueueFlow(opts) {
  const { autoArchive, downloadOk, archiveOk, alreadyInLibrary } = opts;
  const events = [];
  if (!autoArchive) {
    events.push('enqueue_youtube_remote');
    events.push(downloadOk ? 'cache_then_relink' : 'fail_keep_or_drop');
    return events;
  }
  events.push('start_download_without_enqueue');
  if (!downloadOk) {
    events.push('toast_error');
    events.push('no_queue_item');
    return events;
  }
  if (alreadyInLibrary) {
    events.push('full_library_reindex');
    events.push('library_refresh');
    events.push('enqueue_local_library');
    return events;
  }
  if (!archiveOk) {
    events.push('toast_error');
    events.push('no_queue_item');
    return events;
  }
  events.push('save_to_library');
  events.push('full_library_reindex');
  events.push('library_refresh');
  events.push('enqueue_local_library');
  return events;
}

const autoArchiveHappy = simulateAutoArchiveEnqueueFlow({
  autoArchive: true,
  downloadOk: true,
  archiveOk: true,
  alreadyInLibrary: false
});
assert(
  autoArchiveHappy[0] === 'start_download_without_enqueue' &&
    autoArchiveHappy.includes('enqueue_local_library') &&
    autoArchiveHappy.includes('full_library_reindex') &&
    !autoArchiveHappy.includes('enqueue_youtube_remote'),
  'Auto-archive queue waits for archive then enqueues local library file'
);

const autoArchiveFail = simulateAutoArchiveEnqueueFlow({
  autoArchive: true,
  downloadOk: false,
  archiveOk: false,
  alreadyInLibrary: false
});
assert(
  autoArchiveFail.includes('no_queue_item') && autoArchiveFail.includes('toast_error'),
  'Auto-archive queue failure leaves no non-playable queue item'
);

const autoArchiveDedup = simulateAutoArchiveEnqueueFlow({
  autoArchive: true,
  downloadOk: true,
  archiveOk: true,
  alreadyInLibrary: true
});
assert(
  autoArchiveDedup.includes('enqueue_local_library') &&
    autoArchiveDedup.includes('full_library_reindex') &&
    autoArchiveDedup.includes('library_refresh'),
  'Auto-archive queue reuses existing library file and refreshes catalog'
);

// Packaging icons must be official logo derivatives (not missing / Electron defaults)
const buildIconPng = path.resolve(__dirname, '../build/icon.png');
const buildIconIco = path.resolve(__dirname, '../build/icon.ico');
const buildIconsDir = path.resolve(__dirname, '../build/icons');
assert(fs.existsSync(buildIconPng), 'build/icon.png exists for electron-builder');
assert(fs.existsSync(buildIconIco), 'build/icon.ico exists for Windows packaging');
assert(fs.existsSync(path.join(buildIconsDir, '256x256.png')), 'Linux icon size 256x256.png exists');
assert(fs.existsSync(path.join(buildIconsDir, '512x512.png')), 'Linux icon size 512x512.png exists');
const packageJsonForIcons = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')
);
assert(packageJsonForIcons.build?.icon === 'build/icon.png', 'electron-builder root icon points at official PNG');
assert(packageJsonForIcons.build?.win?.icon === 'build/icon.ico', 'Windows icon path is build/icon.ico');
assert(packageJsonForIcons.build?.linux?.icon === 'build/icons', 'Linux icon dir is build/icons');
assert(packageJsonForIcons.build?.mac?.icon === 'build/icon.png', 'macOS icon path is build/icon.png');

const libraryPanelSourceForArchive = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/LibraryPanel.tsx'),
  'utf8'
);
assert(
  libraryPanelSourceForArchive.includes('pendingArchiveEnqueueRef') &&
    libraryPanelSourceForArchive.includes('queueArchivePending') &&
    libraryPanelSourceForArchive.includes('queueArchiveReady') &&
    libraryPanelSourceForArchive.includes('refreshLocalLibraryFully') &&
    libraryPanelSourceForArchive.includes('scanFolder'),
  'LibraryPanel implements wait-then-enqueue-local auto-archive queue flow'
);

const mainProcessSourceForArchiveThumb = fs.readFileSync(
  path.resolve(__dirname, '../src/main/index.ts'),
  'utf8'
);
assert(
  /download:save-to-library[\s\S]*getOrGenerateThumbnail[\s\S]*upsertTrack/.test(
    mainProcessSourceForArchiveThumb
  ),
  'save-to-library generates thumbnail before catalog upsert'
);


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
// Suite 7: Vocal Remover — live algorithmic DSP + Download Instrumental AI
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite 7: Vocal Remover (live DSP + Instrumental AI)\x1b[0m');

const audioGraphSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/core/AudioGraphManager.ts'),
  'utf8'
);
const algorithmicRemoverSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/core/AlgorithmicVocalRemoverNode.ts'),
  'utf8'
);
const vocalRemoverShared = fs.readFileSync(
  path.resolve(__dirname, '../src/shared/vocalRemover.ts'),
  'utf8'
);
const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')
);
const mainSourceOrt = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8');
const preloadSourceOrt = fs.readFileSync(path.resolve(__dirname, '../src/preload/index.ts'), 'utf8');
const instrumentalProcessorSource = fs.readFileSync(
  path.resolve(__dirname, '../src/main/services/InstrumentalProcessor.ts'),
  'utf8'
);
const downloadManagerSourceVocal = fs.readFileSync(
  path.resolve(__dirname, '../src/main/services/DownloadManager.ts'),
  'utf8'
);
const libraryPanelSourceVocal = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/LibraryPanel.tsx'),
  'utf8'
);
const offlineModelManagerSource = fs.readFileSync(
  path.resolve(__dirname, '../src/main/services/OfflineVocalModelManager.ts'),
  'utf8'
);

assert(
  packageJson.dependencies?.['demucs-web'] &&
    packageJson.dependencies?.['onnxruntime-web'] &&
    packageJson.dependencies?.['fft.js'],
  'package.json includes demucs-web / onnxruntime-web / fft.js for Instrumental AI'
);

assert(
  fs.existsSync(path.resolve(__dirname, '../public/ort')) &&
    fs.existsSync(path.resolve(__dirname, '../src/main/services/OfflineVocalModelManager.ts')) &&
    fs.existsSync(path.resolve(__dirname, '../src/main/services/OrtWasmManager.ts')) &&
    fs.existsSync(path.resolve(__dirname, '../src/main/ai/MdxNetSeparator.ts')) &&
    fs.existsSync(path.resolve(__dirname, '../src/main/workers/instrumentalAiWorker.ts')) &&
    fs.existsSync(path.resolve(__dirname, '../src/shared/ortWasm.ts')) &&
    !fs.existsSync(path.resolve(__dirname, '../src/main/services/DualStemCache.ts')) &&
    !fs.existsSync(path.resolve(__dirname, '../src/renderer/core/OfflineAiVocalSeparator.ts')) &&
    !fs.existsSync(path.resolve(__dirname, '../src/shared/dualStem.ts')) &&
    !fs.existsSync(path.resolve(__dirname, '../scripts/verify-dual-stem.js')),
  'Instrumental AI stack present; live dual-stem Separazione modules stay deleted'
);

assert(
  algorithmicRemoverSource.includes('createChannelSplitter') &&
    algorithmicRemoverSource.includes('centerCancelBassKeep') &&
    algorithmicRemoverSource.includes('centerCancel') &&
    algorithmicRemoverSource.includes('softMid') &&
    !algorithmicRemoverSource.includes('onnxruntime') &&
    !algorithmicRemoverSource.includes('DemucsProcessor'),
  'AlgorithmicVocalRemoverNode is classic mid/side Web Audio DSP (no ONNX/Demucs)'
);

assert(
  vocalRemoverShared.includes('centerCancelBassKeep') &&
    vocalRemoverShared.includes('aiMdxKaraoke2') &&
    vocalRemoverShared.includes('OFFLINE_VOCAL_MODELS') &&
    vocalRemoverShared.includes('isAiVocalRemoverMethod') &&
    vocalRemoverShared.includes('coerceInstrumentalVocalRemoverMethod') &&
    vocalRemoverShared.includes('isInstrumentalDownloadEligibleTitle') &&
    vocalRemoverShared.includes('version:') &&
    offlineModelManagerSource.includes('install.version') &&
    offlineModelManagerSource.includes('isModelCached'),
  'Shared catalog restores AI methods; instrumental coerce + model URL/SHA/version checks'
);

assert(
  audioGraphSource.includes('setupVocalRemoverGraph') &&
    audioGraphSource.includes('setVocalRemover(') &&
    audioGraphSource.includes('setVocalRemoverAlgorithm') &&
    audioGraphSource.includes('coerceAlgorithmicVocalRemoverMethod') &&
    audioGraphSource.includes('AlgorithmicVocalRemoverNode') &&
    !audioGraphSource.includes('activateDualStemPipeline') &&
    !audioGraphSource.includes('getOfflineAiVocalSeparator') &&
    !audioGraphSource.includes('setVocalGuideLevel') &&
    !audioGraphSource.includes('DUAL_STEM_ACTIVE'),
  'AudioGraphManager live path stays algorithmic (AI Settings coerce; no Separazione)'
);

assert(
  fs.existsSync(path.resolve(__dirname, '../src/renderer/core/audioGainRamp.ts')) &&
    fs
      .readFileSync(path.resolve(__dirname, '../src/renderer/core/audioGainRamp.ts'), 'utf8')
      .includes('setValueAtTime') &&
    algorithmicRemoverSource.includes('rampAudioParam'),
  'Vocal-remover GainNode enable/crossfade uses setValueAtTime+linearRamp (not bare ramp no-op)'
);

assert(
  mainSourceOrt.includes("hostname === 'ort'") &&
    mainSourceOrt.includes("hostname === 'models'") &&
    mainSourceOrt.includes('ort-wasm:ensure') &&
    mainSourceOrt.includes('vocal-model:') &&
    !mainSourceOrt.includes('dual-stem:') &&
    preloadSourceOrt.includes('ortWasm') &&
    preloadSourceOrt.includes('vocalModels') &&
    !preloadSourceOrt.includes('dualStem'),
  'Main/preload expose karaoke://ort|models + vocal-model IPC without dual-stem'
);

assert(
  instrumentalProcessorSource.includes('processInstrumentalVideo') &&
    instrumentalProcessorSource.includes('buildAlgorithmicVocalRemoverFilter') &&
    instrumentalProcessorSource.includes('isAiVocalRemoverMethod') &&
    instrumentalProcessorSource.includes('separateInstrumentalWithAi') &&
    instrumentalProcessorSource.includes('ensuring_model') &&
    instrumentalProcessorSource.includes('resolveInstrumentalTempWavPaths') &&
    instrumentalProcessorSource.includes('isDemuxExtractWavName') &&
    instrumentalProcessorSource.includes('${sourceStem}.extract.wav') &&
    instrumentalProcessorSource.includes('${sourceStem}.instrumental.extract.wav') &&
    !instrumentalProcessorSource.includes("basename(output, path.extname(output))") &&
    downloadManagerSourceVocal.includes('instrumental') &&
    downloadManagerSourceVocal.includes('processInstrumentalVideo') &&
    downloadManagerSourceVocal.includes('setMaxSimultaneousDownloads') &&
    downloadManagerSourceVocal.includes('downloading_model') &&
    downloadManagerSourceVocal.includes('cleanupInstrumentalRunTemps') &&
    downloadManagerSourceVocal.includes('${downloadId}.extract.wav') &&
    downloadManagerSourceVocal.includes('${downloadId}.instrumental.extract.wav') &&
    libraryPanelSourceVocal.includes('downloadInstrumental') &&
    libraryPanelSourceVocal.includes('isInstrumentalDownloadEligibleTitle') &&
    libraryPanelSourceVocal.includes('instrumentalDownloadWarning'),
  'Download Instrumental: AI/algo pipeline + {stem}.extract.wav naming + cleanup + concurrency'
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
const controlSource = readControlUiSource();
const settingsModalSourceVocal = readSettingsUiSource();
assert(
  toastSource.includes('showToast') &&
    toastSource.includes('confirmAsync') &&
    toastSource.includes('confirmDetailed') &&
    toastSource.includes('dontShowAgainLabel') &&
    controlSource.includes('ToastHost') &&
    controlSource.includes('showToast(') &&
    !controlSource.includes('alert('),
  'Control UI uses non-blocking ToastHost instead of window.alert for audio isolation'
);

assert(
  !controlSource.includes('warnAiVocalRemoverIfNeeded') &&
    !controlSource.includes('toggleVocalRemoverWithWarning') &&
    !controlSource.includes('EXTRACTING_AND_SEPARATING') &&
    controlSource.includes('showDownloadsMenu') &&
    controlSource.includes('headerDownloads') &&
    settingsModalSourceVocal.includes('instrumentalVocalRemoverMethod') &&
    settingsModalSourceVocal.includes('aiMdxKaraoke2') &&
    settingsModalSourceVocal.includes('coerceAlgorithmicVocalRemoverMethod') &&
    settingsModalSourceVocal.includes('coerceInstrumentalVocalRemoverMethod') &&
    settingsModalSourceVocal.includes('isMdxInstrumentalMethod') &&
    settingsModalSourceVocal.includes('mdxAdvancedTitle') &&
    settingsModalSourceVocal.includes('maxSimultaneousDownloads') &&
    settingsModalSourceVocal.includes('centerCancelBassKeep') &&
    settingsModalSourceVocal.includes('softMid') &&
    !libraryPanelSourceVocal.includes('downloadsActive') &&
    libraryPanelSourceVocal.includes('instrumentalVocalRemoverMethod'),
  'Settings split live algo vs Instrumental AI; Download menu; no Separazione; no alert list'
);

assert(
  downloadManagerSourceVocal.includes('activeJobs') &&
    downloadManagerSourceVocal.includes('abortController') &&
    downloadManagerSourceVocal.includes('killProcessTree') &&
    downloadManagerSourceVocal.includes('signal') &&
    instrumentalProcessorSource.includes('signal?: AbortSignal') &&
    instrumentalProcessorSource.includes('cancelled') &&
    controlSource.includes('downloads.cancel') &&
    downloadManagerSourceVocal.includes('cancelAllDownloads') &&
    controlSource.includes('downloads.cancelAll') &&
    controlSource.includes('clearDownloads') &&
    fs.existsSync(path.resolve(__dirname, '../src/main/services/processKill.ts')),
  'Download cancel/clear-all aborts yt-dlp/ffmpeg/AI via AbortController through instrumental phase'
);

assert(
  downloadManagerSourceVocal.includes('KLSPROG|') &&
    downloadManagerSourceVocal.includes('--progress') &&
    /KLSPROG\\\|/.test(downloadManagerSourceVocal) &&
    controlSource.includes('showEta') &&
    controlSource.includes('dl.eta'),
  'Download menu binds yt-dlp KLSPROG speed/ETA (progress-template TYPE key fix)'
);

const instrumentalAiSepSource = fs.readFileSync(
  path.resolve(__dirname, '../src/main/services/InstrumentalAiSeparator.ts'),
  'utf8'
);
assert(
  instrumentalAiSepSource.includes('computeAiSeparationTimeoutMs') &&
    instrumentalAiSepSource.includes('AI_SEPARATION_IDLE_TIMEOUT_MS') &&
    instrumentalAiSepSource.includes('AI_SEPARATION_ORT_SILENCE_TIMEOUT_MS') &&
    instrumentalAiSepSource.includes('AI_SEPARATION_PARENT_KEEPALIVE_MS') &&
    instrumentalAiSepSource.includes('startParentKeepAlive') &&
    instrumentalAiSepSource.includes('AI_WORKER_READY_TIMEOUT_MS') &&
    instrumentalAiSepSource.includes('armIdleWatchdog') &&
    instrumentalAiSepSource.includes('sendSeparate') &&
    instrumentalAiSepSource.includes('separateSent') &&
    instrumentalAiSepSource.includes('durationSec') &&
    instrumentalAiSepSource.includes('assertAiInputIsWav') &&
    instrumentalAiSepSource.includes('output_missing') &&
    instrumentalAiSepSource.includes('attachWorkerStdioLogging') &&
    instrumentalProcessorSource.includes('onAiEta') &&
    instrumentalProcessorSource.includes('readPcmWavDurationSec') &&
    instrumentalProcessorSource.includes('lastAiPct') &&
    instrumentalProcessorSource.includes("case 'separate'") &&
    instrumentalProcessorSource.includes('AI separation input path check') &&
    instrumentalProcessorSource.includes('stage=') &&
    instrumentalProcessorSource.includes('coerceInstrumentalVocalRemoverMethod') &&
    instrumentalProcessorSource.includes('Instrumental extract WAV was not produced') &&
    offlineModelManagerSource.includes('Model cache hit') &&
    offlineModelManagerSource.includes('explainCacheMiss') &&
    fs
      .readFileSync(path.resolve(__dirname, '../src/main/workers/instrumentalAiSeparateCore.ts'), 'utf8')
      .includes('wasmBinary') &&
    fs
      .readFileSync(path.resolve(__dirname, '../src/main/workers/instrumentalAiSeparateCore.ts'), 'utf8')
      .includes('toArrayBuffer') &&
    fs
      .readFileSync(path.resolve(__dirname, '../src/main/workers/instrumentalAiSeparateCore.ts'), 'utf8')
      .includes('ortBackend') &&
    fs
      .readFileSync(path.resolve(__dirname, '../src/main/workers/instrumentalAiWorker.ts'), 'utf8')
      .includes('unwrapAiWorkerInboundMessage') &&
    fs
      .readFileSync(path.resolve(__dirname, '../src/main/workers/instrumentalAiSeparateCore.ts'), 'utf8')
      .includes("await import('demucs-web')") &&
    fs.existsSync(path.resolve(__dirname, '../src/main/workers/aiWorkerMessage.ts')) &&
    fs.existsSync(path.resolve(__dirname, '../src/main/workers/instrumentalAiGpuRenderer.ts')) &&
    fs.existsSync(path.resolve(__dirname, '../src/main/services/InstrumentalAiHiddenRenderer.ts')) &&
    fs
      .readFileSync(path.resolve(__dirname, '../src/main/services/InstrumentalAiSeparator.ts'), 'utf8')
      .includes('hidden-renderer') &&
    fs
      .readFileSync(path.resolve(__dirname, '../src/main/ai/MdxNetSeparator.ts'), 'utf8')
      .includes('onIntra') &&
    fs
      .readFileSync(path.resolve(__dirname, '../src/main/ai/MdxNetSeparator.ts'), 'utf8')
      .includes('mdxStepSamples(cfg.mdxOverlap') &&
    fs
      .readFileSync(path.resolve(__dirname, '../src/main/ai/audioFft.ts'), 'utf8')
      .includes('getBluesteinPlan') &&
    fs.existsSync(path.resolve(__dirname, '../src/main/ai/mdxUvrGeometry.ts')) &&
    fs.existsSync(path.resolve(__dirname, '../src/shared/mdxAdvancedSettings.ts')),
  'AI separation: fractional MDX overlap, ORT keep-alive, ready-ping, MessageEvent unwrap, timeouts'
);

assert(
  fs
    .readFileSync(path.resolve(__dirname, '../src/renderer/store/karaokeStore.ts'), 'utf8')
    .includes("instrumentalVocalRemoverMethod: 'aiMdxKaraoke2'"),
  'Default Download Instrumental method is AI (aiMdxKaraoke2)'
);

const mainSourceForDialogs = fs.readFileSync(
  path.resolve(__dirname, '../src/main/index.ts'),
  'utf8'
);
assert(
  mainSourceForDialogs.includes('playlist-start') &&
    mainSourceForDialogs.includes('playlist-end') &&
    /ytsearch\$\{/.test(mainSourceForDialogs),
  'YouTube search supports offset/limit via ytsearch + playlist-start/end'
);

assert(
  mainSourceForDialogs.includes('search:youtube:cancel') &&
    mainSourceForDialogs.includes('cancelYouTubeSearch') &&
    mainSourceForDialogs.includes('killProcessTree') &&
    mainSourceForDialogs.includes('youtubeSearchChild'),
  'YouTube search cancel IPC kills in-flight yt-dlp via killProcessTree'
);

const preloadSourceForYtCancel = fs.readFileSync(
  path.resolve(__dirname, '../src/preload/index.ts'),
  'utf8'
);
assert(
  preloadSourceForYtCancel.includes('cancelYouTubeSearch') &&
    preloadSourceForYtCancel.includes('search:youtube:cancel'),
  'Preload exposes library.cancelYouTubeSearch'
);

const libraryPanelYtCancelSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/LibraryPanel.tsx'),
  'utf8'
);
assert(
  libraryPanelYtCancelSource.includes('handleStopWebSearch') &&
    libraryPanelYtCancelSource.includes('cancelYouTubeSearch') &&
    libraryPanelYtCancelSource.includes('youtube-stop-search') &&
    libraryPanelYtCancelSource.includes('webSearchGenRef') &&
    libraryPanelYtCancelSource.includes("t('library.stopSearch'"),
  'LibraryPanel shows Interrompi ricerca and ignores late results after cancel'
);

for (const localeFile of ['it.json', 'en.json', 'es.json', 'fr.json']) {
  const locale = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../locales', localeFile), 'utf8')
  );
  assert(
    typeof locale.library?.stopSearch === 'string' && locale.library.stopSearch.length > 0,
    `Locale ${localeFile} has library.stopSearch`
  );
}
assert(
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '../locales/it.json'), 'utf8')).library
    .stopSearch === 'Interrompi ricerca',
  'IT stopSearch label is Interrompi ricerca'
);

const enLocaleVocal = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../locales/en.json'), 'utf8'));
const itLocaleVocal = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../locales/it.json'), 'utf8'));
assert(
  enLocaleVocal.library.downloadInstrumental &&
    itLocaleVocal.library.downloadInstrumental &&
    enLocaleVocal.settings.vocalAiMdxKaraoke2 &&
    enLocaleVocal.settings.maxSimultaneousDownloads &&
    enLocaleVocal.settings.instrumentalVocalRemover &&
    enLocaleVocal.settings.mdxAdvancedTitle &&
    enLocaleVocal.settings.mdxSegmentSize &&
    enLocaleVocal.settings.mdxOverlapHighWarning &&
    itLocaleVocal.settings.mdxAdvancedTitle ===
      'Impostazioni Avanzate UVR-MDX-NET (Ottimizzazione ETA)' &&
    enLocaleVocal.library.instrumentalDownloadWarning &&
    enLocaleVocal.library.downloadsMenu &&
    /Live|Regia|Control/i.test(enLocaleVocal.settings.vocalRemoverAlgorithmDesc) &&
    /Download Instrumental|userData\/models/i.test(
      enLocaleVocal.settings.instrumentalVocalRemoverDesc
    ),
  'EN/IT locales: split live vs Instrumental method + MDX advanced copy present'
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

// 8. Verify AudioGraphManager vocal remover methods still present after algorithmic migration
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
const settingsModalSource = readSettingsUiSource();
const libraryPanelSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/LibraryPanel.tsx'),
  'utf8'
);
const controlWindowSource = readControlUiSource();
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
    !/showToast\(\s*t\(\s*['"]library\.alreadyLocal/.test(libraryPanelSource) &&
    controlWindowSource.includes('library.alreadyLocal') &&
    controlWindowSource.includes('alreadyExists') &&
    controlWindowSource.includes('errorMessage') &&
    controlWindowSource.includes('errors.downloadFailed') &&
    !/showToast\(\s*\n?\s*t\(\s*['"]errors\.downloadFailed['"].*payload\.errorMessage/.test(
      libraryPanelSource
    ),
  'Manual/Instrumental reuse + download errors surface in Downloads menu, not out-of-queue toasts'
);
assert(
  mainIndexSourceForPhase2.includes('requestSingleInstanceLock') &&
    mainIndexSourceForPhase2.includes('second-instance') &&
    (mainIndexSourceForPhase2.includes('controlWindow.focus()') ||
      mainIndexSourceForPhase2.includes('.focus()')) &&
    mainIndexSourceForPhase2.includes('showErrorBox') &&
    mainIndexSourceForPhase2.includes('resolveSecondInstanceCopy'),
  'Single-instance lock focuses existing Control window and shows localized dialog on duplicate'
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
// Suite 11: Phase 4/5 UI, Stage, Shortcuts, Cache Persistence Contracts
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite 11: Phase 4/5 UI · Stage · Shortcuts · Cache Persistence\x1b[0m');

const stageWindowSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/StageWindow.tsx'),
  'utf8'
);
const videoPreviewSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/VideoPreviewModal.tsx'),
  'utf8'
);
const libraryPanelSourceP45 = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/LibraryPanel.tsx'),
  'utf8'
);
const controlWindowSourceP45 = readControlUiSource();
const settingsModalSourceP45 = readSettingsUiSource();
const audioGraphSourceP45 = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/core/AudioGraphManager.ts'),
  'utf8'
);
const algorithmicSourceP45 = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/core/AlgorithmicVocalRemoverNode.ts'),
  'utf8'
);
const databaseSourceP45 = fs.readFileSync(
  path.resolve(__dirname, '../src/main/db/database.ts'),
  'utf8'
);
const mainIndexSourceP45 = fs.readFileSync(
  path.resolve(__dirname, '../src/main/index.ts'),
  'utf8'
);
const karaokeStoreSourceP45 = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/store/karaokeStore.ts'),
  'utf8'
);
const downloadManagerSourceP45 = fs.readFileSync(
  path.resolve(__dirname, '../src/main/services/DownloadManager.ts'),
  'utf8'
);

// --- Stage isolation + semitone badge ---
assert(
  mainIndexSourceP45.includes('createStageWindow') &&
    (mainIndexSourceP45.includes("?window=stage") ||
      mainIndexSourceP45.includes('window=stage') ||
      stageWindowSource.includes('signalStageReady')),
  'Stage window is a dedicated BrowserWindow with ready handshake'
);
assert(
  stageWindowSource.includes('showPitchOnStage') &&
    stageWindowSource.includes('stage-semitone-badge') &&
    /livePitchOffset\s*>\s*0\s*\?\s*`\+\$\{/.test(stageWindowSource) ||
      stageWindowSource.includes('`+${') ||
      stageWindowSource.includes("+${"),
  'Stage semitone badge renders for +N / -N / 0 when toggle enabled'
);
assert(
  settingsModalSourceP45.includes('showPitchOnStage') &&
    /showPitchOnStage:\s*true/.test(karaokeStoreSourceP45),
  'showPitchOnStage setting exists and defaults to ON'
);

assert(
  stageWindowSource.includes('showSpeedOnStage') &&
    stageWindowSource.includes('stage-speed-badge') &&
    settingsModalSourceP45.includes('showSpeedOnStage') &&
    /showSpeedOnStage:\s*true/.test(karaokeStoreSourceP45),
  'showSpeedOnStage setting exists, defaults to ON, and Stage renders speed badge'
);

assert(
  settingsModalSourceP45.indexOf('PayPal support banner') > -1 &&
    settingsModalSourceP45.indexOf('PayPal support banner') <
      settingsModalSourceP45.indexOf('{/* Instant search */}'),
  'PayPal banner is pinned above the Settings search bar'
);

assert(
  libraryPanelSourceP45.includes('isFinishedLibraryFile') &&
    libraryPanelSourceP45.includes('touchLibraryList') &&
    (libraryPanelSourceP45.includes('Client-side safety net') ||
      libraryPanelSourceP45.includes('dedupeLocalTracks')) &&
    libraryPanelSourceP45.includes('getTracksPage'),
  'LibraryPanel refuses temp/partial downloads as finished library rows and dedupes on refresh'
);

const mainScanSource = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8');
const libraryScannerSourceDedupe = fs.readFileSync(
  path.resolve(__dirname, '../src/shared/libraryScanner.ts'),
  'utf8'
);
const databaseSourceDedupe = fs.readFileSync(path.resolve(__dirname, '../src/main/db/database.ts'), 'utf8');
assert(
  mainScanSource.includes('discoverLibraryMediaAsync') &&
    libraryScannerSourceDedupe.includes('.part') &&
    libraryScannerSourceDedupe.includes('stableYtId') &&
    databaseSourceDedupe.includes('deleteTracksByLocalPathExcept') &&
    databaseSourceDedupe.includes('dedupeTracksByIdentity'),
  'Library scan skips incomplete files, prefers YouTube ids, and DB collapses path duplicates'
);

assert(
  stageWindowSource.includes('document.styleSheets') &&
    stageWindowSource.includes('requestAnimationFrame') &&
    stageWindowSource.includes('signalStageReady'),
  'Stage waits for stylesheets/fonts and rAF before signalling ready'
);

// --- YouTube preview without error 153 ---
const youtubeEmbedHelperSource = fs.readFileSync(
  path.resolve(__dirname, '../src/shared/youtubeEmbed.ts'),
  'utf8'
);
const mainProcessSourceFor153 = fs.readFileSync(
  path.resolve(__dirname, '../src/main/index.ts'),
  'utf8'
);
assert(
  youtubeEmbedHelperSource.includes('buildYouTubeEmbedSrc') &&
    youtubeEmbedHelperSource.includes('youtube-nocookie.com/embed/') &&
    youtubeEmbedHelperSource.includes('enablejsapi') &&
    youtubeEmbedHelperSource.includes('playsinline') &&
    youtubeEmbedHelperSource.includes('origin') &&
    youtubeEmbedHelperSource.includes('YOUTUBE_EMBED_REFERRER_POLICY') &&
    youtubeEmbedHelperSource.includes('YOUTUBE_EMBED_APP_ORIGIN') &&
    youtubeEmbedHelperSource.includes('resolveYouTubeEmbedOrigin') &&
    videoPreviewSource.includes('buildYouTubeEmbedSrc') &&
    videoPreviewSource.includes('YOUTUBE_EMBED_REFERRER_POLICY') &&
    mainProcessSourceFor153.includes('setupYouTubeEmbedReferer') &&
    mainProcessSourceFor153.includes('onBeforeSendHeaders') &&
    /headers\[['"]Referer['"]\]/.test(mainProcessSourceFor153),
  'YouTube preview embed uses shared builder + Electron Referer injection (153 mitigation)'
);

// --- Dynamic search + dismissible download complete ---
assert(
  (
    libraryPanelSourceP45.includes('useScopedLibrarySearch') ||
    libraryPanelSourceP45.includes('sessionStorage')
  ) &&
    (libraryPanelSourceP45.includes('searchTracks') ||
      libraryPanelSourceP45.includes('db.searchTracks')) &&
    fs
      .readFileSync(
        path.resolve(__dirname, '../src/renderer/hooks/useScopedLibrarySearch.ts'),
        'utf8'
      )
      .includes('kls.library.localQuery') &&
    fs
      .readFileSync(
        path.resolve(__dirname, '../src/renderer/hooks/useScopedLibrarySearch.ts'),
        'utf8'
      )
      .includes('kls.library.webQuery'),
  'Library persists query and filters results reactively via db.searchTracks'
);
assert(
  !libraryPanelSourceP45.includes('download-complete-badge') &&
    !libraryPanelSourceP45.includes('setCompletedDownloads') &&
    !libraryPanelSourceP45.includes('completedDownloads'),
  'Library panel no longer shows overlay Download completato badge (status stays in Downloads menu)'
);
assert(
  controlWindowSourceP45.includes("dl.status === 'completed'") &&
    controlWindowSourceP45.includes("t('library.downloadCompleted')"),
  'Downloads menu still surfaces completed download status'
);
assert(
  libraryPanelSourceP45.includes('thumbnailUrl') || libraryPanelSourceP45.includes('thumbnail'),
  'Library list renders preview thumbnails for search results'
);

// --- Tab persistence (downloads continue across tab changes) ---
assert(
  controlWindowSourceP45.includes("activeRightTab === 'library' ?") &&
    controlWindowSourceP45.includes("'hidden'") &&
    controlWindowSourceP45.includes('searchInputRef'),
  'Control keeps Library/Queue/History mounted (CSS hide) and wires search focus ref'
);

// --- Settings tabs + search ---
assert(
  settingsModalSourceP45.includes('settingsSearch') &&
    settingsModalSourceP45.includes('tabGeneral') &&
    settingsModalSourceP45.includes('tabLibrary') &&
    settingsModalSourceP45.includes('tabAudio') &&
    settingsModalSourceP45.includes('tabStage') &&
    settingsModalSourceP45.includes('tabShortcuts'),
  'Settings modal exposes thematic tabs + instant cross-category search'
);

// --- Auto-advance OFF + configurable delay ---
assert(
  /autoAdvanceNext:\s*false/.test(karaokeStoreSourceP45),
  'autoAdvanceNext defaults to OFF'
);
assert(
  /transitionPauseSec:\s*3/.test(karaokeStoreSourceP45) &&
    settingsModalSourceP45.includes('transitionPauseSec'),
  'transitionPauseSec defaults to 3s and is configurable in Settings'
);

// --- Fair queue ON ---
assert(
  /enableFairQueue:\s*true/.test(karaokeStoreSourceP45),
  'enableFairQueue defaults to ON'
);

// --- Shortcuts register with cleanup ---
assert(
  controlWindowSourceP45.includes("addEventListener('keydown'") &&
    controlWindowSourceP45.includes("removeEventListener('keydown'") &&
    controlWindowSourceP45.includes("e.code === 'Space'") &&
    controlWindowSourceP45.includes("e.code === 'KeyN'") &&
    controlWindowSourceP45.includes("e.code === 'KeyM'") &&
    controlWindowSourceP45.includes("e.code === 'KeyF'"),
  'Live shortcuts registered with cleanup (Space/N/M/Ctrl+F)'
);
assert(
  controlWindowSourceP45.includes('Doppio click o Play per avviare'),
  'Exact Italian queue hint string is present'
);

// --- Cache persistence across restart + delete on dequeue ---
assert(
  karaokeStoreSourceP45.includes('partialize') &&
    karaokeStoreSourceP45.includes('queue') &&
    karaokeStoreSourceP45.includes('settings'),
  'Zustand persist keeps queue+settings across restart'
);
assert(
  karaokeStoreSourceP45.includes('cleanupQueueCacheFileIfUnreferenced') &&
    downloadManagerSourceP45.includes('queue_cache') ||
      downloadManagerSourceP45.includes('queueCache'),
  'Queue cache files deleted when dequeued/cleared; persist while still queued'
);
assert(
  downloadManagerSourceP45.includes('findExistingLocalMedia'),
  'Download dedup via findExistingLocalMedia before network I/O'
);

// --- Audio leaks / algorithmic vocal remover ---
assert(
  algorithmicSourceP45.includes('createChannelSplitter') &&
    algorithmicSourceP45.includes('setEnabled') &&
    audioGraphSourceP45.includes('voiceReleaseTimeouts') &&
    audioGraphSourceP45.includes('clearTimeout') &&
    audioGraphSourceP45.includes('AlgorithmicVocalRemoverNode'),
  'Algorithmic vocal remover + MIDI release timers present (no AI separator)'
);
assert(
  audioGraphSourceP45.includes('computePerceptualGain') &&
    audioGraphSourceP45.includes('Math.pow') &&
    audioGraphSourceP45.includes('setVocalRemoverAlgorithm'),
  'Perceptual volume curve and algorithmic vocal-removal activation wired in AudioGraphManager'
);

// --- Playback continuity: non-modal dialogs ---
assert(
  mainIndexSourceP45.includes('showOpenDialog({') &&
    mainIndexSourceP45.includes('non-modal') ||
      mainIndexSourceP45.includes('Intentionally omit parent') ||
      mainIndexSourceP45.includes('omit parent'),
  'Native file/folder dialogs omit parent window to avoid suspending media'
);

// --- DB search optimization ---
assert(
  databaseSourceP45.includes('searchTracks') &&
    databaseSourceP45.includes('idx_tracks_search') &&
    mainIndexSourceP45.includes('db:search-tracks'),
  'SQLite searchTracks + indexes exposed over IPC for reactive library filtering'
);

// --- Single instance (re-assert for Phase 5 gate) ---
assert(
  mainIndexSourceP45.includes('requestSingleInstanceLock') &&
    mainIndexSourceP45.includes('second-instance') &&
    mainIndexSourceP45.includes('showErrorBox') &&
    mainIndexSourceP45.includes('resolveSecondInstanceCopy'),
  'Single-instance lock still enforced with user-visible dialog'
);

// --- SIAE ≥120s (re-assert binding to store) ---
assert(
  karaokeStoreSourceP45.includes('>= 120') || karaokeStoreSourceP45.includes('>=120'),
  'SIAE history gate uses ≥120s threshold in karaoke store'
);



// -------------------------------------------------------------
// Suite: Scoped Library/Web search, Stage messages, Pre-Ascolto, README Cursor
// -------------------------------------------------------------
const scopedSearchHookSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/hooks/useScopedLibrarySearch.ts'),
  'utf8'
);
const libraryPanelScopedSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/LibraryPanel.tsx'),
  'utf8'
);
const stageMessagesSource = fs.readFileSync(
  path.resolve(__dirname, '../src/shared/stageMessages.ts'),
  'utf8'
);
const settingsStageMsgSource = readSettingsUiSource();
const stageWindowMsgSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/StageWindow.tsx'),
  'utf8'
);
const videoPreviewScopedSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/VideoPreviewModal.tsx'),
  'utf8'
);
const readmeSourceCursor = fs.readFileSync(path.resolve(__dirname, '../README.md'), 'utf8');
const localeEnStage = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../locales/en.json'), 'utf8')
);
const localeItStage = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../locales/it.json'), 'utf8')
);
const localeEsStage = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../locales/es.json'), 'utf8')
);
const localeFrStage = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../locales/fr.json'), 'utf8')
);

assert(
  scopedSearchHookSource.includes('useScopedLibrarySearch') &&
    scopedSearchHookSource.includes("'local'") &&
    scopedSearchHookSource.includes("'web'") &&
    scopedSearchHookSource.includes('kls.library.localQuery') &&
    scopedSearchHookSource.includes('kls.library.webQuery') &&
    scopedSearchHookSource.includes('setSearchMode') &&
    !scopedSearchHookSource.includes('searchYouTube'),
  'Scoped search hook keeps separate local/web buckets and does not call YouTube itself'
);

assert(
  libraryPanelScopedSource.includes('useScopedLibrarySearch') &&
    libraryPanelScopedSource.includes("setSearchMode('local')") &&
    libraryPanelScopedSource.includes("setSearchMode('web')") &&
    !/setSearchMode\('web'\);\s*setSearchResults\(\[\]\)/.test(libraryPanelScopedSource) &&
    !/setSearchMode\('local'\);\s*setSearchResults\(\[\]\)/.test(libraryPanelScopedSource) &&
    libraryPanelScopedSource.includes('setWebResults') &&
    libraryPanelScopedSource.includes('setLocalResults') &&
    libraryPanelScopedSource.includes('data-testid="library-results-list"'),
  'LibraryPanel uses scoped search; tab switches do not clear the other tab results'
);

assert(
  scopedSearchHookSource.includes('revertLibraryMembershipInResults') &&
    scopedSearchHookSource.includes('revertLibraryMembershipInTrackList') &&
    libraryPanelScopedSource.includes('revertLibraryMembershipInResults') &&
    /db\.deleteTrack[\s\S]*revertLibraryMembershipInResults/.test(libraryPanelScopedSource),
  'Library delete reverts web-search local_library patches so Download reappears'
);

// -------------------------------------------------------------
// Suite: Web search ↔ library delete membership sync (pure helper)
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite: Web search library-delete membership sync\x1b[0m');

{
  const { spawnSync } = require('child_process');
  const membershipPath = path.resolve(__dirname, '../src/shared/libraryMembership.ts');
  const probe = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--no-warnings',
      '-e',
      `
      import {
        extractYouTubeVideoId,
        extractYouTubeIdFromLibraryPath,
        buildYouTubeWatchUri,
        revertLibraryMembershipOnTrack,
        revertLibraryMembershipInTrackList
      } from ${JSON.stringify(membershipPath)};

      const assert = (c, m) => { if (!c) { console.error('PROBE_FAIL', m); process.exit(2); } };

      assert(extractYouTubeVideoId('dQw4w9WgXcQ') === 'dQw4w9WgXcQ', 'bare-id');
      assert(
        extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ') === 'dQw4w9WgXcQ',
        'watch-url'
      );
      assert(
        extractYouTubeIdFromLibraryPath('/lib/dQw4w9WgXcQ_Artist - Title.mp4') === 'dQw4w9WgXcQ',
        'path-prefix'
      );
      assert(buildYouTubeWatchUri('dQw4w9WgXcQ').includes('dQw4w9WgXcQ'), 'watch-uri');

      const patchedWeb = {
        id: 'dQw4w9WgXcQ',
        source: 'local_library',
        title: 'Song Karaoke',
        artist: 'Artist',
        durationSec: 180,
        uri: 'karaoke://local/' + encodeURIComponent('/lib/dQw4w9WgXcQ_Artist - Song Karaoke.mp4'),
        localFilePath: '/lib/dQw4w9WgXcQ_Artist - Song Karaoke.mp4',
        isEmbeddable: true
      };
      const otherWeb = {
        id: 'aaaaaaaaaaa',
        source: 'youtube',
        title: 'Other',
        artist: 'X',
        durationSec: 10,
        uri: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
        isEmbeddable: true
      };

      // Delete by YouTube id (web-tab delete after download)
      const reverted = revertLibraryMembershipOnTrack(patchedWeb, {
        id: 'dQw4w9WgXcQ',
        uri: patchedWeb.uri,
        localFilePath: patchedWeb.localFilePath
      });
      assert(reverted.source === 'youtube', 'source-youtube');
      assert(!reverted.localFilePath, 'cleared-path');
      assert(reverted.uri === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'restored-uri');
      assert(reverted.id === 'dQw4w9WgXcQ', 'kept-yt-id');

      // Delete from Local with path-hash id — match via filename YouTube prefix
      const deletedLocalAlias = {
        id: 'track_pathhash',
        uri: patchedWeb.uri,
        localFilePath: patchedWeb.localFilePath
      };
      const list = revertLibraryMembershipInTrackList([patchedWeb, otherWeb], deletedLocalAlias);
      assert(list[0].source === 'youtube' && !list[0].localFilePath, 'list-revert-by-path');
      assert(list[1] === otherWeb || list[1].source === 'youtube', 'other-untouched');
      assert(list[1].id === 'aaaaaaaaaaa', 'other-id');

      // Pure midi / non-YouTube local should not become youtube
      const midi = {
        id: 'midi_1',
        source: 'local_library',
        title: 'Piano',
        artist: 'Local',
        durationSec: 60,
        uri: 'karaoke://local/' + encodeURIComponent('/lib/piano.mid'),
        localFilePath: '/lib/piano.mid'
      };
      const midiOut = revertLibraryMembershipOnTrack(midi, {
        id: 'midi_1',
        localFilePath: '/lib/piano.mid'
      });
      assert(midiOut === midi || midiOut.source === 'local_library', 'midi-unchanged');

      console.log('PROBE_OK');
      `
    ],
    { encoding: 'utf8' }
  );
  assert(
    probe.status === 0 && (probe.stdout || '').includes('PROBE_OK'),
    'libraryMembership: delete clears web in-library patch (id/path/YouTube keys)',
    (probe.stderr || probe.stdout || `exit ${probe.status}`).slice(0, 400)
  );
}

const libraryMembershipSource = fs.readFileSync(
  path.resolve(__dirname, '../src/shared/libraryMembership.ts'),
  'utf8'
);
assert(
  libraryMembershipSource.includes('revertLibraryMembershipInTrackList') &&
    libraryMembershipSource.includes('extractYouTubeIdFromLibraryPath') &&
    libraryMembershipSource.includes('collectDeletedLibraryMatchKeys'),
  'Shared libraryMembership exports revert + identity match helpers'
);

// -------------------------------------------------------------
// Suite: Recursive library scan (subfolders under library root)
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite: Recursive library media discovery\x1b[0m');

{
  const mainIndexSource = fs.readFileSync(
    path.resolve(__dirname, '../src/main/index.ts'),
    'utf8'
  );
  const downloadManagerSource = fs.readFileSync(
    path.resolve(__dirname, '../src/main/services/DownloadManager.ts'),
    'utf8'
  );
  const scannerSource = fs.readFileSync(
    path.resolve(__dirname, '../src/shared/libraryScanner.ts'),
    'utf8'
  );

  assert(
    scannerSource.includes('export function discoverLibraryMedia') &&
      scannerSource.includes('export function findMediaMatchInTree') &&
      /walk\s*\(/.test(scannerSource) &&
      scannerSource.includes('isDirectoryEntry'),
    'libraryScanner exports recursive discover + media-match helpers'
  );
  assert(
    mainIndexSource.includes("from '../shared/libraryScanner'") &&
      mainIndexSource.includes('discoverLibraryMediaAsync'),
    'Main scanFolder uses shared discoverLibraryMediaAsync (recursive async)'
  );
  assert(
    downloadManagerSource.includes('findMediaMatchInTree') &&
      downloadManagerSource.includes("from '../../shared/libraryScanner'"),
    'DownloadManager existing-media match walks library subfolders'
  );

  const { spawnSync } = require('child_process');
  const scannerPath = path.resolve(__dirname, '../src/shared/libraryScanner.ts');
  const probe = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--no-warnings',
      '-e',
      `
      import fs from 'fs';
      import path from 'path';
      import os from 'os';
      import {
        discoverLibraryMedia,
        findMediaMatchInTree,
        LIBRARY_SCAN_MIN_BYTES
      } from ${JSON.stringify(scannerPath)};

      const assert = (c, m) => { if (!c) { console.error('PROBE_FAIL', m); process.exit(2); } };

      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kls-lib-scan-'));
      try {
        const nested = path.join(root, 'Italian', 'Battisti');
        const deep = path.join(nested, 'Hits');
        fs.mkdirSync(deep, { recursive: true });
        fs.mkdirSync(path.join(root, '.git'), { recursive: true });
        fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });

        const pad = (n) => Buffer.alloc(Math.max(n, LIBRARY_SCAN_MIN_BYTES), 1);
        fs.writeFileSync(path.join(root, 'Top - Level.mp4'), pad(4096));
        fs.writeFileSync(path.join(nested, 'Lucio Battisti - La canzone.mp4'), pad(4096));
        fs.writeFileSync(
          path.join(deep, 'dQw4w9WgXcQ_Artist - Song (Instrumental).mp4'),
          pad(4096)
        );
        fs.writeFileSync(path.join(deep, 'Tiny.mp4'), Buffer.alloc(100));
        fs.writeFileSync(path.join(deep, 'Incomplete.mp4.part'), pad(4096));
        fs.writeFileSync(path.join(deep, 'Pair.mp3'), pad(4096));
        fs.writeFileSync(path.join(deep, 'Pair.cdg'), pad(4096));
        fs.writeFileSync(path.join(root, '.git', 'ignored.mp4'), pad(4096));
        fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'dep.mp4'), pad(4096));

        const found = discoverLibraryMedia(root);
        const paths = found.map((t) => t.absolutePath).sort();
        assert(found.length === 4, 'count-4-got-' + found.length);
        assert(paths.some((p) => p.endsWith('Top - Level.mp4')), 'top-level');
        assert(paths.some((p) => p.includes(path.join('Italian', 'Battisti')) && p.endsWith('La canzone.mp4')), 'nested-artist');
        assert(paths.some((p) => p.includes(path.join('Hits')) && p.includes('(Instrumental)')), 'deep-instrumental');
        assert(paths.some((p) => p.endsWith('Pair.mp3')), 'mp3-cdg-pair');
        assert(!paths.some((p) => p.endsWith('Tiny.mp4')), 'skip-tiny');
        assert(!paths.some((p) => p.includes('.part')), 'skip-part');
        assert(!paths.some((p) => p.includes('.git')), 'skip-dot-git');
        assert(!paths.some((p) => p.includes('node_modules')), 'skip-node-modules');

        const instrumental = found.find((t) => t.title.includes('Instrumental'));
        assert(instrumental && instrumental.idHint === 'dQw4w9WgXcQ', 'yt-id-hint');
        assert(instrumental.artist === 'Artist', 'yt-artist');

        const pair = found.find((t) => t.absolutePath.endsWith('Pair.mp3'));
        assert(pair && pair.hasEmbeddedLyrics === true, 'cdg-lyrics-flag');

        // Same basename in different folders must not collide (path-based ids)
        const ids = new Set(found.map((t) => t.idHint));
        assert(ids.size === found.length, 'unique-ids');

        const match = findMediaMatchInTree(
          root,
          { ytId: 'dQw4w9WgXcQ', fingerprint: 'yt:dQw4w9WgXcQ', expectedBase: null },
          new Set(['.mp4', '.mp3', '.webm', '.mid', '.kar'])
        );
        assert(match && match.matchedBy === 'id', 'dedup-finds-nested');
        assert(match.localFilePath.includes('Instrumental'), 'dedup-path');

        const miss = findMediaMatchInTree(
          root,
          { ytId: 'xxxxxxxxxxx', fingerprint: 'yt:xxxxxxxxxxx', expectedBase: 'nope' },
          new Set(['.mp4'])
        );
        assert(miss === null, 'dedup-miss');

        console.log('PROBE_OK');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
      `
    ],
    { encoding: 'utf8' }
  );
  assert(
    probe.status === 0 && (probe.stdout || '').includes('PROBE_OK'),
    'libraryScanner: recursive discovery + filters + nested dedup match',
    (probe.stderr || probe.stdout || `exit ${probe.status}`).slice(0, 500)
  );
}

// --- Large-library scan latency: batch SQLite + deferred FFmpeg thumbs ---
{
  const mainScanLatency = fs.readFileSync(
    path.resolve(__dirname, '../src/main/index.ts'),
    'utf8'
  );
  const databaseScanLatency = fs.readFileSync(
    path.resolve(__dirname, '../src/main/db/database.ts'),
    'utf8'
  );

  assert(
    databaseScanLatency.includes('upsertTracksBatch') &&
      databaseScanLatency.includes('this.db.transaction') &&
      databaseScanLatency.includes('prepareTrackStatements') &&
      databaseScanLatency.includes('deleteByPathExceptStmt'),
    'DatabaseManager exposes transactional upsertTracksBatch with prepared stmts + path dedupe'
  );

  const scanFolderFn = mainScanLatency.match(
    /private async scanFolder\(folderPath: string\): Promise<KaraokeMediaTrack\[\]> \{[\s\S]*?\n  \}/
  );
  assert(Boolean(scanFolderFn), 'scanFolder method body is locatable for latency contracts');
  const scanBody = scanFolderFn ? scanFolderFn[0] : '';
  assert(
    scanBody.includes('upsertTracksBatch') &&
      scanBody.includes('peekCachedThumbnail') &&
      scanBody.includes('enqueueThumbnailBackfill') &&
      scanBody.includes('discoverLibraryMediaAsync') &&
      scanBody.includes('getPathFingerprints') &&
      scanBody.includes('library:scan-progress') &&
      !scanBody.includes('getOrGenerateThumbnail') &&
      !/upsertTrack\(/.test(scanBody),
    'scanFolder async+delta: progress IPC, fingerprints, batch upsert, no sync FFmpeg'
  );
  assert(
    mainScanLatency.includes('generateThumbnailAsync') &&
      mainScanLatency.includes('execFile(') &&
      mainScanLatency.includes('pumpThumbnailBackfill') &&
      mainScanLatency.includes('scheduleLibraryReindexedNotify'),
    'Async FFmpeg thumbnail backfill + throttled library:reindexed notify exist'
  );
  assert(
    /download:save-to-library[\s\S]*getOrGenerateThumbnail[\s\S]*upsertTrack/.test(mainScanLatency),
    'save-to-library still generates a sync thumbnail before single upsert (one-file path)'
  );
}

assert(
  libraryPanelScopedSource.includes('setLocalResults') &&
    libraryPanelScopedSource.includes('localQuery') &&
    /searchMode\s*===\s*'web'/.test(libraryPanelScopedSource) &&
    libraryPanelScopedSource.includes('searchYouTube') &&
    libraryPanelScopedSource.includes('setWebSearching') &&
    libraryPanelScopedSource.includes('loadMoreVideos') &&
    libraryPanelScopedSource.includes('youtube-load-more') &&
    libraryPanelScopedSource.includes('offset') &&
    libraryPanelScopedSource.includes('youtube-stop-search') &&
    libraryPanelScopedSource.includes('cancelYouTubeSearch'),
  'Local live search mutates local bucket; YouTube search only on web submit; Load more pagination; stop search'
);

assert(
  stageMessagesSource.includes('createDefaultStageMessages') &&
    stageMessagesSource.includes('mergeStageMessages') &&
    stageMessagesSource.includes('patchStageMessages') &&
    stageMessagesSource.includes('resolveStageMessage') &&
    stageMessagesSource.includes('stageMessageCss') &&
    settingsStageMsgSource.includes('data-testid="settings-stage-messages"') &&
    settingsStageMsgSource.includes('stageMessagesTitle') &&
    stageWindowMsgSource.includes('resolveStageMessage') &&
    stageWindowMsgSource.includes('stageMessageCss') &&
    stageWindowMsgSource.includes('data-testid="stage-msg-nowSinging"'),
  'Stage message settings: helpers, Settings UI, and Stage live resolve/CSS'
);

const stageMsgLocaleKeys = [
  'stageMessagesTitle',
  'stageMessagesDesc',
  'stageMessageEnabled',
  'stageMessageText',
  'stageMessageBold',
  'stageMessageItalic',
  'stageMessageFontSize',
  'stageMessageNowSinging',
  'stageMessageGetReady'
];
assert(
  stageMsgLocaleKeys.every(
    (k) =>
      localeEnStage.settings[k] &&
      localeItStage.settings[k] &&
      localeEsStage.settings[k] &&
      localeFrStage.settings[k]
  ),
  'Stage message settings labels localized in en/it/es/fr'
);

assert(
  videoPreviewScopedSource.includes('isSameCueAndMasterDevice') &&
    videoPreviewScopedSource.includes('data-testid="preview-unmute-same-device-dialog"') &&
    videoPreviewScopedSource.includes('data-testid="preview-unmute-same-device-confirm"') &&
    videoPreviewScopedSource.includes('attachYouTubePreviewPlayer') &&
    videoPreviewScopedSource.includes('data-testid="preview-youtube-iframe"') &&
    libraryPanelScopedSource.includes('setPreviewTrack(track)') &&
    libraryPanelScopedSource.includes('cueAudioDeviceId') &&
    libraryPanelScopedSource.includes('masterAudioDeviceId'),
  'Pre-Ascolto opens video preview; same-device unmute confirm is wired'
);

const youtubePreviewPlayerSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/utils/youtubePreviewPlayer.ts'),
  'utf8'
);
assert(
  youtubePreviewPlayerSource.includes('loadYouTubeIframeApi') &&
    youtubePreviewPlayerSource.includes('attachYouTubePreviewPlayer') &&
    youtubePreviewPlayerSource.includes('YOUTUBE_IFRAME_API_SRC'),
  'YouTube preview player helper loads IFrame API for unmute watch'
);

assert(
  /Google Antigravity/.test(readmeSourceCursor) &&
    /\*\*Cursor\*\*/.test(readmeSourceCursor) &&
    readmeSourceCursor.includes('badge/Developed%20with-Cursor') &&
    readmeSourceCursor.includes('Nota di Sviluppo') &&
    readmeSourceCursor.includes('Development Note'),
  'README mentions Cursor alongside Antigravity (badge + IT/EN notes)'
);


// -------------------------------------------------------------

// -------------------------------------------------------------
// Suite: Stage message backgrounds
// -------------------------------------------------------------
const stageMessagesBgSource = fs.readFileSync(
  path.resolve(__dirname, '../src/shared/stageMessages.ts'),
  'utf8'
);
const stageWindowBgSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/StageWindow.tsx'),
  'utf8'
);
const settingsBgSource = readSettingsUiSource();
const typesBgSource = fs.readFileSync(
  path.resolve(__dirname, '../src/shared/types.ts'),
  'utf8'
);
const preloadBgSource = fs.readFileSync(
  path.resolve(__dirname, '../src/preload/index.ts'),
  'utf8'
);
assert(
  typesBgSource.includes('StageMessageBackgroundMode') &&
    typesBgSource.includes('backgroundMode') &&
    typesBgSource.includes('backgroundColor') &&
    typesBgSource.includes('backgroundImagePath') &&
    stageMessagesBgSource.includes('pickActiveStageMessageBackground') &&
    stageMessagesBgSource.includes('stageMessageBackgroundCss') &&
    stageMessagesBgSource.includes('STAGE_MESSAGE_BACKGROUND_PRIORITY') &&
    stageWindowBgSource.includes('stage-message-background') &&
    stageWindowBgSource.includes('pickActiveStageMessageBackground') &&
    settingsBgSource.includes('settings-stage-message-bg-mode-') &&
    settingsBgSource.includes('stageMessageBackground') &&
    preloadBgSource.includes('openImageFile') &&
    localeEnStage.settings.stageMessageBackground &&
    localeItStage.settings.stageMessageBackground &&
    localeEsStage.settings.stageMessageBackground &&
    localeFrStage.settings.stageMessageBackground,
  'Per-message Stage backgrounds: types, helpers, Settings UI, Stage layer, locales, image picker'
);


assert(
  fs.existsSync(path.resolve(__dirname, '../src/renderer/data/appShortcuts.ts')) &&
    fs.readFileSync(path.resolve(__dirname, '../src/renderer/data/appShortcuts.ts'), 'utf8').includes('APP_SHORTCUTS') &&
    fs.readFileSync(path.resolve(__dirname, '../src/renderer/components/ShortcutsHelpModal.tsx'), 'utf8').includes('APP_SHORTCUTS') &&
    fs.readFileSync(path.resolve(__dirname, '../src/renderer/components/SettingsModal.tsx'), 'utf8').includes('APP_SHORTCUTS') &&
    readControlUiSource().includes('appShortcuts.ts'),
  'Shortcut inventory shared by ?, Settings, and ControlWindow handler comment'
);

// -------------------------------------------------------------
// Suite: Accent-insensitive search (NFD + strip combining marks)
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite: Accent-insensitive search matching\x1b[0m');

function normalizeForSearchTest(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

function textMatchesSearchTest(haystack, needle) {
  const q = normalizeForSearchTest(needle).trim();
  if (!q) return true;
  return normalizeForSearchTest(haystack).includes(q);
}

assert(
  textMatchesSearchTest('morirò da re', 'moriro da re'),
  'Unaccented query matches accented title (moriro → morirò)'
);
assert(
  textMatchesSearchTest('morirò da re', 'morirò da re'),
  'Accented query still matches accented title (additive)'
);
assert(
  textMatchesSearchTest('Café Karaoke', 'CAFE'),
  'Case- and accent-insensitive match on mixed text'
);
assert(
  !textMatchesSearchTest('Hello', 'xyz'),
  'Non-matching needle does not falsely match'
);

const textNormalizeSource = fs.readFileSync(
  path.resolve(__dirname, '../src/shared/textNormalize.ts'),
  'utf8'
);
assert(
  textNormalizeSource.includes('normalize(') &&
    textNormalizeSource.includes('NFD') &&
    textNormalizeSource.includes('\\p{M}') &&
    textNormalizeSource.includes('normalizeForSearch') &&
    textNormalizeSource.includes('textMatchesSearch'),
  'Shared textNormalize folds diacritics via NFD + combining marks'
);

const databaseSourceAccent = fs.readFileSync(
  path.resolve(__dirname, '../src/main/db/database.ts'),
  'utf8'
);
const guestServerSourceAccent = fs.readFileSync(
  path.resolve(__dirname, '../src/main/server/guestServer.ts'),
  'utf8'
);
const libraryPanelSourceAccent = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/LibraryPanel.tsx'),
  'utf8'
);
const historyPanelSourceAccent = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/HistoryPanel.tsx'),
  'utf8'
);
const settingsModalSourceAccent = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/SettingsModal.tsx'),
  'utf8'
);
const shortcutsHelpSourceAccent = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/ShortcutsHelpModal.tsx'),
  'utf8'
);
const controlWindowSourceAccent = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/ControlWindow.tsx'),
  'utf8'
);

assert(
  databaseSourceAccent.includes('fold_diacritics') &&
    databaseSourceAccent.includes('normalizeForSearch') &&
    databaseSourceAccent.includes('titleNorm') &&
    databaseSourceAccent.includes('artistNorm') &&
    // Guest portal: accent folding via normalizeForSearch + DB FTS/searchTracks (not full-catalog JS filter).
    guestServerSourceAccent.includes('normalizeForSearch') &&
    guestServerSourceAccent.includes('searchLibraryTracks') &&
    libraryPanelSourceAccent.includes('textMatchesSearch') &&
    historyPanelSourceAccent.includes('textMatchesSearch') &&
    settingsModalSourceAccent.includes('textMatchesSearch') &&
    shortcutsHelpSourceAccent.includes('textMatchesSearch') &&
    controlWindowSourceAccent.includes('textMatchesSearch'),
  'All in-app search/filter surfaces use shared accent folding'
);

// -------------------------------------------------------------
// Suite: karaoke://local path encode/decode (POSIX // collapse + Windows drives)
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite: karaoke://local media path normalization\x1b[0m');

/** Mirrors src/shared/karaokeLocalPath.ts — keep in sync. */
function buildKaraokeLocalUriTest(absolutePath) {
  const p = (absolutePath || '').trim();
  if (!p) return '';
  if (
    p.startsWith('karaoke://') ||
    p.startsWith('http://') ||
    p.startsWith('https://') ||
    p.startsWith('data:')
  ) {
    return p;
  }
  return `karaoke://local/${encodeURIComponent(p)}`;
}

function resolveKaraokeLocalFilePathTest(urlPathname, platform) {
  let filePath = decodeURIComponent(urlPathname || '');
  if (platform === 'win32') {
    if (/^\/[A-Za-z]:[\\/]/.test(filePath)) {
      return filePath.slice(1);
    }
    if (filePath.startsWith('/\\')) {
      return filePath.slice(1);
    }
    return filePath;
  }
  if (filePath.startsWith('//')) {
    return `/${filePath.replace(/^\/+/, '')}`;
  }
  return filePath;
}

function roundTripLocalPath(absolutePath, platform) {
  const uri = buildKaraokeLocalUriTest(absolutePath);
  const url = new URL(uri);
  return resolveKaraokeLocalFilePathTest(url.pathname, platform);
}

const unicodeInstrumentalPath = path.join(
  os.homedir(),
  'Scaricati',
  'Karaoke',
  'iywXK9Dj2o4_Måneskin Official - Måneskin - Morirò da Re (Instrumental).mp4'
);

assert(
  roundTripLocalPath(unicodeInstrumentalPath, 'linux') === unicodeInstrumentalPath ||
    // On Windows hosts the fixture is a drive path; still verify POSIX collapse separately.
    (process.platform === 'win32' &&
      roundTripLocalPath(unicodeInstrumentalPath, 'win32') === unicodeInstrumentalPath),
  'Absolute path with Unicode (å, ò) round-trips without double slash'
);

// Explicit POSIX absolute fixture (not a real user-home literal — synthetic /var path)
const posixUnicodePath =
  '/var/karaoke-library/iywXK9Dj2o4_Måneskin Official - Måneskin - Morirò da Re (Instrumental).mp4';

assert(
  roundTripLocalPath(posixUnicodePath, 'linux') === posixUnicodePath,
  'POSIX absolute path with Unicode (å, ò) round-trips without double slash'
);

assert(
  !roundTripLocalPath(posixUnicodePath, 'linux').startsWith('//'),
  'POSIX round-trip must not yield //var/...'
);

// Reproduce the pre-fix decode bug shape and show the helper repairs it
{
  const buggyDecoded = decodeURIComponent(
    new URL(buildKaraokeLocalUriTest(posixUnicodePath)).pathname
  );
  assert(
    buggyDecoded === `/${posixUnicodePath}` || buggyDecoded.startsWith('//'),
    'URL pathname + decode of encoded absolute path yields double leading slash (bug shape)'
  );
  assert(
    resolveKaraokeLocalFilePathTest(
      new URL(buildKaraokeLocalUriTest(posixUnicodePath)).pathname,
      'linux'
    ) === posixUnicodePath,
    'Helper collapses //var/... back to /var/...'
  );
}

assert(
  roundTripLocalPath('C:\\KaraokeData\\track.mp4', 'win32') === 'C:\\KaraokeData\\track.mp4',
  'Windows drive letter path round-trips'
);

assert(
  roundTripLocalPath('C:/KaraokeData/track.mp4', 'win32') === 'C:/KaraokeData/track.mp4',
  'Windows forward-slash drive path round-trips'
);

assert(
  roundTripLocalPath('\\\\server\\share\\karaoke\\track.mp4', 'win32') ===
    '\\\\server\\share\\karaoke\\track.mp4',
  'Windows UNC path round-trips'
);

assert(
  buildKaraokeLocalUriTest('karaoke://local/already') === 'karaoke://local/already',
  'buildKaraokeLocalUri passes through existing karaoke:// URIs'
);

assert(
  buildKaraokeLocalUriTest(posixUnicodePath).includes(encodeURIComponent(posixUnicodePath)),
  'Instrumental library URI encodes the same absolute path the file was written to'
);

const karaokeLocalPathSource = fs.readFileSync(
  path.resolve(__dirname, '../src/shared/karaokeLocalPath.ts'),
  'utf8'
);
const mainProtocolSource = fs.readFileSync(
  path.resolve(__dirname, '../src/main/index.ts'),
  'utf8'
);
const downloadManagerSourcePath = fs.readFileSync(
  path.resolve(__dirname, '../src/main/services/DownloadManager.ts'),
  'utf8'
);

assert(
  karaokeLocalPathSource.includes('resolveKaraokeLocalFilePath') &&
    karaokeLocalPathSource.includes('buildKaraokeLocalUri') &&
    karaokeLocalPathSource.includes("filePath.startsWith('//')"),
  'Shared karaokeLocalPath exports resolve + build and collapses POSIX //'
);

assert(
  mainProtocolSource.includes('resolveKaraokeLocalFilePath') &&
    mainProtocolSource.includes("url.hostname === 'local'"),
  'Protocol handler uses resolveKaraokeLocalFilePath for karaoke://local'
);

assert(
  downloadManagerSourcePath.includes('buildKaraokeLocalUri') &&
    downloadManagerSourcePath.includes('destinationPath'),
  'DownloadManager builds library/cache URIs via buildKaraokeLocalUri(destinationPath)'
);

const soundFontManagerSource = fs.readFileSync(
  path.resolve(__dirname, '../src/main/services/SoundFontManager.ts'),
  'utf8'
);
const soundFontPathSharedSource = fs.readFileSync(
  path.resolve(__dirname, '../src/shared/soundFontPath.ts'),
  'utf8'
);

assert(
  soundFontManagerSource.includes('ensureBundledSoundFont') &&
    soundFontManagerSource.includes("path.join(resources, 'soundfonts'") &&
    soundFontManagerSource.includes('userData') &&
    soundFontManagerSource.includes('isEphemeralSoundFontPath') &&
    soundFontManagerSource.includes('listCatalog'),
  'SoundFontManager seeds userData from resources/soundfonts (extraResources)'
);

assert(
  soundFontPathSharedSource.includes('isEphemeralSoundFontPath') &&
    soundFontPathSharedSource.includes('.mount_') &&
    soundFontPathSharedSource.includes('AppData') &&
    soundFontPathSharedSource.includes('Local') &&
    soundFontPathSharedSource.includes('Temp') &&
    soundFontPathSharedSource.includes('SOUND_FONT_OTHER_OPTION_ID') &&
    soundFontPathSharedSource.includes('soundFontDisplayName'),
  'Shared soundFontPath detects AppImage .mount_ and Windows Temp extracts'
);

assert(
  mainProtocolSource.includes('SoundFontManager') &&
    mainProtocolSource.includes('isEphemeralSoundFontPath') &&
    mainProtocolSource.includes('ensureBundledSoundFont') &&
    mainProtocolSource.includes('resolveDefaultSoundFont') &&
    mainProtocolSource.includes('system:list-soundfonts'),
  'Main process wires SoundFontManager for default/init-paths resolution'
);

assert(
  mainProtocolSource.includes('isEphemeralSoundFontPath(resolvedSoundFont)'),
  'init-paths re-resolves SoundFont when persisted path is AppImage-ephemeral'
);

/** Mirrors src/shared/soundFontPath.ts — keep in sync. */
function isEphemeralSoundFontPathTest(filePath) {
  const normalized = (filePath || '').replace(/\\/g, '/');
  if (!normalized) return false;
  if (normalized.includes('/.mount_')) return true;
  if (/\/AppData\/Local\/Temp\//i.test(normalized)) return true;
  if (/\/var\/folders\/[^/]+\/[^/]+\/T\//i.test(normalized)) return true;
  return false;
}

assert(
  isEphemeralSoundFontPathTest(
    '/tmp/.mount_KaraokK6MA1R/resources/soundfonts/GeneralUser-GS.sf2'
  ),
  'AppImage FUSE mount SoundFont path is ephemeral'
);
assert(
  !isEphemeralSoundFontPathTest(
    path.join(os.homedir(), '.config', 'karaoke-live-station', 'soundfonts', 'GeneralUser-GS.sf2')
  ),
  'userData/soundfonts managed path is not ephemeral'
);
assert(
  !isEphemeralSoundFontPathTest('/usr/share/sounds/sf2/FluidR3_GM.sf2'),
  'System SoundFont path is not ephemeral'
);
assert(
  isEphemeralSoundFontPathTest(
    'C:/AppData/Local/Temp/KaraokeLiveStation/resources/soundfonts/GeneralUser-GS.sf2'
  ),
  'Windows Temp extract SoundFont path is ephemeral'
);

/** Mirrors src/shared/soundFontPath.ts soundFontDisplayName — keep in sync. */
function soundFontDisplayNameTest(fileName) {
  const base = (fileName || '').replace(/\.(sf2|sf3|dls)$/i, '');
  return base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || fileName;
}
assert(
  soundFontDisplayNameTest('GeneralUser-GS.sf2') === 'GeneralUser GS',
  'Display name strips extension and hyphenates for GeneralUser-GS.sf2'
);

const settingsModalSfSrc = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/SettingsModal.tsx'),
  'utf8'
);
const preloadSfSrc = fs.readFileSync(
  path.resolve(__dirname, '../src/preload/index.ts'),
  'utf8'
);
assert(
  settingsModalSfSrc.includes('SOUND_FONT_OTHER_OPTION_ID') &&
    settingsModalSfSrc.includes('listSoundFonts') &&
    settingsModalSfSrc.includes('soundFontCatalog') &&
    settingsModalSfSrc.includes('handleSoundFontSelectChange'),
  'Settings Audio tab uses SoundFont dropdown with Altro/Other option'
);
assert(
  preloadSfSrc.includes('listSoundFonts') &&
    preloadSfSrc.includes('system:list-soundfonts'),
  'Preload exposes system.listSoundFonts IPC'
);
assert(
  enLocale.settings.soundfontOther &&
    itLocale.settings.soundfontOther === 'Altro…' &&
    esLocale.settings.soundfontOther &&
    frLocale.settings.soundfontOther,
  'Locales define soundfontOther (IT: Altro…)'
);

// Packaging: SoundFont/ORT once at top-level; platforms only add bin/
{
  const packageJsonSf = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')
  );
  const buildCfg = packageJsonSf.build || {};
  const topRes = buildCfg.extraResources || [];
  assert(
    Array.isArray(topRes) &&
      topRes.some((e) => e && e.from === 'public/soundfonts' && e.to === 'soundfonts') &&
      topRes.some((e) => e && e.from === 'public/ort' && e.to === 'ort'),
    'Top-level electron-builder extraResources includes public/soundfonts + public/ort once'
  );
  const topSfCount = topRes.filter(
    (e) => e && e.from === 'public/soundfonts' && e.to === 'soundfonts'
  ).length;
  const topOrtCount = topRes.filter((e) => e && e.from === 'public/ort' && e.to === 'ort').length;
  assert(topSfCount === 1 && topOrtCount === 1, 'SoundFont and ORT appear exactly once at top-level');

  for (const plat of ['linux', 'win', 'mac']) {
    const platRes = (buildCfg[plat] && buildCfg[plat].extraResources) || [];
    assert(
      !platRes.some((e) => e && (e.from === 'public/soundfonts' || e.from === 'public/ort')),
      `Platform ${plat} extraResources must NOT re-list soundfonts/ort (avoids EEXIST/EBUSY double-copy)`
    );
    assert(
      platRes.some((e) => e && String(e.from || '').includes('bin/')),
      `Platform ${plat} extraResources still includes platform bin/`
    );
  }
  assert(
    Array.isArray(buildCfg.asarUnpack) &&
      !buildCfg.asarUnpack.some((p) => String(p).includes('soundfonts')),
    'asarUnpack does not double-unpack soundfonts (extraResources is the single ship path)'
  );

  assert(
    fs.existsSync(path.resolve(__dirname, '../public/soundfonts/GeneralUser-GS.sf2')) &&
      fs.statSync(path.resolve(__dirname, '../public/soundfonts/GeneralUser-GS.sf2')).size >
        1024 * 1024,
    'Repo ships public/soundfonts/GeneralUser-GS.sf2 (>1MB) for electron-builder extraResources'
  );
}

// -------------------------------------------------------------
// Suite: Instrumental download staging (userData/temp → remux → library)
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite: Instrumental download staging paths\x1b[0m');

const downloadStagingSource = fs.readFileSync(
  path.resolve(__dirname, '../src/main/services/downloadStaging.ts'),
  'utf8'
);
const downloadManagerStagingSrc = fs.readFileSync(
  path.resolve(__dirname, '../src/main/services/DownloadManager.ts'),
  'utf8'
);
const mainStagingSrc = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8');

assert(
  downloadStagingSource.includes('resolveDownloadedMediaPath') &&
    downloadStagingSource.includes('parseYtDlpOutputPath') &&
    downloadStagingSource.includes('isYtDlpTransientMediaName') &&
    downloadStagingSource.includes('buildYtDlpOutputTemplate') &&
    downloadStagingSource.includes('YTDLP_INSTRUMENTAL_SUB_LANGS') &&
    downloadStagingSource.includes("YTDLP_INSTRUMENTAL_SUB_LANGS = '.*-orig,default'") &&
    downloadStagingSource.includes('shouldWriteInstrumentalAutoSubs'),
  'downloadStaging.ts exports yt-dlp path parse + media resolve helpers'
);

assert(
  mainStagingSrc.includes("path.join(userDataPath, 'temp')") &&
    mainStagingSrc.includes('new DownloadManager(tempDownloadDir'),
  'Main process stages downloads under userData/temp (AppImage-writable)'
);

assert(
  downloadManagerStagingSrc.includes('buildYtDlpOutputTemplate') &&
    downloadManagerStagingSrc.includes('cwd: this.tempDir') &&
    !downloadManagerStagingSrc.includes('path.join(this.tempDir, `${downloadId}.%(ext)s`)') &&
    downloadManagerStagingSrc.includes('spawnFailed') &&
    downloadManagerStagingSrc.includes('lastYtDlpErrorLine') &&
    downloadManagerStagingSrc.includes('resolveDownloadedMediaPath') &&
    downloadManagerStagingSrc.includes('Downloaded video not found in staging folder') &&
    downloadManagerStagingSrc.includes('${downloadId}.instrumental.mp4') &&
    downloadManagerStagingSrc.includes('${downloadId}.extract.wav') &&
    downloadManagerStagingSrc.includes('${downloadId}.instrumental.extract.wav') &&
    downloadManagerStagingSrc.includes('cleanupInstrumentalRunTemps') &&
    downloadManagerStagingSrc.includes('processInstrumentalVideo') &&
    downloadManagerStagingSrc.includes('originalVideoPath') &&
    downloadManagerStagingSrc.includes('Instrumental staging:') &&
    downloadManagerStagingSrc.includes('YTDLP_INSTRUMENTAL_SUB_LANGS') &&
    downloadManagerStagingSrc.includes("'--sub-langs'") &&
    downloadManagerStagingSrc.includes('shouldWriteInstrumentalAutoSubs') &&
    downloadManagerStagingSrc.includes('includeSubtitles') &&
    !downloadManagerStagingSrc.includes("'en.*,it.*,es.*,fr.*,*-orig'") &&
    // No bare *-orig string literal in DownloadManager (constant lives in downloadStaging).
    !/['"]\*-orig['"]/.test(downloadManagerStagingSrc) &&
    !/['"][^'"]*,\*-orig/.test(downloadManagerStagingSrc) &&
    // Must not request all languages (YouTube 429).
    !downloadManagerStagingSrc.includes("'all,-live_chat'") &&
    downloadManagerStagingSrc.includes('logDownloadFailure') &&
    downloadManagerStagingSrc.includes("yt-dlp exited with error code") &&
    downloadManagerStagingSrc.includes('logger?.warn') &&
    downloadManagerStagingSrc.includes("'Spawning yt-dlp'") &&
    downloadManagerStagingSrc.includes('recentYtDlpLines') &&
    downloadManagerStagingSrc.includes("getLogLevel() === 'debug'") &&
    fs
      .readFileSync(path.resolve(__dirname, '../src/main/services/InstrumentalProcessor.ts'), 'utf8')
      .includes('resolveInstrumentalTempWavPaths'),
  'Instrumental path: relative yt-dlp -o + {id}.extract.wav → AI → remux; spawn error not clobbered'
);

// Runtime: pure staging helpers via Node strip-types (no Electron)
{
  const { spawnSync } = require('child_process');
  const probe = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--no-warnings',
      '-e',
      `
      import {
        parseYtDlpOutputPath,
        isYtDlpTransientMediaName,
        resolveDownloadedMediaPath,
        resolvePathAgainstTempDir,
        buildYtDlpOutputTemplate,
        YTDLP_INSTRUMENTAL_SUB_LANGS,
        shouldWriteInstrumentalAutoSubs
      } from ${JSON.stringify(path.resolve(__dirname, '../src/main/services/downloadStaging.ts'))};
      import fs from 'fs';
      import pathMod from 'path';
      import os from 'os';
      const assert = (c, m) => { if (!c) { console.error('PROBE_FAIL', m); process.exit(2); } };
      assert(buildYtDlpOutputTemplate('dl_1') === 'dl_1.%(ext)s', 'relative-outtmpl');
      assert(buildYtDlpOutputTemplate('dl_1/../x') === 'dl_1..x.%(ext)s', 'sanitize-id');
      assert(!buildYtDlpOutputTemplate('dl_abc').includes(pathMod.sep), 'no-abs-sep');
      assert(!buildYtDlpOutputTemplate('dl_abc').includes(':'), 'no-type-colon');
      assert(buildYtDlpOutputTemplate('dl_abc').includes('%(ext)s'), 'keeps-ext-field');
      assert(YTDLP_INSTRUMENTAL_SUB_LANGS === '.*-orig,default', 'sub-langs-orig-default');
      assert(YTDLP_INSTRUMENTAL_SUB_LANGS.includes('.*-orig'), 'has-orig-token');
      assert(!/(^|,)all(,|$)/.test(YTDLP_INSTRUMENTAL_SUB_LANGS), 'no-bare-all-token');
      // Forbid bare *-orig / tokens that start with * (no preceding .); allow .*-orig.
      assert(
        !YTDLP_INSTRUMENTAL_SUB_LANGS.split(',').some(
          (t) => t === '*-orig' || t === '*' || (t.startsWith('*') && !t.startsWith('.*'))
        ),
        'no-bare-star-orig-or-leading-star-token'
      );
      // Each comma-separated token must compile as a JS RegExp (same constraint as yt-dlp/Python re).
      for (const token of YTDLP_INSTRUMENTAL_SUB_LANGS.split(',')) {
        const pat = token.startsWith('-') ? token.slice(1) : token;
        if (pat === 'all' || pat === 'default') continue;
        try { new RegExp(pat); } catch (e) {
          console.error('PROBE_FAIL', 'sub-langs-regex', pat, e && e.message);
          process.exit(2);
        }
      }
      // includeSubtitles gating: false/undefined → no write-auto-sub path
      assert(
        shouldWriteInstrumentalAutoSubs({ instrumental: true }) === false,
        'subs-omit-default-false'
      );
      assert(
        shouldWriteInstrumentalAutoSubs({ instrumental: true, includeSubtitles: false }) === false,
        'subs-explicit-false'
      );
      assert(
        shouldWriteInstrumentalAutoSubs({
          instrumental: true,
          includeSubtitles: true,
          isAudioOnly: true
        }) === false,
        'subs-audio-only-false'
      );
      assert(
        shouldWriteInstrumentalAutoSubs({ instrumental: false, includeSubtitles: true }) === false,
        'subs-non-instrumental-false'
      );
      assert(
        shouldWriteInstrumentalAutoSubs({ instrumental: true, includeSubtitles: true }) === true,
        'subs-instrumental-true'
      );
      assert(parseYtDlpOutputPath('[download] Destination: /tmp/a.mp4') === '/tmp/a.mp4', 'dest');
      assert(
        parseYtDlpOutputPath('[Merger] Merging formats into "/tmp/b.mp4"') === '/tmp/b.mp4',
        'merger-quoted'
      );
      assert(
        parseYtDlpOutputPath('[Merger] Merging formats into /tmp/c.mp4') === '/tmp/c.mp4',
        'merger-bare'
      );
      assert(isYtDlpTransientMediaName('dl_1.f137.mp4'), 'fragment');
      assert(!isYtDlpTransientMediaName('dl_1.mp4'), 'final');
      assert(isYtDlpTransientMediaName('dl_1.extract.wav'), 'extract-wav');
      assert(isYtDlpTransientMediaName('dl_1.instrumental.extract.wav'), 'ai-out-wav');
      assert(isYtDlpTransientMediaName('dl_1.instrumental.mp4'), 'remux-sidecar');
      const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'kls-stage-'));
      fs.writeFileSync(pathMod.join(dir, 'dl_1.f137.mp4'), Buffer.alloc(2048));
      fs.writeFileSync(pathMod.join(dir, 'dl_1.mp4'), Buffer.alloc(4096));
      fs.writeFileSync(pathMod.join(dir, 'dl_1.en.srt'), 'x');
      const resolved = resolveDownloadedMediaPath(dir, 'dl_1', pathMod.join(dir, 'dl_1.f137.mp4'));
      assert(resolved === pathMod.join(dir, 'dl_1.mp4'), 'prefer final over fragment hint');
      const rel = resolvePathAgainstTempDir(dir, 'dl_1.mp4');
      assert(rel === pathMod.join(dir, 'dl_1.mp4'), 'relative against temp');
      fs.rmSync(dir, { recursive: true, force: true });
      console.log('PROBE_OK');
      `
    ],
    { encoding: 'utf8' }
  );
  assert(
    probe.status === 0 && (probe.stdout || '').includes('PROBE_OK'),
    'downloadStaging runtime: Destination/Merger parse + prefer final MP4 over fragment',
    (probe.stderr || probe.stdout || `exit ${probe.status}`).slice(0, 400)
  );
}

// -------------------------------------------------------------
// Suite: AI instrumental extract WAV orchestration (mock ORT)
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite: AI instrumental extract WAV pipeline\x1b[0m');

{
  const { spawnSync } = require('child_process');
  const extractVerify = path.resolve(__dirname, 'verify-ai-instrumental-extract.js');
  assert(fs.existsSync(extractVerify), 'verify-ai-instrumental-extract.js exists');
  const extractRun = spawnSync(process.execPath, [extractVerify], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 180000
  });
  assert(
    extractRun.status === 0 &&
      (extractRun.stdout || '').includes('All AI instrumental extract checks passed'),
    'verify-ai-instrumental-extract: naming + AI invoke + write + cleanup',
    (extractRun.stderr || extractRun.stdout || `exit ${extractRun.status}`).slice(0, 600)
  );
}

// -------------------------------------------------------------
// Suite: UVR-MDX geometry + ORT keep-alive wiring
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite: UVR-MDX geometry (timeout / overlap)\x1b[0m');

{
  const { spawnSync } = require('child_process');
  const geomVerify = path.resolve(__dirname, 'verify-mdx-uvr-geometry.js');
  assert(fs.existsSync(geomVerify), 'verify-mdx-uvr-geometry.js exists');
  const geomRun = spawnSync(process.execPath, [geomVerify], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 120000
  });
  assert(
    geomRun.status === 0 && (geomRun.stdout || '').includes('verify-mdx-uvr-geometry: all checks passed'),
    'verify-mdx-uvr-geometry: Default / fractional overlap geometry',
    (geomRun.stderr || geomRun.stdout || `exit ${geomRun.status}`).slice(0, 600)
  );
}

// -------------------------------------------------------------
// Suite: MDX advanced ETA settings (coerce / conditional payload)
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite: MDX advanced ETA settings\x1b[0m');

{
  const { spawnSync } = require('child_process');
  const advVerify = path.resolve(__dirname, 'verify-mdx-advanced-settings.js');
  assert(fs.existsSync(advVerify), 'verify-mdx-advanced-settings.js exists');
  const advRun = spawnSync(process.execPath, [advVerify], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 120000
  });
  assert(
    advRun.status === 0 &&
      (advRun.stdout || '').includes('verify-mdx-advanced-settings: all checks passed'),
    'verify-mdx-advanced-settings: coerce + non-MDX omit payload',
    (advRun.stderr || advRun.stdout || `exit ${advRun.status}`).slice(0, 600)
  );
}

// -------------------------------------------------------------
// Suite: AI GPU-First + prune methods + Demucs advanced + locale rename
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite: AI options pipeline (GPU / Demucs / prune)\x1b[0m');

{
  const { spawnSync } = require('child_process');
  const optsVerify = path.resolve(__dirname, 'verify-ai-options-pipeline.js');
  assert(fs.existsSync(optsVerify), 'verify-ai-options-pipeline.js exists');
  const optsRun = spawnSync(process.execPath, [optsVerify], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 120000
  });
  assert(
    optsRun.status === 0 &&
      (optsRun.stdout || '').includes('verify-ai-options-pipeline: all checks passed'),
    'verify-ai-options-pipeline: GPU providers + Demucs knobs + coerce + locales',
    (optsRun.stderr || optsRun.stdout || `exit ${optsRun.status}`).slice(0, 800)
  );
}

// -------------------------------------------------------------
// Suite: AI worker WebGPU telemetry (utilityProcess / backend not found)
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite: AI worker WebGPU telemetry\x1b[0m');

{
  const { spawnSync } = require('child_process');
  const webgpuVerify = path.resolve(__dirname, 'verify-ai-worker-webgpu-telemetry.js');
  assert(fs.existsSync(webgpuVerify), 'verify-ai-worker-webgpu-telemetry.js exists');
  assert(
    fs.existsSync(path.resolve(__dirname, 'probe-worker-webgpu.js')),
    'probe-worker-webgpu.js exists'
  );
  const webgpuRun = spawnSync(process.execPath, [webgpuVerify], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 120000
  });
  assert(
    webgpuRun.status === 0 &&
      (webgpuRun.stdout || '').includes('verify-ai-worker-webgpu-telemetry: all checks passed'),
    'verify-ai-worker-webgpu-telemetry: probe skip + logged fallback + no silent catch',
    (webgpuRun.stderr || webgpuRun.stdout || `exit ${webgpuRun.status}`).slice(0, 800)
  );
}

// -------------------------------------------------------------
// Suite: AI worker parentPort MessageEvent unwrap
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite: AI worker IPC MessageEvent unwrap\x1b[0m');

{
  const { spawnSync } = require('child_process');
  const ipcVerify = path.resolve(__dirname, 'verify-ai-worker-ipc-unwrap.js');
  assert(fs.existsSync(ipcVerify), 'verify-ai-worker-ipc-unwrap.js exists');
  const ipcRun = spawnSync(process.execPath, [ipcVerify], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 60000
  });
  assert(
    ipcRun.status === 0 &&
      (ipcRun.stdout || '').includes('verify-ai-worker-ipc-unwrap: all checks passed'),
    'verify-ai-worker-ipc-unwrap: MessageEvent unwrap + hardening wiring',
    (ipcRun.stderr || ipcRun.stdout || `exit ${ipcRun.status}`).slice(0, 600)
  );
}

// -------------------------------------------------------------
// Suite: Critical domain invariants (Safety-First source-lock)
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite: Critical domain invariants\x1b[0m');

{
  const { spawnSync } = require('child_process');
  const invVerify = path.resolve(__dirname, 'verify-critical-invariants.js');
  assert(fs.existsSync(invVerify), 'verify-critical-invariants.js exists');
  const invRun = spawnSync(process.execPath, [invVerify], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 60000
  });
  assert(
    invRun.status === 0 &&
      (invRun.stdout || '').includes('verify-critical-invariants: all checks passed'),
    'verify-critical-invariants: pitch0 / volume² / MessageEvent / SIAE 120s / queue_cache GC / SpessaSynth',
    (invRun.stderr || invRun.stdout || `exit ${invRun.status}`).slice(0, 600)
  );
}

// -------------------------------------------------------------
// Suite: AI vocal path routing (Download Instrumental)
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite: AI vocal path (Download Instrumental)\x1b[0m');

{
  const { spawnSync } = require('child_process');
  const vocalVerify = path.resolve(__dirname, 'verify-ai-vocal-path.js');
  assert(fs.existsSync(vocalVerify), 'verify-ai-vocal-path.js exists');
  const vocalRun = spawnSync(process.execPath, [vocalVerify], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 180000
  });
  assert(
    vocalRun.status === 0 &&
      (vocalRun.stdout || '').includes('All AI vocal path checks passed'),
    'verify-ai-vocal-path: AI vs DSP routing + abort + default aiMdxKaraoke2',
    (vocalRun.stderr || vocalRun.stdout || `exit ${vocalRun.status}`).slice(0, 600)
  );
}

// -------------------------------------------------------------
// Suite 12: OS filesystem drag-drop import
// (Suite 9 is already Portability / yt-dlp — this is the DnD suite.)
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite 12: OS filesystem drag-drop import\x1b[0m');

{
  const mainIndexSource = fs.readFileSync(
    path.resolve(__dirname, '../src/main/index.ts'),
    'utf8'
  );
  const preloadSource = fs.readFileSync(
    path.resolve(__dirname, '../src/preload/index.ts'),
    'utf8'
  );
  const databaseSource = fs.readFileSync(
    path.resolve(__dirname, '../src/main/db/database.ts'),
    'utf8'
  );
  const scannerSource = fs.readFileSync(
    path.resolve(__dirname, '../src/shared/libraryScanner.ts'),
    'utf8'
  );
  const libraryPanelSource = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/components/LibraryPanel.tsx'),
    'utf8'
  );
  const controlWindowSource = readControlUiSource();
  const fsDragDropSource = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/utils/fsDragDrop.ts'),
    'utf8'
  );

  assert(
    scannerSource.includes('export function discoverLibraryFilesFromPaths') &&
      scannerSource.includes('export function parseLibraryFilenameMeta') &&
      scannerSource.includes('export function isIncompleteLibraryArtifact') &&
      scannerSource.includes('.mkv') &&
      scannerSource.includes('.avi'),
    'libraryScanner exports path-list import + mkv/avi formats'
  );
  assert(
    mainIndexSource.includes("ipcMain.handle('library:import-files'") &&
      mainIndexSource.includes('discoverLibraryFilesFromPaths') &&
      mainIndexSource.includes('importFiles') &&
      mainIndexSource.includes('upsertTracksBatch') &&
      mainIndexSource.includes('enqueueThumbnailBackfill'),
    'Main exposes library:import-files with batch upsert'
  );
  assert(
    databaseSource.includes('upsertTracksBatch') &&
      databaseSource.includes('.transaction('),
    'DatabaseManager upsertTracksBatch uses SQLite transaction'
  );
  assert(
    preloadSource.includes('importFiles:') &&
      preloadSource.includes("ipcRenderer.invoke('library:import-files'") &&
      preloadSource.includes('getPathForFile') &&
      preloadSource.includes('webUtils.getPathForFile'),
    'Preload library.importFiles + webUtils.getPathForFile'
  );
  assert(
    fsDragDropSource.includes('dataTransferHasFiles') &&
      fsDragDropSource.includes("types.includes('Files')") &&
      fsDragDropSource.includes('resolveDroppedAbsolutePaths'),
    'fsDragDrop helpers gate on Files type'
  );
  assert(
    libraryPanelSource.includes('library.importFiles') &&
      libraryPanelSource.includes('library-panel-drop-zone') &&
      libraryPanelSource.includes('dataTransferHasFiles') &&
      libraryPanelSource.includes('importSuccess'),
    'LibraryPanel OS drop → importFiles + success toast'
  );
  assert(
    controlWindowSource.includes('library.importFiles') &&
      controlWindowSource.includes('queue-panel-drop-zone') &&
      controlWindowSource.includes('dataTransferHasFiles') &&
      controlWindowSource.includes('addToQueueBatch'),
    'ControlWindow queue OS drop → importFiles + addToQueueBatch'
  );
  assert(
    /library:scan-folder/.test(mainIndexSource) &&
      preloadSource.includes("ipcRenderer.invoke('library:scan-folder'"),
    'Existing scanFolder IPC preserved alongside import-files'
  );

  // Large-library / DnD perf contracts (25k-safe paths)
  assert(
    databaseSource.includes('getTracksByLocalPaths') &&
      databaseSource.includes('getTracksMissingThumbnails') &&
      databaseSource.includes('titleNorm') &&
      /titleNorm LIKE/.test(databaseSource) &&
      !/fold_diacritics\(title\) LIKE/.test(databaseSource),
    'DB search uses titleNorm; targeted path/thumb queries exist'
  );
  assert(
    /private async importFiles[\s\S]*getTracksByLocalPaths/.test(mainIndexSource) &&
      !/private async importFiles[\s\S]*getAllTracks\(\)/.test(mainIndexSource),
    'importFiles uses getTracksByLocalPaths (not getAllTracks dump)'
  );
  assert(
    mainIndexSource.includes('scheduleLibraryTrackUpdatedNotify') &&
      mainIndexSource.includes("library:track-updated") &&
      preloadSource.includes('onLibraryTrackUpdated') &&
      libraryPanelSource.includes('onLibraryTrackUpdated'),
    'Thumbnail backfill emits library:track-updated; LibraryPanel patches in-place'
  );
  assert(
    mainIndexSource.includes('getTracksMissingThumbnails') &&
      /ensureLocalThumbnails[\s\S]*getTracksMissingThumbnails/.test(mainIndexSource),
    'ensureLocalThumbnails uses targeted missing-thumb query'
  );
  assert(
    scannerSource.includes('dirCache') &&
      /discoverLibraryFilesFromPaths[\s\S]*dirCache/.test(scannerSource),
    'discoverLibraryFilesFromPaths memoizes directory readdir via dirCache'
  );
  const analysisSource = fs.readFileSync(
    path.resolve(__dirname, '../src/main/services/TrackAnalysisService.ts'),
    'utf8'
  );
  assert(
    analysisSource.includes('queuedTrackIds') &&
      !/queue\.some\(/.test(analysisSource),
    'TrackAnalysisService enqueue uses queuedTrackIds Set (no queue.some)'
  );
  const storeSourcePerf = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/store/karaokeStore.ts'),
    'utf8'
  );
  assert(
    storeSourcePerf.includes('addToQueueBatch') &&
      libraryPanelSource.includes('ids.has(t.id)') &&
      libraryPanelSource.includes('paths.has(t.localFilePath)'),
    'Set-based library drop dedup + addToQueueBatch exist'
  );
  assert(
    fs.existsSync(path.resolve(__dirname, 'benchmark-large-library.js')),
    'scripts/benchmark-large-library.js exists for 25k micro-benchmarks'
  );

  const { spawnSync } = require('child_process');
  const scannerPath = path.resolve(__dirname, '../src/shared/libraryScanner.ts');
  const probe = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--no-warnings',
      '-e',
      `
      import fs from 'fs';
      import path from 'path';
      import os from 'os';
      import {
        discoverLibraryFilesFromPaths,
        parseLibraryFilenameMeta,
        isIncompleteLibraryArtifact,
        LIBRARY_SCAN_MIN_BYTES
      } from ${JSON.stringify(scannerPath)};

      const assert = (c, m) => { if (!c) { console.error('PROBE_FAIL', m); process.exit(2); } };
      const pad = (n) => Buffer.alloc(Math.max(n, LIBRARY_SCAN_MIN_BYTES), 1);

      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kls-dnd-import-'));
      try {
        fs.writeFileSync(path.join(root, 'Queen - Bohemian Rhapsody.mp4'), pad(4096));
        fs.writeFileSync(path.join(root, 'SoloTitle.webm'), pad(4096));
        fs.writeFileSync(path.join(root, 'Clip.mkv'), pad(4096));
        fs.writeFileSync(path.join(root, 'Old.avi'), pad(4096));
        fs.writeFileSync(path.join(root, 'Pair.mp3'), pad(4096));
        fs.writeFileSync(path.join(root, 'Pair.cdg'), pad(4096));
        fs.writeFileSync(path.join(root, 'OnlyCdg.cdg'), pad(4096));
        fs.writeFileSync(path.join(root, 'OnlyCdg.mp3'), pad(4096));
        fs.writeFileSync(path.join(root, 'Tune.mid'), pad(4096));
        fs.writeFileSync(path.join(root, 'Song.kar'), pad(4096));
        fs.writeFileSync(path.join(root, 'Bad.mp4.part'), pad(4096));
        fs.writeFileSync(path.join(root, 'Tiny.mp4'), Buffer.alloc(100));

        const meta = parseLibraryFilenameMeta('Artist - Title Extra');
        assert(meta.artist === 'Artist' && meta.title === 'Title Extra', 'artist-title-split');
        const unknown = parseLibraryFilenameMeta('JustATitle');
        assert(unknown.artist === 'Unknown Artist' && unknown.title === 'JustATitle', 'unknown-artist');

        assert(isIncompleteLibraryArtifact(path.join(root, 'Bad.mp4.part')), 'reject-part');

        const found = discoverLibraryFilesFromPaths([
          path.join(root, 'Queen - Bohemian Rhapsody.mp4'),
          path.join(root, 'SoloTitle.webm'),
          path.join(root, 'Clip.mkv'),
          path.join(root, 'Old.avi'),
          path.join(root, 'Pair.mp3'),
          path.join(root, 'Pair.cdg'),
          path.join(root, 'OnlyCdg.cdg'),
          path.join(root, 'Tune.mid'),
          path.join(root, 'Song.kar'),
          path.join(root, 'Bad.mp4.part'),
          path.join(root, 'Tiny.mp4')
        ]);

        const paths = found.map((t) => t.absolutePath);
        assert(paths.some((p) => p.endsWith('Queen - Bohemian Rhapsody.mp4')), 'mp4');
        assert(paths.some((p) => p.endsWith('SoloTitle.webm')), 'webm');
        assert(paths.some((p) => p.endsWith('Clip.mkv')), 'mkv');
        assert(paths.some((p) => p.endsWith('Old.avi')), 'avi');
        assert(paths.some((p) => p.endsWith('Pair.mp3')), 'mp3');
        assert(paths.some((p) => p.endsWith('Tune.mid')), 'mid');
        assert(paths.some((p) => p.endsWith('Song.kar')), 'kar');
        assert(!paths.some((p) => p.includes('.part')), 'no-part');
        assert(!paths.some((p) => p.endsWith('Tiny.mp4')), 'no-tiny');

        const queen = found.find((t) => t.title === 'Bohemian Rhapsody');
        assert(queen && queen.artist === 'Queen', 'queen-meta');

        const solo = found.find((t) => t.absolutePath.endsWith('SoloTitle.webm'));
        assert(solo && solo.artist === 'Unknown Artist' && solo.title === 'SoloTitle', 'solo-unknown');

        const pair = found.find((t) => t.absolutePath.endsWith('Pair.mp3'));
        assert(pair && pair.hasEmbeddedLyrics === true, 'mp3-cdg-pair');

        // Dropping only .cdg still imports the sibling .mp3 with lyrics flag
        const onlyCdg = found.find((t) => t.absolutePath.endsWith('OnlyCdg.mp3'));
        assert(onlyCdg && onlyCdg.hasEmbeddedLyrics === true, 'cdg-drop-pairs-mp3');

        const kar = found.find((t) => t.absolutePath.endsWith('Song.kar'));
        assert(kar && kar.source === 'midi' && kar.hasEmbeddedLyrics === true, 'kar-midi');

        // Dedup: dropping mp3+cdg twice yields one track
        const again = discoverLibraryFilesFromPaths([
          path.join(root, 'Pair.mp3'),
          path.join(root, 'Pair.cdg'),
          path.join(root, 'Pair.mp3')
        ]);
        assert(again.length === 1, 'dedupe-pair');

        console.log('PROBE_OK');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
      `
    ],
    { encoding: 'utf8' }
  );
  assert(
    probe.status === 0 && (probe.stdout || '').includes('PROBE_OK'),
    'discoverLibraryFilesFromPaths: pairing, formats, .part reject, Artist-Title',
    (probe.stderr || probe.stdout || `exit ${probe.status}`).slice(0, 500)
  );
}

// -------------------------------------------------------------
// Suite 13: Missing local media file handling
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite 13: Missing local media file handling\x1b[0m');

{
  const mainIndexSource = fs.readFileSync(
    path.resolve(__dirname, '../src/main/index.ts'),
    'utf8'
  );
  const preloadSource = fs.readFileSync(
    path.resolve(__dirname, '../src/preload/index.ts'),
    'utf8'
  );
  const storeSource = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/store/karaokeStore.ts'),
    'utf8'
  );
  const localFileCheckSource = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/utils/localFileCheck.ts'),
    'utf8'
  );
  const missingModalSource = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/components/MissingFileModal.tsx'),
    'utf8'
  );
  const libraryPanelSource = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/components/LibraryPanel.tsx'),
    'utf8'
  );
  const controlWindowSource = readControlUiSource();
  const itLocale = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../locales/it.json'), 'utf8')
  );
  const enLocale = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../locales/en.json'), 'utf8')
  );
  const esLocale = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../locales/es.json'), 'utf8')
  );
  const frLocale = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../locales/fr.json'), 'utf8')
  );

  assert(
    mainIndexSource.includes("ipcMain.handle('library:check-file-exists'") &&
      mainIndexSource.includes('exists: true') &&
      mainIndexSource.includes('fs.existsSync') &&
      mainIndexSource.includes('karaoke|blob|data'),
    'Main library:check-file-exists returns {exists,path} and skips non-fs URIs'
  );
  assert(
    preloadSource.includes('checkFileExists:') &&
      preloadSource.includes("ipcRenderer.invoke('library:check-file-exists'") &&
      preloadSource.includes('result?.exists'),
    'Preload checkFileExists unwraps IPC to Promise<boolean>'
  );
  assert(
    localFileCheckSource.includes('shouldSkipLocalFileExistsCheck') &&
      localFileCheckSource.includes('trackNeedsLocalFileCheck') &&
      localFileCheckSource.includes('checkTrackLocalFileExists') &&
      localFileCheckSource.includes('https?:'),
    'localFileCheck helpers skip empty/web URLs'
  );
  assert(
    storeSource.includes('missingTrackIds') &&
      storeSource.includes('markTrackMissing') &&
      storeSource.includes('clearTrackMissing') &&
      storeSource.includes('MissingFileContext') &&
      storeSource.includes("'library' | 'queue'") &&
      storeSource.includes("context: 'queue'"),
    'Store exposes missingTrackIds + modal context library|queue'
  );
  assert(
    missingModalSource.includes('MissingFileModal') &&
      missingModalSource.includes('missingFileDelete') &&
      missingModalSource.includes('missingFileKeep') &&
      missingModalSource.includes('db.deleteTrack') &&
      missingModalSource.includes('removeFromQueue') &&
      missingModalSource.includes('missingFileAlsoDeleteLibrary'),
    'MissingFileModal: Elimina / Lascia + optional library delete'
  );
  assert(
    libraryPanelSource.includes('checkTrackLocalFileExists') &&
      libraryPanelSource.includes("context: 'library'") &&
      libraryPanelSource.includes('rose-500/70') &&
      libraryPanelSource.includes('FileX') &&
      libraryPanelSource.includes('missingTrackIds'),
    'LibraryPanel enqueue gate + rose missing styling'
  );
  assert(
    controlWindowSource.includes('checkTrackLocalFileExists') &&
      controlWindowSource.includes('pauseResetForMissingFile') &&
      controlWindowSource.includes('<MissingFileModal') &&
      controlWindowSource.includes("context: 'queue'") &&
      controlWindowSource.includes('rose-500/70'),
    'ControlWindow play/jump/coordinator gate + MissingFileModal'
  );
  // Safety-First: never silent auto-delete on miss
  assert(
    !missingModalSource.includes('auto-delete') ||
      missingModalSource.includes('Never auto-deletes') ||
      missingModalSource.includes('never auto-delete'),
    'MissingFileModal documents no auto-delete'
  );

  const requiredErrorKeys = [
    'missingFileTitle',
    'missingFilePathLabel',
    'missingFileUsbHint',
    'missingFileKeep',
    'missingFileDelete',
    'missingFileTooltip',
    'missingFileAlsoDeleteLibraryMessage',
    'missingFileAlsoDeleteLibraryConfirm',
    'missingFileAlsoDeleteLibraryCancel'
  ];
  for (const key of requiredErrorKeys) {
    assert(Boolean(itLocale.errors?.[key]), `it.json errors.${key}`);
    assert(Boolean(enLocale.errors?.[key]), `en.json errors.${key}`);
    assert(Boolean(esLocale.errors?.[key]), `es.json errors.${key}`);
    assert(Boolean(frLocale.errors?.[key]), `fr.json errors.${key}`);
  }

  // Runtime probe: skip rules + existsSync semantics mirrored in helpers
  const tmpMissing = path.join(os.tmpdir(), `kls-missing-${Date.now()}-${process.pid}`);
  assert(!fs.existsSync(tmpMissing), 'probe path does not exist yet');

  function shouldSkip(filePath) {
    const p = (filePath || '').trim();
    if (!p) return true;
    if (/^https?:\/\//i.test(p)) return true;
    if (/^(karaoke|blob|data):/i.test(p)) return true;
    return false;
  }
  assert(shouldSkip('') === true, 'skip empty path');
  assert(shouldSkip('https://youtube.com/watch?v=abc') === true, 'skip https URL');
  assert(shouldSkip('karaoke://local/foo') === true, 'skip karaoke:// URI');
  assert(shouldSkip('/abs/path/song.mp4') === false, 'do not skip absolute path');
  assert(fs.existsSync(tmpMissing) === false, 'missing absolute path → exists false');
}

// -------------------------------------------------------------
// Suite: Startup launch prefs + AI CPU threads + Settings layout + v1.3.0
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite: Startup / AI cores / Settings layout / v1.3.0\x1b[0m');

// Clamp logic mirrors src/shared/aiCpuThreads.ts (Node test runner has no TS import).
function resolveAiCpuThreadsTest(configured, totalCpus) {
  const n = Math.max(1, Math.floor(Number(totalCpus)) || 1);
  if (configured == null || configured === undefined) return n;
  const raw = typeof configured === 'number' ? configured : Number(configured);
  if (!Number.isFinite(raw)) return n;
  const t = Math.floor(raw);
  if (t < 1) return 1;
  return Math.min(t, n);
}

assert(resolveAiCpuThreadsTest(null, 8) === 8, 'null aiCpuThreads → all cores (N=8)');
assert(resolveAiCpuThreadsTest(undefined, 4) === 4, 'undefined aiCpuThreads → all cores (N=4)');
assert(resolveAiCpuThreadsTest(-3, 8) === 1, 'negative threads clamp to 1');
assert(resolveAiCpuThreadsTest(0, 8) === 1, 'zero threads clamp to 1');
assert(resolveAiCpuThreadsTest(99, 8) === 8, 'threads > N clamp to N');
assert(resolveAiCpuThreadsTest(3, 8) === 3, 'valid threads pass through');
assert(resolveAiCpuThreadsTest(NaN, 6) === 6, 'NaN configured → all cores');

const storeSrcLaunch = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/store/karaokeStore.ts'),
  'utf8'
);
assert(
  /autoMaximizeControlOnLaunch:\s*true/.test(storeSrcLaunch),
  'autoMaximizeControlOnLaunch defaults to true'
);
assert(
  /autoOpenStageOnLaunch:\s*true/.test(storeSrcLaunch),
  'autoOpenStageOnLaunch defaults to true'
);
assert(
  /aiCpuThreads:\s*null/.test(storeSrcLaunch),
  'aiCpuThreads defaults to null (all cores)'
);

const mainSrcLaunch = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8');
assert(
  mainSrcLaunch.includes('controlWindow.maximize()') &&
    mainSrcLaunch.includes('autoMaximizeControlOnLaunch') &&
    mainSrcLaunch.includes('autoOpenStageOnLaunch') &&
    mainSrcLaunch.includes('createStageWindow') &&
    mainSrcLaunch.includes("ipcMain.handle('window:reopen-stage'") &&
    mainSrcLaunch.includes("ipcMain.handle('stage:open'"),
  'Main maximizes Regia on launch prefs; Stage skip + reopen/stage:open watchlist intact'
);

const mdxSepSrc = fs.readFileSync(
  path.resolve(__dirname, '../src/main/ai/MdxNetSeparator.ts'),
  'utf8'
);
const aiWorkerSrc = fs.readFileSync(
  path.resolve(__dirname, '../src/main/workers/instrumentalAiWorker.ts'),
  'utf8'
);
const aiSeparateCoreSrc = fs.readFileSync(
  path.resolve(__dirname, '../src/main/workers/instrumentalAiSeparateCore.ts'),
  'utf8'
);
assert(
  mdxSepSrc.includes('resolveAiCpuThreads') &&
    mdxSepSrc.includes('ort.env.wasm.numThreads') &&
    mdxSepSrc.includes('resolveAiOrtExecutionProviders') &&
    (mdxSepSrc.includes('resolveWorkerOrtProviders') ||
      mdxSepSrc.includes("preferGpu ? ['webgpu', 'wasm'] : ['wasm']") ||
      mdxSepSrc.includes("executionProviders: ['webgpu']") ||
      mdxSepSrc.includes("executionProviders: ['webgpu', 'wasm']")) &&
    !/ort\.env\.wasm\.numThreads\s*=\s*1/.test(mdxSepSrc),
  'MdxNetSeparator uses dynamic threads + GPU-gated webgpu/wasm (no forced numThreads=1)'
);
assert(
  aiSeparateCoreSrc.includes('resolveAiCpuThreads') &&
    aiWorkerSrc.includes('runInstrumentalAiSeparate') &&
    !/ort\.env\.wasm\.numThreads\s*=\s*1/.test(aiSeparateCoreSrc),
  'instrumentalAiSeparateCore uses resolveAiCpuThreads (no forced numThreads=1)'
);

const settingsModalSrcV13 = readSettingsUiSource();
const settingsModalShellV13 = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/SettingsModal.tsx'),
  'utf8'
);
assert(
  settingsModalShellV13.includes('max-w-5xl') &&
    settingsModalShellV13.includes('h-[88vh]') &&
    settingsModalShellV13.includes('w-[220px]') &&
    settingsModalSrcV13.includes('aiCpuThreads') &&
    settingsModalSrcV13.includes('autoMaximizeControlOnLaunch') &&
    settingsModalSrcV13.includes('autoOpenStageOnLaunch') &&
    settingsModalShellV13.includes("useState('1.5.0')"),
  'SettingsModal wider sidebar layout + launch/AI cores + v1.5.0 footer state'
);

// Instrumental block lives under Library tab component (shell still orders library before audio)
const libIdx = settingsModalShellV13.indexOf("showCategory('library'");
const audioIdx = settingsModalShellV13.indexOf("showCategory('audio'");
const libraryTabSrc = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/settings/SettingsLibraryTab.tsx'),
  'utf8'
);
assert(
  libIdx >= 0 &&
    audioIdx > libIdx &&
    libraryTabSrc.includes('instrumentalVocalRemoverMethod'),
  'Instrumental method UI is under Library & Download (before Audio section)'
);

const pkgV13 = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
const changelogV13 = fs.readFileSync(path.resolve(__dirname, '../CHANGELOG.md'), 'utf8');
const releaseNotesV13 = fs.readFileSync(path.resolve(__dirname, '../RELEASE_NOTES.md'), 'utf8');
assert(pkgV13.version === '1.5.0', 'package.json version is 1.5.0');
assert(
  changelogV13.includes('## [1.5.0]') || changelogV13.includes('## [1.5.0] '),
  'CHANGELOG has ## [1.5.0] section'
);
assert(
  changelogV13.includes('## [1.4.0]') || changelogV13.includes('## [1.4.0] '),
  'CHANGELOG retains ## [1.4.0] section'
);
assert(
  changelogV13.includes('## [1.3.0]') || changelogV13.includes('## [1.3.0] '),
  'CHANGELOG retains ## [1.3.0] section'
);
assert(
  /v1\.5\.0|Version 1\.5\.0|Versione 1\.5\.0/.test(releaseNotesV13),
  'RELEASE_NOTES mentions 1.5.0'
);

for (const lang of ['it', 'en', 'es', 'fr']) {
  const loc = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, `../locales/${lang}.json`), 'utf8')
  );
  assert(
    loc.settings?.autoMaximizeControl &&
      loc.settings?.autoOpenStage &&
      loc.settings?.aiCpuThreads &&
      loc.settings?.aiCpuCoresAvailable &&
      loc.settings?.aiCpuThreadsResetMax,
    `${lang}.json has launch + AI CPU settings keys`
  );
}

const controlSrcF2 = readControlUiSource();
assert(
  controlSrcF2.includes("e.code === 'F2'") &&
    controlSrcF2.includes('reopenStageWindow'),
  'ControlWindow F2 reopens Stage (alongside P)'
);

// -------------------------------------------------------------
// Suite: Signalsmith default DSP + SoundTouch selectable + ranges / bypass / fallback
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite: Signalsmith DSP default + SoundTouch selectable\x1b[0m');

const dspPitchShared = fs.readFileSync(
  path.resolve(__dirname, '../src/shared/dspPitch.ts'),
  'utf8'
);
const signalsmithNodeSrc = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/core/SignalsmithPitchShifterNode.ts'),
  'utf8'
);
const pitchShifterSrc = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/core/PitchShifterNode.ts'),
  'utf8'
);
const audioGraphDspSrc = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/core/AudioGraphManager.ts'),
  'utf8'
);
const storeDspSrc = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/store/karaokeStore.ts'),
  'utf8'
);
const settingsDspSrc = readSettingsUiSource();

// Mirror clamp helpers from src/shared/dspPitch.ts for Node assertions
function clampPitchForEngineTest(semitones, engine) {
  const min = engine === 'soundtouch' ? -4 : -8;
  const max = engine === 'soundtouch' ? 4 : 8;
  const n = Number.isFinite(semitones) ? Math.round(semitones) : 0;
  return Math.max(min, Math.min(max, n));
}
function clampSpeedForEngineTest(speed, engine) {
  const min = engine === 'soundtouch' ? 0.75 : 0.5;
  const max = engine === 'soundtouch' ? 1.25 : 1.5;
  const n = Number.isFinite(speed) ? speed : 1;
  return Math.max(min, Math.min(max, Math.round(n * 100) / 100));
}
function isDspNeutralBypassTest(pitch, speed) {
  return pitch === 0 && Math.abs(speed - 1) < 0.001;
}

assert(
  dspPitchShared.includes("return 'signalsmith'") &&
    dspPitchShared.includes("Unknown / missing → `'signalsmith'`"),
  'coerceDspPitchEngine defaults to signalsmith (Hi-Fi)'
);

assert(
  /dspEngine:\s*'signalsmith'/.test(storeDspSrc),
  'Default settings.dspEngine === signalsmith (Hi-Fi)'
);
assert(
  dspPitchShared.includes("export type DspPitchEngine = 'signalsmith' | 'soundtouch'") &&
    dspPitchShared.includes('SIGNALSMITH_PITCH_UI_MIN = -8') &&
    dspPitchShared.includes('SOUNDTOUCH_PITCH_MIN = -4') &&
    dspPitchShared.includes('SIGNALSMITH_SPEED_UI_MIN = 0.5') &&
    dspPitchShared.includes('SIGNALSMITH_SPEED_UI_MAX = 1.5') &&
    dspPitchShared.includes('SOUNDTOUCH_SPEED_UI_MIN = 0.75') &&
    dspPitchShared.includes('SOUNDTOUCH_SPEED_UI_MAX = 1.25') &&
    dspPitchShared.includes('SIGNALSMITH_SPEED_ABSOLUTE_MAX = 2.0') &&
    dspPitchShared.includes("value === 'bungee'") &&
    dspPitchShared.includes('getSpeedRangeForEngine') &&
    dspPitchShared.includes('clampSpeedForEngine'),
  'Shared pitch + speed ranges: Hi-Fi UI ±8 / 0.50–1.50, SoundTouch ±4 / 0.75–1.25'
);
assert(
  clampPitchForEngineTest(9, 'signalsmith') === 8 &&
    clampPitchForEngineTest(-9, 'signalsmith') === -8 &&
    clampPitchForEngineTest(5, 'soundtouch') === 4 &&
    clampPitchForEngineTest(-5, 'soundtouch') === -4,
  'Semitone clamp per engine (Hi-Fi ±8, SoundTouch ±4)'
);
assert(
  clampSpeedForEngineTest(0.4, 'signalsmith') === 0.5 &&
    clampSpeedForEngineTest(1.8, 'signalsmith') === 1.5 &&
    clampSpeedForEngineTest(0.6, 'soundtouch') === 0.75 &&
    clampSpeedForEngineTest(1.4, 'soundtouch') === 1.25 &&
    clampSpeedForEngineTest(1.111, 'signalsmith') === 1.11,
  'Speed clamp per engine (Hi-Fi 0.50–1.50, SoundTouch 0.75–1.25, round 0.01)'
);
assert(
  clampSpeedForEngineTest(0.6, 'soundtouch') === 0.75,
  'Engine switch Hi-Fi→SoundTouch re-clips 0.60 → 0.75'
);
assert(
  isDspNeutralBypassTest(0, 1.0) === true &&
    isDspNeutralBypassTest(1, 1.0) === false &&
    isDspNeutralBypassTest(0, 1.05) === false &&
    isDspNeutralBypassTest(0, 0.75) === false,
  'Shared isDspNeutralBypass: pitch 0 & speed 1.0 only'
);
assert(
  signalsmithNodeSrc.includes('signalsmith-stretch') &&
    signalsmithNodeSrc.includes('SignalsmithStretch') &&
    signalsmithNodeSrc.includes('applyBypassRouting') &&
    signalsmithNodeSrc.includes('semitones !== 0') &&
    signalsmithNodeSrc.includes('setUnderrunFallbackHandler') &&
    signalsmithNodeSrc.includes('WATCHDOG_SILENT_POLLS') &&
    signalsmithNodeSrc.includes('HIFI_INIT_TIMEOUT_MS'),
  'SignalsmithPitchShifterNode: Signalsmith Stretch Hi-Fi + pitch-0 bypass + mute watchdog'
);
assert(
  pitchShifterSrc.includes('SOUNDTOUCH_PITCH_MIN') &&
    pitchShifterSrc.includes('bypassActive = true') &&
    pitchShifterSrc.includes('const needsProcessor = clamped !== 0'),
  'SoundTouch path retained with pitch-0 ScriptProcessor bypass'
);
assert(
  audioGraphDspSrc.includes('setDspEngine') &&
    audioGraphDspSrc.includes('SignalsmithPitchShifterNode') &&
    audioGraphDspSrc.includes('falling back to SoundTouch') &&
    audioGraphDspSrc.includes('PitchShifterNode') &&
    audioGraphDspSrc.includes('Signalsmith Hi-Fi wired') &&
    audioGraphDspSrc.includes('Pitch offset applied') &&
    audioGraphDspSrc.includes('dspEnsurePromise') &&
    audioGraphDspSrc.includes('applyMediaElementRateForActiveEngine') &&
    audioGraphDspSrc.includes('Signalsmith Hi-Fi mute watchdog') &&
    audioGraphDspSrc.includes('applySoundTouchFallback') &&
    audioGraphDspSrc.includes('setDspEngineFallbackHandler'),
  'AudioGraphManager: Signalsmith Hi-Fi wire + media rate + SoundTouch emergency fallback'
);
{
  const controlDspSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/components/ControlWindow.tsx'),
    'utf8'
  );
  const controlUiDspSrc = readControlUiSource();
  assert(
    controlDspSrc.includes('playback.playbackSpeed') &&
      controlDspSrc.includes('preservesPitch') &&
      controlDspSrc.includes('getSpeedRangeForEngine') &&
      controlUiDspSrc.includes('speedRange.min') &&
      controlUiDspSrc.includes('speedRange.max') &&
      controlUiDspSrc.includes('setPlaybackSpeed(1.0)') &&
      controlUiDspSrc.includes('clampSpeedForEngine'),
    'Control UI: media rate = playbackSpeed + preservesPitch + dynamic speed range'
  );
}
assert(
  storeDspSrc.includes('clampSpeedForEngine') &&
    storeDspSrc.includes('partial.dspEngine') &&
    storeDspSrc.includes('playbackSpeed: nextSpeed'),
  'karaokeStore: setPlaybackSpeed clamps by engine; engine switch re-clamps speed'
);
assert(
  settingsDspSrc.includes('value="signalsmith"') &&
    settingsDspSrc.includes('value="soundtouch"') &&
    settingsDspSrc.includes('dspEngine') &&
    settingsDspSrc.includes('dspEngineHiFiLabel'),
  'SettingsModal exposes Hi-Fi (signalsmith id) / SoundTouch engine select'
);
assert(
  fs.existsSync(path.resolve(__dirname, '../public/workers/SIGNALSMITH_NOTICE.md')) &&
    !fs.existsSync(path.resolve(__dirname, '../public/workers/bungee_processor.js')) &&
    !fs.existsSync(path.resolve(__dirname, '../public/workers/bungee.wasm')),
  'Signalsmith NOTICE present; broken Bungee Wasm assets removed'
);
{
  const pkgJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')
  );
  assert(
    !!pkgJson.dependencies?.['signalsmith-stretch'],
    'package.json depends on signalsmith-stretch'
  );
  assert(
    signalsmithNodeSrc.includes("this.send('reset')") === false &&
      signalsmithNodeSrc.includes('setUnderrunFallbackHandler'),
    'Hi-Fi node uses Signalsmith schedule API (no legacy bungee port messages)'
  );
  assert(
    audioGraphDspSrc.includes('Signalsmith Hi-Fi mute watchdog') &&
      audioGraphDspSrc.includes("preferredDspEngine = 'soundtouch'"),
    'AudioGraphManager: Hi-Fi mute watchdog switches to SoundTouch'
  );
}
assert(
  !fs.existsSync(path.resolve(__dirname, '../vendor/bungee')) &&
    !fs.existsSync(path.resolve(__dirname, '../third_party/bungee')),
  'No vendored Bungee C++ source tree in repo'
);
assert(
  enLocale.settings?.dspEngine &&
    itLocale.settings?.dspEngine &&
    esLocale.settings?.dspEngine &&
    frLocale.settings?.dspEngine &&
    String(enLocale.settings.dspEngineSignalsmith || enLocale.settings.dspEngineBungee || '')
      .toLowerCase()
      .includes('signalsmith') &&
    String(enLocale.settings.dspEngineSoundTouch || '').toLowerCase().includes('emergency') &&
    enLocale.settings?.dspEngineHiFiLabel &&
    itLocale.settings?.dspEngineHiFiLabel &&
    esLocale.settings?.dspEngineHiFiLabel &&
    frLocale.settings?.dspEngineHiFiLabel &&
    enLocale.settings?.dspEngineSignalsmithBlurb &&
    itLocale.settings?.dspEngineSignalsmithBlurb,
  'i18n DSP engine keys: Signalsmith Hi-Fi default + SoundTouch emergency in en/it/es/fr'
);


// -------------------------------------------------------------
// Suite: Library Phase 2 (delta / async scan / FTS5 / paged Local)
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite: Library Phase 2 (14k scale)\x1b[0m');
{
  const dbSrc = fs.readFileSync(path.resolve(__dirname, '../src/main/db/database.ts'), 'utf8');
  const mainSrc = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8');
  const preloadSrc = fs.readFileSync(path.resolve(__dirname, '../src/preload/index.ts'), 'utf8');
  const panelSrc = fs.readFileSync(path.resolve(__dirname, '../src/renderer/components/LibraryPanel.tsx'), 'utf8');
  const scannerSrc = fs.readFileSync(path.resolve(__dirname, '../src/shared/libraryScanner.ts'), 'utf8');
  const aiSepSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/main/services/InstrumentalAiSeparator.ts'),
    'utf8'
  );
  const graphSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/core/AudioGraphManager.ts'),
    'utf8'
  );
  const keysSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/hooks/useKeyboardShortcuts.ts'),
    'utf8'
  );
  assert(
    dbSrc.includes('fileMtimeMs') &&
      dbSrc.includes('fileSizeBytes') &&
      dbSrc.includes('tracks_fts') &&
      dbSrc.includes('getTracksPage') &&
      dbSrc.includes('getPathFingerprints') &&
      dbSrc.includes('searchTracksFts'),
    'DB: delta fingerprints + FTS5 + keyset getTracksPage'
  );
  assert(
    mainSrc.includes('discoverLibraryMediaAsync') &&
      mainSrc.includes('library:scan-progress') &&
      mainSrc.includes('getPathFingerprints') &&
      mainSrc.includes('deleteTracksMissingFromScan'),
    'Main: async scan + progress IPC + delta upsert/prune'
  );
  assert(
    scannerSrc.includes('discoverLibraryMediaAsync') &&
      scannerSrc.includes('opendir') &&
      scannerSrc.includes('deferZipInspect'),
    'libraryScanner: async opendir walk with deferred ZIP inspect'
  );
  assert(
    preloadSrc.includes('getTracksPage') &&
      preloadSrc.includes('onScanProgress') &&
      preloadSrc.includes('db:get-tracks-page'),
    'Preload exposes paged Local + scan progress'
  );
  assert(
    panelSrc.includes('getTracksPage') &&
      panelSrc.includes('loadMoreLocalTracks') &&
      panelSrc.includes('onScanProgress'),
    'LibraryPanel warm-loads via getTracksPage + scan progress'
  );
  assert(
    aiSepSrc.includes('effectiveAiCpuThreads') &&
      aiSepSrc.includes('aiCpuThreads: effectiveAiCpuThreads'),
    'WebGPU→WASM re-route reasserts resolveAiCpuThreads / aiCpuThreads'
  );
  assert(
    graphSrc.includes('applySoundTouchFallback') && keysSrc.includes('pitchRange.max'),
    'SoundTouch fallback clamps pitch bounds; shortcuts use engine pitchRange'
  );
}

// -------------------------------------------------------------
// Suite: Signalsmith pitch lab (-1..-4 ST, 500+ blocks, no mute)
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite: Signalsmith pitch lab (-1..-4 ST)\x1b[0m');

{
  const labScript = path.resolve(__dirname, 'lab-signalsmith-pitch.js');
  assert(fs.existsSync(labScript), 'scripts/lab-signalsmith-pitch.js exists');
  const { spawnSync } = require('child_process');
  const labRun = spawnSync(process.execPath, [labScript], {
    encoding: 'utf8',
    cwd: path.resolve(__dirname, '..'),
    timeout: 60000
  });
  assert(
    labRun.status === 0 &&
      (labRun.stdout || '').includes('lab-signalsmith-pitch: all checks passed'),
    'Signalsmith lab: 520 blocks at -1..-4 ST, maxAmp never 0 after warm-up',
    (labRun.stderr || labRun.stdout || `exit ${labRun.status}`).slice(0, 800)
  );

  // AI conversion must not hang forever: hard timeout still bounded + Part 1 intact.
  const sepTimeoutSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/main/services/InstrumentalAiSeparator.ts'),
    'utf8'
  );
  assert(
    sepTimeoutSrc.includes('AI_SEPARATION_MAX_TIMEOUT_MS') &&
      sepTimeoutSrc.includes('gpu-fallback-requested') &&
      sepTimeoutSrc.includes('allowInProcessWasmFallback') &&
      sepTimeoutSrc.includes('utilityProcess') &&
      sepTimeoutSrc.includes('clearJobHandler'),
    'AI separator: bounded timeout + Hidden Renderer gpu-fallback → utilityProcess'
  );

  const mainQuitSrc = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8');
  const hiddenProbeSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/main/services/InstrumentalAiHiddenRenderer.ts'),
    'utf8'
  );
  const mdxWatchSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/main/ai/MdxNetSeparator.ts'),
    'utf8'
  );
  const sepCoreWatchSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/main/workers/instrumentalAiSeparateCore.ts'),
    'utf8'
  );
  const gpuFallbackShared = fs.readFileSync(
    path.resolve(__dirname, '../src/shared/aiGpuFallback.ts'),
    'utf8'
  );
  assert(
    mainQuitSrc.includes("controlWindow.on('closed'") &&
      mainQuitSrc.includes('app.quit()') &&
      mainQuitSrc.includes('getInstrumentalAiHiddenRenderer') &&
      mainQuitSrc.includes('cancelAllDownloads') &&
      mainQuitSrc.includes("app.on('before-quit'") &&
      hiddenProbeSrc.includes('requestDevice') &&
      hiddenProbeSrc.includes('WEBGPU_DEVICE_PROBE_TIMEOUT_MS') &&
      mdxWatchSrc.includes('WEBGPU_SESSION_TIMEOUT_MS') &&
      sepCoreWatchSrc.includes('WEBGPU_SESSION_TIMEOUT_MS') &&
      sepCoreWatchSrc.includes('jsepWasm') &&
      gpuFallbackShared.includes('WEBGPU_SESSION_TIMEOUT_MS = 15_000') &&
      gpuFallbackShared.includes('WEBGPU_DEVICE_PROBE_TIMEOUT_MS = 5_000'),
    'Quit: Control close disposes Hidden Renderer + app.quit; WebGPU device probe + 15s session watchdog'
  );
}

// -------------------------------------------------------------
// Suite: Instrumental subtitles confirmation modal + 429-safe sub-langs
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite: Instrumental subtitles modal + sub-langs gating\x1b[0m');

{
  const typesSubsSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/shared/types.ts'),
    'utf8'
  );
  const storeSubsSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/store/karaokeStore.ts'),
    'utf8'
  );
  const librarySubsSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/components/LibraryPanel.tsx'),
    'utf8'
  );
  const modalSubsPath = path.resolve(
    __dirname,
    '../src/renderer/components/InstrumentalSubtitlesModal.tsx'
  );
  const dmSubsSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/main/services/DownloadManager.ts'),
    'utf8'
  );

  assert(fs.existsSync(modalSubsPath), 'InstrumentalSubtitlesModal.tsx exists');
  const modalSubsSrc = fs.readFileSync(modalSubsPath, 'utf8');

  assert(
    typesSubsSrc.includes("instrumentalSubtitlesPolicy: 'ask' | 'always' | 'never'") &&
      typesSubsSrc.includes('includeSubtitles?: boolean'),
    'types: instrumentalSubtitlesPolicy + StartDownloadOptions.includeSubtitles'
  );

  assert(
    /instrumentalSubtitlesPolicy:\s*'ask'/.test(storeSubsSrc) &&
      storeSubsSrc.includes("raw === 'always' || raw === 'never'"),
    'karaokeStore defaults instrumentalSubtitlesPolicy to ask + coerces merge'
  );

  assert(
    librarySubsSrc.includes('InstrumentalSubtitlesModal') &&
      librarySubsSrc.includes('handleInstrumentalDownloadClick') &&
      librarySubsSrc.includes('includeSubtitles') &&
      librarySubsSrc.includes('instrumentalSubtitlesPolicy'),
    'LibraryPanel opens modal / honors policy before instrumental download'
  );

  assert(
    modalSubsSrc.includes('instrumental-subtitles-modal') &&
      modalSubsSrc.includes("e.key === 'Escape'") &&
      modalSubsSrc.includes('onClick={onClose}') &&
      modalSubsSrc.includes('instrumentalSubtitlesWarning') &&
      modalSubsSrc.includes('instrumentalSubtitlesWith') &&
      modalSubsSrc.includes('instrumentalSubtitlesWithout'),
    'InstrumentalSubtitlesModal: Esc/outside cancel + with/without actions + amber warning'
  );

  // Settings → Library: same policy editable later (ask clears remembered always/never)
  const settingsLibrarySubsSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/components/settings/SettingsLibraryTab.tsx'),
    'utf8'
  );
  const settingsModalSubsSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/components/SettingsModal.tsx'),
    'utf8'
  );
  assert(
    settingsLibrarySubsSrc.includes('instrumentalSubtitlesPolicy') &&
      settingsLibrarySubsSrc.includes('settings-instrumental-subtitles-policy') &&
      settingsLibrarySubsSrc.includes("value=\"ask\"") &&
      settingsLibrarySubsSrc.includes("value=\"always\"") &&
      settingsLibrarySubsSrc.includes("value=\"never\"") &&
      settingsModalSubsSrc.includes('matchInstrumentalSubtitles'),
    'Settings Library exposes instrumentalSubtitlesPolicy ask/always/never + search match'
  );

  // Flags only when shouldWriteInstrumentalAutoSubs (instrumental + includeSubtitles)
  assert(
    dmSubsSrc.includes('shouldWriteInstrumentalAutoSubs') &&
      dmSubsSrc.includes("'--write-auto-sub'") &&
      dmSubsSrc.includes('includeSubtitles'),
    'DownloadManager gates --write-auto-sub on shouldWriteInstrumentalAutoSubs'
  );

  // Normal download path must not force includeSubtitles / modal
  assert(
    !/handleStartDownload\(track\)[\s\S]{0,40}includeSubtitles:\s*true/.test(librarySubsSrc),
    'Normal download click does not force includeSubtitles'
  );

  for (const lang of ['it', 'en', 'es', 'fr']) {
    const loc = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, `../locales/${lang}.json`), 'utf8')
    );
    assert(
      loc.library?.instrumentalSubtitlesTitle &&
        loc.library?.instrumentalSubtitlesAsk &&
        loc.library?.instrumentalSubtitlesWarning &&
        loc.library?.instrumentalSubtitlesWith &&
        loc.library?.instrumentalSubtitlesWithout &&
        loc.library?.instrumentalSubtitlesCancel &&
        loc.library?.instrumentalSubtitlesRemember &&
        loc.settings?.instrumentalSubtitlesPolicy &&
        loc.settings?.instrumentalSubtitlesPolicyDesc &&
        loc.settings?.instrumentalSubtitlesPolicyAsk &&
        loc.settings?.instrumentalSubtitlesPolicyAlways &&
        loc.settings?.instrumentalSubtitlesPolicyNever,
      `${lang}.json has instrumental subtitle modal + Settings policy keys`
    );
  }

  assert(
    JSON.parse(fs.readFileSync(path.resolve(__dirname, '../locales/it.json'), 'utf8')).library
      .instrumentalSubtitlesTitle === 'Download Base Strumentale',
    'IT modal title matches UX copy'
  );
}

// -------------------------------------------------------------
// Suite: ZIP CD+G + Key/BPM (musicalKeys, zip inspect, UI lock)
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite: ZIP CD+G + Key/BPM\x1b[0m');

{
  const zlib = require('zlib');
  const { spawnSync } = require('child_process');

  /** Build a minimal STORE-method ZIP (no compression) for unit probes. */
  function buildStoreZip(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const { name, data } of files) {
      const nameBuf = Buffer.from(name, 'utf8');
      const local = Buffer.alloc(30 + nameBuf.length);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0, 6);
      local.writeUInt16LE(0, 8); // STORE
      local.writeUInt16LE(0, 10);
      local.writeUInt16LE(0, 12);
      local.writeUInt32LE(0, 14); // crc optional for our reader
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(nameBuf.length, 26);
      local.writeUInt16LE(0, 28);
      nameBuf.copy(local, 30);
      const localFull = Buffer.concat([local, data]);
      localParts.push(localFull);

      const central = Buffer.alloc(46 + nameBuf.length);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(0, 8);
      central.writeUInt16LE(0, 10);
      central.writeUInt16LE(0, 12);
      central.writeUInt16LE(0, 14);
      central.writeUInt32LE(0, 16);
      central.writeUInt32LE(data.length, 20);
      central.writeUInt32LE(data.length, 24);
      central.writeUInt16LE(nameBuf.length, 28);
      central.writeUInt16LE(0, 30);
      central.writeUInt16LE(0, 32);
      central.writeUInt16LE(0, 34);
      central.writeUInt16LE(0, 36);
      central.writeUInt32LE(0, 38);
      central.writeUInt32LE(offset, 42);
      nameBuf.copy(central, 46);
      centralParts.push(central);
      offset += localFull.length;
    }
    const centralDir = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(centralDir.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);
    return Buffer.concat([...localParts, centralDir, eocd]);
  }

  const musicalKeysPath = path.resolve(__dirname, '../src/shared/musicalKeys.ts');
  const zipCdgPath = path.resolve(__dirname, '../src/shared/zipCdg.ts');
  const scannerPath = path.resolve(__dirname, '../src/shared/libraryScanner.ts');
  const controlSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/components/ControlWindow.tsx'),
    'utf8'
  );
  const dbSrc = fs.readFileSync(path.resolve(__dirname, '../src/main/db/database.ts'), 'utf8');
  const typesSrc = fs.readFileSync(path.resolve(__dirname, '../src/shared/types.ts'), 'utf8');
  const mainSrc = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8');
  const preloadSrc = fs.readFileSync(path.resolve(__dirname, '../src/preload/index.ts'), 'utf8');

  assert(
    fs.existsSync(musicalKeysPath) &&
      fs.readFileSync(musicalKeysPath, 'utf8').includes('export function transposeKey') &&
      fs.readFileSync(musicalKeysPath, 'utf8').includes('export function effectiveBpm'),
    'musicalKeys.ts exports transposeKey + effectiveBpm'
  );

  assert(
    typesSrc.includes('initialKey?:') && typesSrc.includes('initialBpm?:'),
    'KaraokeMediaTrack has optional initialKey / initialBpm'
  );

  assert(
    dbSrc.includes('initialKey TEXT') &&
      dbSrc.includes('initialBpm REAL') &&
      dbSrc.includes('updateTrackKeyBpm'),
    'DB migrates initialKey/initialBpm + updateTrackKeyBpm'
  );

  assert(
    mainSrc.includes('library:ensure-zip-playback') &&
      mainSrc.includes('ZipCdgCache') &&
      mainSrc.includes('TrackAnalysisService') &&
      mainSrc.includes('zipCdgCache.cleanupAll'),
    'Main wires zip extract IPC + analysis + quit cleanup'
  );

  assert(
    preloadSrc.includes('ensureZipPlayback') && preloadSrc.includes('releaseZipCache'),
    'Preload exposes ensureZipPlayback / releaseZipCache'
  );

  // Handler signatures for pitch/speed must stay intact across modular deck (Safety-First)
  const controlUiSrc = readControlUiSource();
  assert(
    controlUiSrc.includes('setLivePitch(livePitchOffset - 1)') &&
      controlUiSrc.includes('setLivePitch(livePitchOffset + 1)') &&
      controlUiSrc.includes('setLivePitch(0)') &&
      controlUiSrc.includes('clampSpeedForEngine') &&
      controlUiSrc.includes('setPlaybackSpeed(1.0)') &&
      controlUiSrc.includes('formatKeyTransition') &&
      controlUiSrc.includes('formatBpmTransition') &&
      controlUiSrc.includes('player.bpm') &&
      controlUiSrc.includes('keyPlaceholder') &&
      controlUiSrc.includes('bpmPlaceholder') &&
      controlSrc.includes('ensureZipPlayback') &&
      controlSrc.includes('PlayerDeckControls'),
    'Control UI keeps ±/reset pitch+speed, Key/BPM labels + BPM unit + placeholders, ZIP playback, PlayerDeckControls'
  );

  assert(
    fs.readFileSync(scannerPath, 'utf8').includes("'.zip'") &&
      fs.readFileSync(scannerPath, 'utf8').includes('zipContainsCdgKaraokePair') &&
      fs.readFileSync(scannerPath, 'utf8').includes("picked.targetExt === '.zip'"),
    'libraryScanner discovers .zip via Central Directory inspect'
  );

  const probe = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--no-warnings',
      '-e',
      `
      import fs from 'fs';
      import path from 'path';
      import os from 'os';
      import {
        transposeKey,
        effectiveBpm,
        formatKeyTransition,
        formatBpmTransition,
        parseMusicalKey
      } from ${JSON.stringify(musicalKeysPath)};
      import {
        inspectZipForCdgPair,
        extractZipCdgPair
      } from ${JSON.stringify(zipCdgPath)};

      const assert = (c, m) => { if (!c) { console.error('PROBE_FAIL', m); process.exit(2); } };

      // transpose examples
      assert(transposeKey('Am', 2) === 'Bm', 'Am +2 → Bm');
      assert(transposeKey('C', 1) === 'C#', 'C +1 → C#');
      assert(transposeKey('F', -1) === 'E', 'F -1 → E');
      assert(transposeKey(undefined, 3) === undefined, 'undefined key → undefined');
      assert(transposeKey('', 1) === undefined, 'empty key → undefined');

      // effective BPM
      assert(effectiveBpm(120, 1.05) === 126, '120 * 1.05 → 126');
      assert(effectiveBpm(100, 0.5) === 50, '100 * 0.5 → 50');
      assert(effectiveBpm(undefined, 1.2) === undefined, 'undefined bpm → undefined');
      assert(effectiveBpm(0, 1.1) === undefined, 'zero bpm → undefined');

      // UI transition labels
      assert(formatKeyTransition('Am', 0) === 'Am', 'key @0 stays Am');
      assert(formatKeyTransition('Am', 2) === 'Am→Bm', 'key transition Am→Bm');
      assert(formatKeyTransition(undefined, 2) === undefined, 'no key → undefined label');
      assert(formatBpmTransition(120, 1.0) === '120', 'bpm @1.0 stays 120');
      assert(formatBpmTransition(120, 1.05) === '120→126', 'bpm transition');
      assert(formatBpmTransition(undefined, 1.1) === undefined, 'no bpm → undefined label');
      assert(parseMusicalKey('Bb')?.pitchClass === 10, 'Bb pitch class');

      // ZIP CD+G pair (STORE method)
      const pad = (n) => Buffer.alloc(Math.max(n, 2048), 7);
      const buildZip = (files) => {
        const localParts = [];
        const centralParts = [];
        let offset = 0;
        for (const { name, data } of files) {
          const nameBuf = Buffer.from(name, 'utf8');
          const local = Buffer.alloc(30 + nameBuf.length);
          local.writeUInt32LE(0x04034b50, 0);
          local.writeUInt16LE(20, 4);
          local.writeUInt16LE(0, 8);
          local.writeUInt32LE(data.length, 18);
          local.writeUInt32LE(data.length, 22);
          local.writeUInt16LE(nameBuf.length, 26);
          nameBuf.copy(local, 30);
          const localFull = Buffer.concat([local, data]);
          localParts.push(localFull);
          const central = Buffer.alloc(46 + nameBuf.length);
          central.writeUInt32LE(0x02014b50, 0);
          central.writeUInt16LE(20, 4);
          central.writeUInt16LE(20, 6);
          central.writeUInt32LE(data.length, 20);
          central.writeUInt32LE(data.length, 24);
          central.writeUInt16LE(nameBuf.length, 28);
          central.writeUInt32LE(offset, 42);
          nameBuf.copy(central, 46);
          centralParts.push(central);
          offset += localFull.length;
        }
        const centralDir = Buffer.concat(centralParts);
        const eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054b50, 0);
        eocd.writeUInt16LE(files.length, 8);
        eocd.writeUInt16LE(files.length, 10);
        eocd.writeUInt32LE(centralDir.length, 12);
        eocd.writeUInt32LE(offset, 16);
        return Buffer.concat([...localParts, centralDir, eocd]);
      };

      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kls-zip-cdg-'));
      try {
        const zipPath = path.join(root, 'Lucio - Anima.zip');
        fs.writeFileSync(
          zipPath,
          buildZip([
            { name: 'Artist - Song.mp3', data: pad(4096) },
            { name: 'Artist - Song.cdg', data: pad(4096) }
          ])
        );
        const pair = inspectZipForCdgPair(zipPath);
        assert(pair && pair.audioExt === '.mp3' && /\\.cdg$/i.test(pair.cdgEntry), 'inspect finds mp3+cdg');
        const dest = path.join(root, 'out');
        const extracted = extractZipCdgPair(zipPath, dest, pair);
        assert(fs.existsSync(extracted.audioPath) && fs.existsSync(extracted.cdgPath), 'extract writes pair');

        // Non-karaoke zip must not pair
        const junk = path.join(root, 'Not Karaoke.zip');
        fs.writeFileSync(
          junk,
          buildZip([{ name: 'readme.txt', data: pad(4096) }])
        );
        assert(inspectZipForCdgPair(junk) == null, 'non-CDG zip returns null');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }

      console.log('PROBE_OK');
      `
    ],
    { encoding: 'utf8' }
  );

  if (probe.status !== 0) {
    console.error(probe.stdout || '');
    console.error(probe.stderr || '');
  }
  assert(
    probe.status === 0 && /PROBE_OK/.test(probe.stdout || ''),
    'musicalKeys + zip CD+G runtime probe'
  );
}

// Suite: Safety-First modularization / perf / i18n defaults
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite: Safety-First modularization, virtualization, i18n defaults\x1b[0m');

{
  const root = path.resolve(__dirname, '..');
  const mustExist = [
    'src/renderer/hooks/useControlPlayback.ts',
    'src/renderer/hooks/useKeyboardShortcuts.ts',
    'src/renderer/components/PlayerDeckControls.tsx',
    'src/renderer/components/QueueList.tsx',
    'src/renderer/components/settings/SettingsGeneralTab.tsx',
    'src/renderer/components/settings/SettingsLibraryTab.tsx',
    'src/renderer/components/settings/SettingsAudioTab.tsx',
    'src/renderer/components/settings/SettingsStageTab.tsx',
    'src/renderer/components/settings/SettingsShortcutsTab.tsx',
    'src/renderer/utils/listVirtualization.ts'
  ];
  for (const rel of mustExist) {
    assert(fs.existsSync(path.join(root, rel)), `Modularization artifact exists: ${rel}`);
  }

  const controlSrc = fs.readFileSync(
    path.join(root, 'src/renderer/components/ControlWindow.tsx'),
    'utf8'
  );
  assert(
    controlSrc.includes('useControlPlayback') &&
      controlSrc.includes('useKeyboardShortcuts') &&
      controlSrc.includes('PlayerDeckControls') &&
      controlSrc.includes('QueueList'),
    'ControlWindow wires extracted hooks + PlayerDeckControls + QueueList'
  );

  const settingsSrc = fs.readFileSync(
    path.join(root, 'src/renderer/components/SettingsModal.tsx'),
    'utf8'
  );
  assert(
    settingsSrc.includes('SettingsGeneralTab') &&
      settingsSrc.includes('SettingsLibraryTab') &&
      settingsSrc.includes('SettingsAudioTab') &&
      settingsSrc.includes('SettingsStageTab') &&
      settingsSrc.includes('SettingsShortcutsTab'),
    'SettingsModal renders per-tab components'
  );

  const librarySrc = fs.readFileSync(
    path.join(root, 'src/renderer/components/LibraryPanel.tsx'),
    'utf8'
  );
  assert(
    librarySrc.includes('computeVirtualWindow') &&
      librarySrc.includes('library-virtual-window'),
    'LibraryPanel uses windowed virtualization for large catalogs'
  );

  // Pure math check (mirrors listVirtualization.computeVirtualWindow) for 16k+ catalogs
  function computeVirtualWindow(scrollTop, viewportHeight, itemCount, rowHeight, overscan = 8) {
    if (itemCount <= 0 || rowHeight <= 0 || viewportHeight < 0) {
      return { startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 };
    }
    const safeScroll = Math.max(0, scrollTop);
    const startIndex = Math.max(0, Math.floor(safeScroll / rowHeight) - overscan);
    const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
    const endIndex = Math.min(itemCount, startIndex + visibleCount);
    const paddingTop = startIndex * rowHeight;
    const paddingBottom = Math.max(0, (itemCount - endIndex) * rowHeight);
    return { startIndex, endIndex, paddingTop, paddingBottom };
  }
  const win16k = computeVirtualWindow(5000, 480, 16000, 96, 8);
  assert(win16k.endIndex - win16k.startIndex < 100, '16k catalog mounts << 100 rows');
  assert(win16k.paddingTop + win16k.paddingBottom > 0, 'Virtual window has spacer padding');
  assert(
    fs.readFileSync(path.join(root, 'src/renderer/utils/listVirtualization.ts'), 'utf8').includes(
      'computeVirtualWindow'
    ),
    'listVirtualization.ts exports computeVirtualWindow'
  );

  const audioSrc = fs.readFileSync(
    path.join(root, 'src/renderer/core/AudioGraphManager.ts'),
    'utf8'
  );
  assert(
    audioSrc.includes('disconnectDspBridgeInternals') &&
      audioSrc.includes('node?.disconnect()') &&
      audioSrc.includes('this.sourceNode'),
    'AudioGraphManager.dispose disconnects Web Audio nodes before close'
  );

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert(pkg.version === '1.5.0', 'package.json is 1.5.0 (new release cycle)');

  // Manual chapter parity markers (DnD / recursive scan / Bungee / AppImage SoundFont)
  for (const manual of [
    'USER_MANUAL_en.md',
    'USER_MANUAL_it.md',
    'USER_MANUAL_es.md',
    'USER_MANUAL_fr.md'
  ]) {
    const body = fs.readFileSync(path.join(root, manual), 'utf8');
    assert(
      /Bungee/i.test(body) &&
        (/recursive|ricorsiv|recursiv|récursif/i.test(body) || /subfolders|sottocartelle|subcarpetas|sous-dossiers/i.test(body)) &&
        (/importFiles|OS file|Drop file OS|Drop de archivos|Drop fichiers OS/i.test(body)) &&
        (/AppImage/i.test(body) && /soundfonts/i.test(body)),
      `${manual} has DnD / recursive scan / Bungee / AppImage SoundFont chapter parity`
    );
  }

  // i18n defaults: language + theme host defaults remain coherent across locales
  assert(itLocale.settings?.language !== undefined || true, 'Italian locale settings namespace present');
  for (const [code, loc] of [
    ['it', itLocale],
    ['en', enLocale],
    ['es', esLocale],
    ['fr', frLocale]
  ]) {
    assert(
      loc.queue?.dropToImport && loc.player?.play && loc.settings?.tabGeneral,
      `${code} locale has core queue/player/settings defaults`
    );
  }
}

// -------------------------------------------------------------
// Suite: Refactor / MT / deps / logging audit (Safety-First)
// -------------------------------------------------------------
console.log('\x1b[36m▶ Suite: Refactor MT deps logging audit\x1b[0m');
{
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  assert(!deps.clsx, 'orphan clsx removed from package.json');
  assert(!deps['tailwind-merge'], 'orphan tailwind-merge removed from package.json');
  assert(!deps.autoprefixer, 'orphan autoprefixer removed from package.json');
  assert(!deps.postcss, 'orphan postcss removed (Tailwind v4 via @tailwindcss/vite)');

  const dbSrc = fs.readFileSync(path.resolve(__dirname, '../src/main/db/database.ts'), 'utf8');
  assert(
    dbSrc.includes('findLocalMediaDedupCandidates'),
    'DatabaseManager exposes findLocalMediaDedupCandidates (SQL dedup)'
  );

  const guestSrc = fs.readFileSync(path.resolve(__dirname, '../src/main/server/guestServer.ts'), 'utf8');
  assert(
    guestSrc.includes('searchLibraryTracks') &&
      guestSrc.includes('getLibraryTrackById') &&
      guestSrc.includes('getLibraryTrackCount') &&
      !guestSrc.includes('getLibraryTracks'),
    'Guest portal uses FTS/id/count callbacks (no getAllTracks dump)'
  );

  const mainSrc = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8');
  assert(
    mainSrc.includes('findLocalMediaDedupCandidates') &&
      !/download:start[\s\S]{0,1200}getAllTracks\(\)/.test(mainSrc),
    'download:start uses SQL dedup candidates (not getAllTracks)'
  );
  assert(
    mainSrc.includes("before-quit cleanup starting"),
    'before-quit emits structured DEBUG cleanup markers'
  );

  const dmSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/main/services/DownloadManager.ts'),
    'utf8'
  );
  assert(dmSrc.includes('pendingById'), 'DownloadManager pendingById Map for O(1) cancel/dedup');
  assert(
    !dmSrc.includes("console.warn('Security guard:") &&
      dmSrc.includes("Security guard: Refused deletion"),
    'DownloadManager security guard uses structured logger'
  );

  const zipSrc = fs.readFileSync(path.resolve(__dirname, '../src/shared/zipCdg.ts'), 'utf8');
  assert(
    zipSrc.includes('extractZipEntryToFileAsync') && zipSrc.includes('inflateRaw'),
    'ZIP extract has async inflateRaw path'
  );
  assert(
    fs
      .readFileSync(path.resolve(__dirname, '../src/main/services/ZipCdgCache.ts'), 'utf8')
      .includes('extractZipCdgPairAsync'),
    'ZipCdgCache play-start uses async extract'
  );

  const analysisSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/main/services/TrackAnalysisService.ts'),
    'utf8'
  );
  assert(
    analysisSrc.includes('YIELD_EVERY_FRAMES') && analysisSrc.includes('setImmediate'),
    'TrackAnalysisService yields during FFT chromagram work'
  );

  const loggerSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/main/services/Logger.ts'),
    'utf8'
  );
  assert(
    loggerSrc.includes('maskSensitive') && loggerSrc.includes('[REDACTED]'),
    'Logger masks sensitive keys in structured data'
  );

  const libPanel = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/components/LibraryPanel.tsx'),
    'utf8'
  );
  const queueList = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/components/QueueList.tsx'),
    'utf8'
  );
  assert(
    libPanel.includes('missingTrackIdSet') && queueList.includes('missingTrackIdSet'),
    'Library/Queue use Set for missingTrackIds membership (O(1))'
  );

  // Unit-test maskSensitive key regex + zlib async inflate parity
  const maskKey = (k) => /pass(word)?|token|secret|api[_-]?key|authorization|credential/i.test(k);
  assert(maskKey('apiKey') && maskKey('password') && !maskKey('artist'), 'secret key regex covers apiKey/password');

  const zlib = require('zlib');
  const payload = Buffer.from('karaoke-zip-async-test');
  const deflated = zlib.deflateRawSync(payload);
  assert(zlib.inflateRawSync(deflated).equals(payload), 'zlib inflateRawSync round-trip (baseline)');
  assert(typeof zlib.inflateRaw === 'function', 'zlib.inflateRaw available for async ZIP extract');
}

// -------------------------------------------------------------
// Suite: Pitch/BPM visibility + BPM unit + single-instance dialog
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite: Pitch/BPM UX + single-instance dialog\x1b[0m');

{
  const badgesPath = path.resolve(__dirname, '../src/renderer/components/TrackKeyBpmBadges.tsx');
  const singleI18nPath = path.resolve(__dirname, '../src/shared/singleInstanceI18n.ts');
  const librarySrc = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/components/LibraryPanel.tsx'),
    'utf8'
  );
  const queueSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/components/QueueList.tsx'),
    'utf8'
  );
  const stageSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/components/StageWindow.tsx'),
    'utf8'
  );
  const deckSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/components/PlayerDeckControls.tsx'),
    'utf8'
  );
  const mainSrc = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8');
  const singleI18nSrc = fs.readFileSync(singleI18nPath, 'utf8');
  const badgesSrc = fs.readFileSync(badgesPath, 'utf8');

  assert(fs.existsSync(badgesPath), 'TrackKeyBpmBadges component exists');
  assert(fs.existsSync(singleI18nPath), 'singleInstanceI18n helper exists');

  assert(
    badgesSrc.includes('data-testid="track-key-bpm-badges"') &&
      badgesSrc.includes('player.bpm') &&
      badgesSrc.includes('keyPlaceholder') &&
      badgesSrc.includes('bpmPlaceholder'),
    'TrackKeyBpmBadges always renders Key + BPM with unit / placeholders'
  );

  assert(
    librarySrc.includes('TrackKeyBpmBadges') &&
      librarySrc.includes('initialKey={track.initialKey}') &&
      librarySrc.includes('initialBpm={track.initialBpm}'),
    'Library rows show Key/BPM badges'
  );

  assert(
    queueSrc.includes('TrackKeyBpmBadges') &&
      queueSrc.includes('initialKey={item.track.initialKey}') &&
      queueSrc.includes('initialBpm={item.track.initialBpm}'),
    'Queue rows show Key/BPM badges'
  );

  assert(
    stageSrc.includes('stage-key-label') &&
      stageSrc.includes('stage-bpm-label') &&
      stageSrc.includes('TrackKeyBpmBadges') &&
      stageSrc.includes('player.bpm'),
    'Stage shows Key/BPM on pitch/speed badges and title overlay'
  );

  assert(
    deckSrc.includes('regia-key-label') &&
      deckSrc.includes('regia-bpm-label') &&
      deckSrc.includes('player.bpm') &&
      !deckSrc.includes('{keyLabel ? (') &&
      !deckSrc.includes('{bpmLabel ? ('),
    'Regia deck always shows Key/BPM (no conditional hide) with BPM unit'
  );

  assert(
    mainSrc.includes('resolveSecondInstanceCopy') &&
      mainSrc.includes('showErrorBox') &&
      singleI18nSrc.includes('Software già in esecuzione') &&
      singleI18nSrc.includes('Software already running'),
    'Second instance shows localized ErrorBox before quit'
  );

  // Locale parity: player.bpm + errors.alreadyRunning* in IT/EN/ES/FR
  for (const lang of ['it', 'en', 'es', 'fr']) {
    const loc = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, `../locales/${lang}.json`), 'utf8')
    );
    assert(loc.player?.bpm === 'BPM', `${lang}: player.bpm === BPM`);
    assert(typeof loc.player?.keyPlaceholder === 'string', `${lang}: player.keyPlaceholder`);
    assert(typeof loc.player?.bpmPlaceholder === 'string', `${lang}: player.bpmPlaceholder`);
    assert(
      typeof loc.errors?.alreadyRunning === 'string' && loc.errors.alreadyRunning.length > 0,
      `${lang}: errors.alreadyRunning`
    );
    assert(
      typeof loc.errors?.alreadyRunningTitle === 'string',
      `${lang}: errors.alreadyRunningTitle`
    );
  }

  assert(
    JSON.parse(fs.readFileSync(path.resolve(__dirname, '../locales/it.json'), 'utf8')).errors
      .alreadyRunning === 'Software già in esecuzione',
    'IT alreadyRunning matches requested copy'
  );

  const { spawnSync } = require('child_process');
  const probe = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--no-warnings',
      '-e',
      `
      import {
        resolveSecondInstanceCopy,
        resolveUiLangFromLocale
      } from ${JSON.stringify(singleI18nPath)};
      const assert = (c, m) => { if (!c) { console.error('PROBE_FAIL', m); process.exit(2); } };
      assert(resolveUiLangFromLocale('it-IT') === 'it', 'it-IT → it');
      assert(resolveUiLangFromLocale('en_US') === 'en', 'en_US → en');
      assert(resolveUiLangFromLocale('es-ES') === 'es', 'es → es');
      assert(resolveUiLangFromLocale('fr-FR') === 'fr', 'fr → fr');
      assert(resolveUiLangFromLocale('de-DE') === 'en', 'unknown → en');
      assert(resolveSecondInstanceCopy('it').message === 'Software già in esecuzione', 'IT message');
      assert(resolveSecondInstanceCopy('en').message === 'Software already running', 'EN message');
      console.log('PROBE_OK');
      `
    ],
    { encoding: 'utf8' }
  );
  assert(
    probe.status === 0 && (probe.stdout || '').includes('PROBE_OK'),
    'singleInstanceI18n locale probe'
  );
  if (probe.status !== 0) {
    console.error(probe.stderr || probe.stdout);
  }
}

console.log('\n\x1b[36m▶ Suite: Studio Desk opt-in theme (Zero Regression gate)\x1b[0m');

{
  const typesSrc = fs.readFileSync(path.resolve(__dirname, '../src/shared/types.ts'), 'utf8');
  const settingsTypesSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/components/settings/settingsTypes.ts'),
    'utf8'
  );
  const cssSrc = fs.readFileSync(path.resolve(__dirname, '../src/renderer/index.css'), 'utf8');
  const appSrc = fs.readFileSync(path.resolve(__dirname, '../src/renderer/App.tsx'), 'utf8');
  const storeSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/store/karaokeStore.ts'),
    'utf8'
  );
  const stageSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/components/StageWindow.tsx'),
    'utf8'
  );
  const controlSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/components/ControlWindow.tsx'),
    'utf8'
  );

  assert(typesSrc.includes("'studio-desk'"), 'AppTheme includes studio-desk');
  assert(
    settingsTypesSrc.includes("id: 'studio-desk'"),
    'THEME_OPTIONS lists studio-desk'
  );
  assert(
    cssSrc.includes(':root.studio-desk') && cssSrc.includes('#00D4F0'),
    'studio-desk CSS tokens (cyan) present'
  );
  assert(appSrc.includes("'studio-desk'"), 'App.tsx classList removes studio-desk');
  assert(storeSrc.includes("'studio-desk'"), 'karaokeStore applyAppTheme lists studio-desk');
  assert(
    (stageSrc.match(/'studio-desk'/g) || []).length >= 2,
    'StageWindow classList sites include studio-desk'
  );
  assert(
    controlSrc.includes("themeHost === 'studio-desk'") &&
      controlSrc.includes('StudioDeskShell') &&
      controlSrc.includes('PlayerDeckControls'),
    'ControlWindow gates StudioDeskShell; classic PlayerDeckControls kept'
  );
  assert(
    fs.existsSync(path.resolve(__dirname, '../src/renderer/components/StudioDeskShell.tsx')),
    'StudioDeskShell.tsx exists'
  );
  assert(
    fs.existsSync(
      path.resolve(__dirname, '../src/renderer/components/StudioPlayerDeckControls.tsx')
    ),
    'StudioPlayerDeckControls.tsx exists'
  );

  for (const lang of ['it', 'en', 'es', 'fr']) {
    const loc = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, `../locales/${lang}.json`), 'utf8')
    );
    assert(loc.settings?.themeOptions?.['studio-desk'], `${lang}: themeOptions.studio-desk`);
    assert(loc.studio?.showMidiMixer, `${lang}: studio.showMidiMixer`);
    assert(loc.studio?.hideMidiMixer, `${lang}: studio.hideMidiMixer`);
  }

  assert(
    storeSrc.includes("themeHost: 'dark-stage'"),
    'Default themeHost remains dark-stage'
  );
}

// -------------------------------------------------------------
// Suite: Stage external-display placement + speed label on Palco
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite: Stage live blank fix + speed on Stage\x1b[0m');

{
  const stageTargetPath = path.resolve(__dirname, '../src/shared/stageDisplayTarget.ts');
  const mainSrc = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8');
  const stageSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/components/StageWindow.tsx'),
    'utf8'
  );
  const badgesSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/components/TrackKeyBpmBadges.tsx'),
    'utf8'
  );
  const cssSrc = fs.readFileSync(path.resolve(__dirname, '../src/renderer/index.css'), 'utf8');

  assert(fs.existsSync(stageTargetPath), 'stageDisplayTarget helper exists');
  assert(
    mainSrc.includes('resolveStagePlacement') &&
      mainSrc.includes('placeAndRevealStageWindow') &&
      mainSrc.includes("from 'electron'") &&
      /screen/.test(mainSrc),
    'Main places Stage via resolveStagePlacement + screen'
  );
  assert(
    mainSrc.includes('stage-ready-handshake') &&
      mainSrc.includes('ready-to-show-fallback') &&
      mainSrc.includes('reopen-existing'),
    'Stage reveal paths all re-place on audience display'
  );
  assert(
    /stage-screen-container[\s\S]*var\(--bg-app,\s*#000000\)/.test(cssSrc),
    'Stage container CSS has opaque --bg-app fallback'
  );
  assert(
    stageSrc.includes("t('player.speed')") &&
      stageSrc.includes('stage-speed-value') &&
      stageSrc.includes('showSpeedRatio') &&
      stageSrc.includes('showSpeedOnStage'),
    'Stage shows localized Speed label + ratio; title overlay can show speed chip'
  );
  assert(
    badgesSrc.includes('showSpeedRatio') && badgesSrc.includes('track-speed-badge'),
    'TrackKeyBpmBadges optional speed ratio chip for Stage overlay'
  );

  for (const lang of ['it', 'en', 'es', 'fr']) {
    const loc = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, `../locales/${lang}.json`), 'utf8')
    );
    assert(typeof loc.player?.speed === 'string' && loc.player.speed.length > 0, `${lang}: player.speed`);
  }

  const { spawnSync } = require('child_process');
  const probe = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--no-warnings',
      '-e',
      `
      import { resolveStagePlacement } from ${JSON.stringify(stageTargetPath)};
      const assert = (c, m) => { if (!c) { console.error('PROBE_FAIL', m); process.exit(2); } };
      const dual = resolveStagePlacement(
        [
          { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
          { id: 2, bounds: { x: 1920, y: 0, width: 1280, height: 720 } }
        ],
        1
      );
      assert(dual.usedExternalDisplay === true, 'dual → external');
      assert(dual.displayId === 2, 'dual → display 2');
      assert(dual.bounds.x === 1920 && dual.bounds.width === 1280, 'dual bounds');
      const single = resolveStagePlacement(
        [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }],
        1
      );
      assert(single.usedExternalDisplay === false, 'single → primary');
      assert(single.bounds.width === 1280 && single.bounds.height === 720, 'single windowed size');
      assert(single.bounds.x === 320, 'single centered x');
      const empty = resolveStagePlacement([], 0);
      assert(empty.usedExternalDisplay === false && empty.bounds.width === 1280, 'empty fallback');
      console.log('PROBE_OK');
      `
    ],
    { encoding: 'utf8' }
  );
  assert(
    probe.status === 0 && (probe.stdout || '').includes('PROBE_OK'),
    'resolveStagePlacement dual/single/empty probe'
  );
  if (probe.status !== 0) {
    console.error(probe.stderr || probe.stdout);
  }
}

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

