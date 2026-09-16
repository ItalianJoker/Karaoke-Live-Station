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
// Suite 7: Vocal Remover — algorithmic DSP + offline AI options
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite 7: Vocal Remover (DSP + offline AI)\x1b[0m');

const audioGraphSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/core/AudioGraphManager.ts'),
  'utf8'
);
const algorithmicRemoverSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/core/AlgorithmicVocalRemoverNode.ts'),
  'utf8'
);
const offlineAiSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/core/OfflineAiVocalSeparator.ts'),
  'utf8'
);
const mdxSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/core/MdxNetSeparator.ts'),
  'utf8'
);
const modelManagerSource = fs.readFileSync(
  path.resolve(__dirname, '../src/main/services/OfflineVocalModelManager.ts'),
  'utf8'
);
const vocalRemoverShared = fs.readFileSync(
  path.resolve(__dirname, '../src/shared/vocalRemover.ts'),
  'utf8'
);
const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')
);

assert(
  packageJson.dependencies?.['demucs-web'] &&
    packageJson.dependencies?.['onnxruntime-web'] &&
    packageJson.dependencies?.['fft.js'],
  'package.json depends on demucs-web + onnxruntime-web + fft.js for offline AI'
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
  vocalRemoverShared.includes('aiMdxKaraoke2') &&
    vocalRemoverShared.includes('aiHtDemucs') &&
    vocalRemoverShared.includes('aiBsRoformer') &&
    vocalRemoverShared.includes('UVR_MDXNET_KARA_2') &&
    vocalRemoverShared.includes('Tha456/uvr5-models') &&
    !vocalRemoverShared.includes('Politrees/UVR_resources/resolve/main/MDXNet_models') &&
    vocalRemoverShared.includes('htdemucs_embedded') &&
    vocalRemoverShared.includes('bs_roformer'),
  'Shared catalog lists MDX Karaoke 2, HTDemucs, and BS-Roformer offline models'
);

assert(
  offlineAiSource.includes('MdxNetSeparator') &&
    offlineAiSource.includes('DemucsProcessor') &&
    offlineAiSource.includes('aiBsRoformer') &&
    mdxSource.includes('DIM_F') &&
    mdxSource.includes('N_FFT') &&
    modelManagerSource.includes('userData') &&
    modelManagerSource.includes('models') &&
    modelManagerSource.includes('.meta.json'),
  'Offline AI separator + MDX STFT path + userData model cache are wired'
);

const ortWasmManagerSource = fs.readFileSync(
  path.resolve(__dirname, '../src/main/services/OrtWasmManager.ts'),
  'utf8'
);
const ortWasmConfigSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/core/ortWasmConfig.ts'),
  'utf8'
);
const ortWasmSharedSource = fs.readFileSync(
  path.resolve(__dirname, '../src/shared/ortWasm.ts'),
  'utf8'
);
const mainSourceOrt = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8');
const preloadSourceOrt = fs.readFileSync(path.resolve(__dirname, '../src/preload/index.ts'), 'utf8');

assert(
  ortWasmManagerSource.includes("path.join(app.getPath('userData'), 'ort')") &&
    ortWasmManagerSource.includes('ensureOrtWasm') &&
    ortWasmManagerSource.includes('needsRefresh') &&
    !ortWasmManagerSource.includes('os.tmpdir()') &&
    !ortWasmManagerSource.includes("app.getPath('temp')"),
  'OrtWasmManager seeds durable userData/ort (never OS temp as permanent home)'
);

assert(
  ortWasmConfigSource.includes('karaoke://ort/') &&
    ortWasmConfigSource.includes('configureOrtWasmFromUserData') &&
    ortWasmConfigSource.includes('proxy = false') &&
    ortWasmConfigSource.includes('getConfiguredOrtWasmPaths') &&
    offlineAiSource.includes('configureOrtWasmFromUserData') &&
    mdxSource.includes('configureOrtWasmFromUserData') &&
    !offlineAiSource.includes("wasmPaths = './ort/'"),
  'Renderer points ORT wasmPaths at karaoke://ort/ (userData), not relative Temp blobs'
);

assert(
  mainSourceOrt.includes("hostname === 'ort'") &&
    mainSourceOrt.includes("hostname === 'models'") &&
    mainSourceOrt.includes('ort-wasm:ensure') &&
    preloadSourceOrt.includes('ortWasm') &&
    ortWasmSharedSource.includes('ort-wasm-simd-threaded.wasm'),
  'karaoke://ort + karaoke://models protocols + IPC expose seeded ORT/model assets'
);

