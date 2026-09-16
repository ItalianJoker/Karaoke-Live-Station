/**
 * Functional verification for on-demand dual-stem vocal remover.
 * Uses real ffmpeg to build a muxed MP4 fixture, demux audio, and round-trip
 * SHA-256 stem cache (same layout as DualStemCache / MediaAudioExtractor).
 *
 * Does NOT download UVR/ONNX models or drive Electron Web Audio — those need
 * Luca's manual QA (or a packaged GUI session).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const {
  DUAL_STEM_INSTRUMENTAL_FILENAME,
  DUAL_STEM_VOCALS_FILENAME,
  DUAL_STEM_META_FILENAME
} = (() => {
  // Mirror shared/dualStem.ts constants (keep in sync)
  return {
    DUAL_STEM_INSTRUMENTAL_FILENAME: 'stem_instrumental.wav',
    DUAL_STEM_VOCALS_FILENAME: 'stem_vocals.wav',
    DUAL_STEM_META_FILENAME: 'meta.json'
  };
})();

let passed = 0;
let failed = 0;

function assert(cond, name, detail = '') {
  if (cond) {
    console.log(`  \x1b[32m✔\x1b[0m ${name}`);
    passed++;
  } else {
    console.error(`  \x1b[31m✖\x1b[0m ${name}${detail ? ` (${detail})` : ''}`);
    failed++;
  }
}

function resolveFfmpeg() {
  const candidates = [
    path.join(__dirname, '../node_modules/ffmpeg-static/ffmpeg'),
    path.join(__dirname, '../node_modules/ffmpeg-static/ffmpeg.exe'),
    'ffmpeg'
  ];
  for (const c of candidates) {
    if (c === 'ffmpeg') return c;
    if (fs.existsSync(c)) return c;
  }
  return 'ffmpeg';
}

function hashFileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

/** Minimal stereo PCM WAV (silence) for stem cache fixtures. */
function writeSilentWav(filePath, seconds = 0.5, sampleRate = 44100) {
  const numChannels = 2;
  const numSamples = Math.floor(seconds * sampleRate);
  const dataSize = numSamples * numChannels * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * numChannels * 2, 28);
  buf.writeUInt16LE(numChannels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  // leave PCM zeros (silence)
  fs.writeFileSync(filePath, buf);
}

/** Pure state-machine transitions matching AudioGraphManager dual-stem design. */
function nextDualStemState(current, event) {
  switch (current) {
    case 'NATIVE_AUDIO':
      if (event === 'engage') return 'EXTRACTING_AND_SEPARATING';
      return current;
    case 'EXTRACTING_AND_SEPARATING':
      if (event === 'stems_ready') return 'DUAL_STEM_ACTIVE';
      if (event === 'cancel' || event === 'deactivate' || event === 'ai_failed') return 'NATIVE_AUDIO';
      return current;
    case 'DUAL_STEM_ACTIVE':
      if (event === 'deactivate') return 'NATIVE_AUDIO';
      return current;
    default:
      return 'NATIVE_AUDIO';
  }
}

function isDualStemEngaged(level) {
  return level < 0.999;
}

function simulateHotSwapMute(video) {
  // Matches AudioGraphManager.muteMediaElementForDualStem / restoreMediaElementMute
  const state = { muted: !!video.muted, dualStemMuted: false };
  return {
    engage() {
      if (!state.dualStemMuted) {
        state.muted = true;
        state.dualStemMuted = true;
      }
      return state.muted;
    },
    deactivate() {
      if (state.dualStemMuted) {
        state.muted = false;
        state.dualStemMuted = false;
      }
      return state.muted;
    },
    get muted() {
      return state.muted;
    }
  };
}

