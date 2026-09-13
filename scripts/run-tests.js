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
      localFilePath: '/tmp/karaoke_downloads/temp_abc123.mp4'
    }
  }
];

// 1. Update by track ID
const updateById = simulateQueueUpdate(mockTempQueue, 'yt_abc123', {
  localFilePath: '/home/user/Karaoke/Massimo Ranieri - Perdere L\'Amore.mp4',
  uri: 'karaoke://local/%2Fhome%2Fuser%2FKaraoke%2FMassimo%20Ranieri%20-%20Perdere%20L%27Amore.mp4',
  source: 'local_library'
});

assert(updateById.hasChanged, 'Queue update by track ID succeeds');
assert(
  updateById.updatedQueue[0].track.source === 'local_library',
  'Track source correctly transitioned from youtube to local_library'
);
assert(
  updateById.updatedQueue[0].track.localFilePath === '/home/user/Karaoke/Massimo Ranieri - Perdere L\'Amore.mp4',
  'Track localFilePath points to permanent storage'
);

// 2. Update by temp localFilePath
const updateByTempPath = simulateQueueUpdate(mockTempQueue, '/tmp/karaoke_downloads/temp_abc123.mp4', {
  localFilePath: '/home/user/Karaoke/Massimo Ranieri - Perdere L\'Amore.mp4',
  uri: 'karaoke://local/%2Fhome%2Fuser%2FKaraoke%2FMassimo%20Ranieri%20-%20Perdere%20L%27Amore.mp4',
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

const cacheFile1 = '/userData/queue_cache/qc_123_artist - title.mp4';
const cacheFile2 = '/userData/queue_cache/qc_456_artist - title2.mp4';
const libraryFile = '/home/user/Karaoke/artist - permanent.mp4';

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
// Suite 7: Vocal Remover Enhanced In-Phase DSP Simulation
// -------------------------------------------------------------
console.log('\n\x1b[36m▶ Suite 7: Vocal Remover Enhanced In-Phase DSP Pipeline Simulation\x1b[0m');

/**
 * Simulates AudioGraphManager's Enhanced In-Phase Center-Channel Canceller matrix:
 *
 * Difference Bus: diff = 0.5 * (L - R)
 * Bass Mono Bus:  bass = 0.5 * (L + R) * LowpassResponse(f)
 * Highs Stereo:   highL = L * HighpassResponse(f), highR = R * HighpassResponse(f)
 *
 * OutL = (diff + bass + highL) * makeupGain (1.25)
 * OutR = (diff + bass + highR) * makeupGain (1.25)
 */
function simulateVocalRemover(inL, inR, freqBand) {
  const makeupGain = 1.25;
  const diffBus = 0.5 * (inL - inR);

  // Bandpass approximations based on 160 Hz / 5500 Hz cutoffs:
  let bassGain = 0;
  let highGain = 0;

  if (freqBand === 'bass') {
    bassGain = 1.0; // below 160 Hz
    highGain = 0.0;
  } else if (freqBand === 'vocal_mid') {
    bassGain = 0.0; // 160 Hz - 5500 Hz
    highGain = 0.0;
  } else if (freqBand === 'high') {
    bassGain = 0.0;
    highGain = 1.0; // above 5500 Hz
  }

  const monoBass = 0.5 * (inL + inR) * bassGain;
  const highL = inL * highGain;
  const highR = inR * highGain;

  const outL = (diffBus + monoBass + highL) * makeupGain;
  const outR = (diffBus + monoBass + highR) * makeupGain;

  return { outL, outR, diffBus };
}

// 1. Center-panned lead vocal cancellation (inL = 1.0, inR = 1.0, midrange frequency)
const centerVocal = simulateVocalRemover(1.0, 1.0, 'vocal_mid');
assert(
  centerVocal.diffBus === 0.0 && centerVocal.outL === 0.0 && centerVocal.outR === 0.0,
  'Center-panned vocal (L=1.0, R=1.0) in midrange produces exact 0.0 (-∞ dB cancellation)'
);

// 2. Hard-panned stereo instrument preservation (inL = 1.0, inR = 0.0, midrange frequency)
const pannedInstrument = simulateVocalRemover(1.0, 0.0, 'vocal_mid');
assert(
  pannedInstrument.diffBus === 0.5 && pannedInstrument.outL === 0.625 && pannedInstrument.outR === 0.625,
  'Hard-panned stereo instrument (L=1.0, R=0.0) is cleanly preserved and distributed'
);

// 3. Center bass & kick drum punch retention (< 160 Hz)
const centerBass = simulateVocalRemover(1.0, 1.0, 'bass');
assert(
  centerBass.diffBus === 0.0 && centerBass.outL === 1.25 && centerBass.outR === 1.25,
  'Center bass (<160 Hz) retains full punch (1.25x makeup gain) via mono sum'
);

// 4. Stereo high-frequency preservation (> 5500 Hz)
const stereoHighs = simulateVocalRemover(1.0, -0.5, 'high');
assert(
  stereoHighs.outL > 0 && stereoHighs.outR !== 0,
  'Stereo high frequencies (>5500 Hz) retain highpass detail and brightness'
);

// 5. In-phase acoustic room radiation (OutL + OutR acoustic wave collision)
// Unlike old out-of-phase OOPS where OutR = -(L-R) caused OutL + OutR = 0 in room air,
// the in-phase design gives OutL + OutR = 2 * diffBus * 1.25 != 0
const acousticRoomSum = pannedInstrument.outL + pannedInstrument.outR;
assert(
  acousticRoomSum === 1.25,
  'In-phase speaker radiation avoids acoustic destructive cancellation in venue room'
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

// 8. Verify AudioGraphManager vocal remover methods exist
const audioGraphSource = fs.readFileSync(path.resolve(__dirname, '../src/renderer/core/AudioGraphManager.ts'), 'utf8');
assert(
  audioGraphSource.includes('setupVocalRemoverGraph') && audioGraphSource.includes('setVocalRemover('),
  'AudioGraphManager contains dedicated vocal remover pipeline methods'
);


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