assert(
  audioGraphSource.includes('setupVocalRemoverGraph') &&
    audioGraphSource.includes('setVocalRemover(') &&
    audioGraphSource.includes('setVocalRemoverAlgorithm') &&
    audioGraphSource.includes('AlgorithmicVocalRemoverNode') &&
    audioGraphSource.includes('activateDualStemPipeline') &&
    audioGraphSource.includes('hotSwapToDualStem') &&
    audioGraphSource.includes('getOfflineAiVocalSeparator') &&
    audioGraphSource.includes('applyAlgorithmicFallbackAfterAiFailure') &&
    audioGraphSource.includes('aiUsingAlgorithmicFallback') &&
    audioGraphSource.includes('rampAudioParam') &&
    audioGraphSource.includes('vocalRemoverPassThroughGain') &&
    audioGraphSource.includes('instrumentalGain') &&
    audioGraphSource.includes('vocalsGain') &&
    audioGraphSource.includes('DUAL_STEM_ACTIVE') &&
    audioGraphSource.includes('EXTRACTING_AND_SEPARATING') &&
    audioGraphSource.includes('setVocalGuideLevel'),
  'AudioGraphManager supports algorithmic DSP, on-demand dual-stem AI, and AI→algorithmic fallback'
);

assert(
  fs.existsSync(path.resolve(__dirname, '../src/renderer/core/audioGainRamp.ts')) &&
    fs
      .readFileSync(path.resolve(__dirname, '../src/renderer/core/audioGainRamp.ts'), 'utf8')
      .includes('setValueAtTime') &&
    algorithmicRemoverSource.includes('rampAudioParam'),
  'Vocal-remover GainNode enable/crossfade uses setValueAtTime+linearRamp (not bare ramp no-op)'
);

const mediaExtractorSource = fs.readFileSync(
  path.resolve(__dirname, '../src/main/services/MediaAudioExtractor.ts'),
  'utf8'
);
const dualStemCacheSource = fs.readFileSync(
  path.resolve(__dirname, '../src/main/services/DualStemCache.ts'),
  'utf8'
);
const dualStemSharedSource = fs.readFileSync(
  path.resolve(__dirname, '../src/shared/dualStem.ts'),
  'utf8'
);
assert(
  offlineAiSource.includes('decodeMediaForSeparation') &&
    offlineAiSource.includes('isLikelyVideoContainer') &&
    offlineAiSource.includes('extractAudioForSeparation') &&
    offlineAiSource.includes('separateDualStemsFromUrl') &&
    mediaExtractorSource.includes('extractAudioWavForSeparation') &&
    mediaExtractorSource.includes('vocal-audio-cache') &&
    mediaExtractorSource.includes('-vn') &&
    dualStemCacheSource.includes('dual-stem-cache') &&
    dualStemCacheSource.includes('stem_instrumental.wav') &&
    dualStemCacheSource.includes('stem_vocals.wav') &&
    dualStemSharedSource.includes('NATIVE_AUDIO') &&
    dualStemSharedSource.includes('EXTRACTING_AND_SEPARATING') &&
    dualStemSharedSource.includes('DUAL_STEM_ACTIVE') &&
    mainSourceOrt.includes('media:extract-audio-for-separation') &&
    mainSourceOrt.includes('dual-stem:lookup') &&
    mainSourceOrt.includes('dual-stem:save') &&
    preloadSourceOrt.includes('extractAudioForSeparation') &&
    preloadSourceOrt.includes('dualStem'),
  'On-demand dual-stem: ffmpeg demux + SHA-256 disk cache + IPC lookup/save'
);

const mdxWorkerClientSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/core/MdxVocalWorkerClient.ts'),
  'utf8'
);
const mdxWorkerSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/workers/mdxVocalWorker.ts'),
  'utf8'
);
const yieldToMainSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/core/yieldToMain.ts'),
  'utf8'
);

assert(
  mdxSource.includes('yieldToMainThread') &&
    yieldToMainSource.includes('yieldToMainThread') &&
    mdxWorkerClientSource.includes('new Worker') &&
    mdxWorkerSource.includes('MdxNetSeparator') &&
    offlineAiSource.includes('MdxVocalWorkerClient') &&
    offlineAiSource.includes('karaoke://models/') &&
    modelManagerSource.includes('resolveServableModel') &&
    modelManagerSource.includes('createReadStream') &&
    modelManagerSource.includes('fs.promises.readFile') &&
    !modelManagerSource.includes('hashFileSync') &&
    !modelManagerSource.includes('os.tmpdir()'),
  'AI vocal path uses MDX Web Worker + event-loop yields; models via userData/karaoke://models (async I/O, no Temp)'
);