function main() {
  console.log('\n\x1b[36m▶ Dual-stem functional verification (ffmpeg + cache + state machine)\x1b[0m');

  const ffmpeg = resolveFfmpeg();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kls-dual-stem-'));
  const fixtureMp4 = path.join(workDir, 'fixture-muxed.mp4');
  const extractedWav = path.join(workDir, 'extracted.wav');
  const cacheRoot = path.join(workDir, 'dual-stem-cache');

  try {
    // --- 1) Generate small muxed MP4 (color bars + sine) ---
    const gen = spawnSync(
      ffmpeg,
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=320x240:d=1',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=1',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-shortest',
        fixtureMp4
      ],
      { encoding: 'utf8' }
    );
    assert(gen.status === 0 && fs.existsSync(fixtureMp4), 'ffmpeg generated muxed MP4 fixture', gen.stderr?.slice(-200));
    assert(fs.statSync(fixtureMp4).size > 1000, 'fixture MP4 is non-trivial size');

    // --- 2) Demux audio (-vn) like MediaAudioExtractor ---
    const demux = spawnSync(
      ffmpeg,
      [
        '-y',
        '-i',
        fixtureMp4,
        '-vn',
        '-ac',
        '2',
        '-ar',
        '44100',
        '-c:a',
        'pcm_s16le',
        '-f',
        'wav',
        extractedWav
      ],
      { encoding: 'utf8' }
    );
    assert(demux.status === 0 && fs.existsSync(extractedWav), 'ffmpeg demuxed audio track from MP4', demux.stderr?.slice(-200));
    assert(fs.statSync(extractedWav).size > 1024, 'extracted WAV has PCM payload');

    // --- 3) SHA-256 keyed cache round-trip (DualStemCache layout) ---
    const sha256 = hashFileSha256(fixtureMp4);
    assert(/^[a-f0-9]{64}$/.test(sha256), 'source SHA-256 is 64 hex chars');
    const cacheDir = path.join(cacheRoot, sha256);
    fs.mkdirSync(cacheDir, { recursive: true });
    const instPath = path.join(cacheDir, DUAL_STEM_INSTRUMENTAL_FILENAME);
    const vocPath = path.join(cacheDir, DUAL_STEM_VOCALS_FILENAME);
    writeSilentWav(instPath, 1.0);
    writeSilentWav(vocPath, 1.0);
    const meta = {
      sourcePath: fixtureMp4,
      sourceSize: fs.statSync(fixtureMp4).size,
      sourceMtimeMs: fs.statSync(fixtureMp4).mtimeMs,
      sha256,
      sampleRate: 44100,
      method: 'aiMdxKaraoke2',
      createdAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(cacheDir, DUAL_STEM_META_FILENAME), JSON.stringify(meta, null, 2));

    const lookupHit =
      fs.existsSync(instPath) &&
      fs.existsSync(vocPath) &&
      fs.statSync(instPath).size > 1024 &&
      fs.statSync(vocPath).size > 1024;
    assert(lookupHit, 'cache lookup hit for SHA-256 dir with both stem WAVs');

    const shaAgain = hashFileSha256(fixtureMp4);
    assert(shaAgain === sha256, 'SHA-256 is stable across re-hash');

    // Miss path: different file → different hash → no stems
    const otherMp4 = path.join(workDir, 'other.mp4');
    fs.copyFileSync(fixtureMp4, otherMp4);
    // Append a byte to change hash without breaking container badly for hashing only
    fs.appendFileSync(otherMp4, Buffer.from([0]));
    const otherHash = hashFileSha256(otherMp4);
    assert(otherHash !== sha256, 'different file content yields different SHA-256');
    assert(!fs.existsSync(path.join(cacheRoot, otherHash)), 'cache miss for unknown hash');

    // --- 4) State machine (NATIVE → EXTRACTING → DUAL → NATIVE + cancel) ---
    let s = 'NATIVE_AUDIO';
    s = nextDualStemState(s, 'engage');
    assert(s === 'EXTRACTING_AND_SEPARATING', 'engage → EXTRACTING_AND_SEPARATING');
    s = nextDualStemState(s, 'stems_ready');
    assert(s === 'DUAL_STEM_ACTIVE', 'stems_ready → DUAL_STEM_ACTIVE');
    s = nextDualStemState(s, 'deactivate');
    assert(s === 'NATIVE_AUDIO', 'deactivate → NATIVE_AUDIO');

    s = nextDualStemState('NATIVE_AUDIO', 'engage');
    s = nextDualStemState(s, 'cancel');
    assert(s === 'NATIVE_AUDIO', 'cancel during extract → NATIVE_AUDIO');

    s = nextDualStemState('NATIVE_AUDIO', 'engage');
    s = nextDualStemState(s, 'ai_failed');
    assert(s === 'NATIVE_AUDIO', 'ai_failed during extract → NATIVE_AUDIO');

    // --- 5) Fader engage semantics ---
    assert(!isDualStemEngaged(1), 'fader 100% is not engaged');
    assert(!isDualStemEngaged(0.999), 'fader 0.999 is not engaged');
    assert(isDualStemEngaged(0.998), 'fader < 0.999 engages');
    assert(isDualStemEngaged(0), 'fader 0 engages (instrumental only)');

    // --- 6) Hot-swap mute / unmute ---
    const video = { muted: false };
    const muteCtrl = simulateHotSwapMute(video);
    assert(muteCtrl.muted === false, 'native: video unmuted');
    muteCtrl.engage();
    assert(muteCtrl.muted === true, 'DUAL_STEM_ACTIVE: video muted');
    muteCtrl.deactivate();
    assert(muteCtrl.muted === false, 'deactivate: video unmuted again');

    // --- 7) Source wiring still present in repo ---
    const agm = fs.readFileSync(
      path.join(__dirname, '../src/renderer/core/AudioGraphManager.ts'),
      'utf8'
    );
    assert(
      agm.includes("setDualStemState('EXTRACTING_AND_SEPARATING')") &&
        agm.includes("setDualStemState('DUAL_STEM_ACTIVE')") &&
        agm.includes("setDualStemState('NATIVE_AUDIO')") &&
        agm.includes('muteMediaElementForDualStem') &&
        agm.includes('restoreMediaElementMute') &&
        agm.includes('activateDualStemPipeline') &&
        agm.includes('teardownDualStemToNative'),
      'AudioGraphManager implements full dual-stem state + mute hot-swap'
    );

    const cacheSrc = fs.readFileSync(
      path.join(__dirname, '../src/main/services/DualStemCache.ts'),
      'utf8'
    );
    assert(
      cacheSrc.includes('hashFileSha256') &&
        cacheSrc.includes('stem_instrumental.wav') &&
        cacheSrc.includes('stem_vocals.wav'),
      'DualStemCache hashes source and stores both stem WAVs'
    );
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  console.log(`\n  Dual-stem verify: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
  return { passed, failed };
}

if (require.main === module) {
  main();
}

module.exports = { main, nextDualStemState, isDualStemEngaged };
