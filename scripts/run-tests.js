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
const controlSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/ControlWindow.tsx'),
  'utf8'
);
const settingsModalSourceVocal = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/SettingsModal.tsx'),
  'utf8'
);
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
      .readFileSync(path.resolve(__dirname, '../src/main/workers/instrumentalAiWorker.ts'), 'utf8')
      .includes('wasmBinary') &&
    fs
      .readFileSync(path.resolve(__dirname, '../src/main/workers/instrumentalAiWorker.ts'), 'utf8')
      .includes('toArrayBuffer') &&
    fs
      .readFileSync(path.resolve(__dirname, '../src/main/workers/instrumentalAiWorker.ts'), 'utf8')
      .includes('ortBackend') &&
    fs
      .readFileSync(path.resolve(__dirname, '../src/main/workers/instrumentalAiWorker.ts'), 'utf8')
      .includes('unwrapAiWorkerInboundMessage') &&
    fs
      .readFileSync(path.resolve(__dirname, '../src/main/workers/instrumentalAiWorker.ts'), 'utf8')
      .includes("await import('demucs-web')") &&
    fs.existsSync(path.resolve(__dirname, '../src/main/workers/aiWorkerMessage.ts')) &&
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
const controlWindowSourceP45 = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/ControlWindow.tsx'),
  'utf8'
);
const settingsModalSourceP45 = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/SettingsModal.tsx'),
  'utf8'
);
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
    libraryPanelSourceP45.includes('Client-side safety net'),
  'LibraryPanel refuses temp/partial downloads as finished library rows and dedupes on refresh'
);

const mainScanSource = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8');
const libraryScannerSourceDedupe = fs.readFileSync(
  path.resolve(__dirname, '../src/shared/libraryScanner.ts'),
  'utf8'
);
const databaseSourceDedupe = fs.readFileSync(path.resolve(__dirname, '../src/main/db/database.ts'), 'utf8');
assert(
  mainScanSource.includes('discoverLibraryMedia') &&
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
    mainIndexSourceP45.includes('second-instance'),
  'Single-instance lock still enforced'
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
const settingsStageMsgSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/SettingsModal.tsx'),
  'utf8'
);
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
      mainIndexSource.includes('discoverLibraryMedia'),
    'Main scanFolder uses shared discoverLibraryMedia (recursive)'
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
    /private scanFolder\(folderPath: string\): KaraokeMediaTrack\[\] \{[\s\S]*?\n  \}/
  );
  assert(Boolean(scanFolderFn), 'scanFolder method body is locatable for latency contracts');
  const scanBody = scanFolderFn ? scanFolderFn[0] : '';
  assert(
    scanBody.includes('upsertTracksBatch') &&
      scanBody.includes('peekCachedThumbnail') &&
      scanBody.includes('enqueueThumbnailBackfill') &&
      !scanBody.includes('getOrGenerateThumbnail') &&
      !/upsertTrack\(/.test(scanBody),
    'scanFolder batch-upserts, peeks cache only, enqueues async thumbs (no sync FFmpeg / per-track upsert)'
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
const settingsBgSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/components/SettingsModal.tsx'),
  'utf8'
);
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
    fs.readFileSync(path.resolve(__dirname, '../src/renderer/components/ControlWindow.tsx'), 'utf8').includes('appShortcuts.ts'),
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
    guestServerSourceAccent.includes('textMatchesSearch') &&
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
    downloadStagingSource.includes("YTDLP_INSTRUMENTAL_SUB_LANGS = 'all,-live_chat'"),
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
    !downloadManagerStagingSrc.includes("'en.*,it.*,es.*,fr.*,*-orig'") &&
    !/['"][^'"]*\*-orig[^'"]*['"]/.test(downloadManagerStagingSrc) &&
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
        YTDLP_INSTRUMENTAL_SUB_LANGS
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
      assert(YTDLP_INSTRUMENTAL_SUB_LANGS === 'all,-live_chat', 'sub-langs-documented');
      assert(!YTDLP_INSTRUMENTAL_SUB_LANGS.includes('*-orig'), 'no-star-orig-glob');
      assert(
        !YTDLP_INSTRUMENTAL_SUB_LANGS.split(',').some((t) => t === '*' || t.startsWith('*')),
        'no-leading-star-token'
      );
      // Each comma-separated token must compile as a JS RegExp (same constraint as yt-dlp/Python re).
      for (const token of YTDLP_INSTRUMENTAL_SUB_LANGS.split(',')) {
        const pat = token.startsWith('-') ? token.slice(1) : token;
        if (pat === 'all') continue;
        try { new RegExp(pat); } catch (e) {
          console.error('PROBE_FAIL', 'sub-langs-regex', pat, e && e.message);
          process.exit(2);
        }
      }
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
  const controlWindowSource = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/components/ControlWindow.tsx'),
    'utf8'
  );
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
      controlWindowSource.includes('addToQueue'),
    'ControlWindow queue OS drop → importFiles + addToQueue'
  );
  assert(
    /library:scan-folder/.test(mainIndexSource) &&
      preloadSource.includes("ipcRenderer.invoke('library:scan-folder'"),
    'Existing scanFolder IPC preserved alongside import-files'
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