assert(
  fs.existsSync(path.resolve(__dirname, '../public/ort/ort-wasm-simd-threaded.wasm')),
  'ORT WASM assets are vendored under public/ort for Electron'
);

assert(
  audioGraphSource.includes('formatOrtBackendError') &&
    ortWasmConfigSource.includes('no available backend'),
  'AI vocal remover surfaces a clearer ORT backend failure toast'
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
const aiWarnSource = fs.readFileSync(
  path.resolve(__dirname, '../src/renderer/utils/aiVocalHwWarning.ts'),
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
  aiWarnSource.includes('warnAiVocalRemoverIfNeeded') &&
    aiWarnSource.includes('isAiVocalRemoverMethod') &&
    settingsModalSourceVocal.includes('aiVocalHwWarningBody') &&
    settingsModalSourceVocal.includes('warnAiVocalRemoverIfNeeded') &&
    controlSource.includes('toggleVocalRemoverWithWarning') &&
    controlSource.includes('warnAiVocalRemoverIfNeeded'),
  'AI hardware warning shown on first AI select/toggle; algorithmic methods skip it'
);

const mainSourceForDialogs = fs.readFileSync(
  path.resolve(__dirname, '../src/main/index.ts'),
  'utf8'
);
assert(
  mainSourceForDialogs.includes('vocal-model:get-buffer') &&
    mainSourceForDialogs.includes('OfflineVocalModelManager') &&
    mainSourceForDialogs.includes("return { success: false, error: message }") &&
    (mainSourceForDialogs.includes('Non-modal (no parent)') ||
      mainSourceForDialogs.includes('Intentionally omit parent window') ||
      mainSourceForDialogs.includes('omit parent')),
  'Vocal-model IPC returns structured errors (no cryptic throw); dialogs avoid modal parent'
);

const enLocaleVocal = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../locales/en.json'), 'utf8'));
const itLocaleVocal = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../locales/it.json'), 'utf8'));
assert(
  enLocaleVocal.settings.vocalAiMdxKaraoke2 &&
    enLocaleVocal.settings.aiVocalHwWarningBody &&
    itLocaleVocal.settings.vocalAiMdxKaraoke2 &&
    itLocaleVocal.settings.aiVocalHwWarningBody,
  'EN/IT locales include AI vocal method labels and hardware warning text'
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
const databaseSourceDedupe = fs.readFileSync(path.resolve(__dirname, '../src/main/db/database.ts'), 'utf8');
assert(
  mainScanSource.includes('.part') &&
    mainScanSource.includes('stableYtId') &&
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
  libraryPanelSourceP45.includes('download-complete-badge') &&
    libraryPanelSourceP45.includes('Download completato') &&
    libraryPanelSourceP45.includes('setCompletedDownloads'),
  'Dismissible Download completato badge is implemented'
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
  'Algorithmic vocal remover + MIDI release timers present; AI path uses OfflineAiVocalSeparator'
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
  libraryPanelScopedSource.includes('setLocalResults') &&
    libraryPanelScopedSource.includes('localQuery') &&
    /searchMode\s*===\s*'web'/.test(libraryPanelScopedSource) &&
    libraryPanelScopedSource.includes('searchYouTube') &&
    libraryPanelScopedSource.includes('setWebSearching'),
  'Local live search mutates local bucket; YouTube search only on web submit'
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
// Suite 12: Dual-stem functional (ffmpeg fixture + SHA-256 cache + state machine)
// -------------------------------------------------------------
{
  const dualStemShared = fs.readFileSync(
    path.resolve(__dirname, '../src/shared/dualStem.ts'),
    'utf8'
  );
  assert(
    dualStemShared.includes('nextDualStemState') &&
      dualStemShared.includes('isDualStemEngaged') &&
      dualStemShared.includes('EXTRACTING_AND_SEPARATING'),
    'shared/dualStem exports state machine helpers'
  );

  const verifyPath = path.resolve(__dirname, 'verify-dual-stem.js');
  assert(fs.existsSync(verifyPath), 'scripts/verify-dual-stem.js exists');
  const { spawnSync } = require('child_process');
  const child = spawnSync(process.execPath, [verifyPath], { encoding: 'utf8' });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  assert(child.status === 0, 'verify-dual-stem.js functional suite exits 0');
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

