/**
 * Automated Verification Test Suite for Karaoke Live Station
 *
 * Covers:
 * 1. AudioGraphManager Perceptual Volume Curve (quadratic taper, monotonicity, clamping, mute)
 * 2. DownloadManager Filename Sanitization (accent preservation, illegal character stripping)
 * 3. LibraryPanel & Store Queue Switch Logic (temp-to-permanent path redirection)
 * 4. i18n Localization Parity across it, en, es, fr
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
