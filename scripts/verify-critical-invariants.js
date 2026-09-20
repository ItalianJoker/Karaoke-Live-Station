#!/usr/bin/env node
/**
 * Source-lock Critical Domain Invariants (Safety-First / Zero Regression).
 * Run: node scripts/verify-critical-invariants.js
 *
 * Does not change runtime behavior — asserts guardrail code remains wired.
 * See README "AI Context & Critical Invariants".
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function assert(cond, msg, detail) {
  if (!cond) {
    console.error('FAIL:', msg, detail ? `(${detail})` : '');
    process.exit(1);
  }
  console.log('OK:', msg);
}

const pitchSrc = fs.readFileSync(
  path.join(root, 'src/renderer/core/PitchShifterNode.ts'),
  'utf8'
);
const audioSrc = fs.readFileSync(
  path.join(root, 'src/renderer/core/AudioGraphManager.ts'),
  'utf8'
);
const storeSrc = fs.readFileSync(
  path.join(root, 'src/renderer/store/karaokeStore.ts'),
  'utf8'
);
const dmSrc = fs.readFileSync(
  path.join(root, 'src/main/services/DownloadManager.ts'),
  'utf8'
);
const msgSrc = fs.readFileSync(
  path.join(root, 'src/main/workers/aiWorkerMessage.ts'),
  'utf8'
);
const workerSrc = fs.readFileSync(
  path.join(root, 'src/main/workers/instrumentalAiWorker.ts'),
  'utf8'
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8')
);

// 1) pitch 0 = DSP bypass (SoundTouch ScriptProcessor; Bungee when pitch 0 & speed 1)
assert(
  pitchSrc.includes('bypassActive = true') &&
    pitchSrc.includes('const needsProcessor = clamped !== 0') &&
    pitchSrc.includes('this.applyBypassRouting(!needsProcessor)'),
  'PitchShifterNode: pitch 0 bypasses SoundTouch ScriptProcessor'
);

const bungeeSrc = fs.readFileSync(
  path.join(root, 'src/renderer/core/BungeePitchShifterNode.ts'),
  'utf8'
);
assert(
  bungeeSrc.includes('signalsmith-stretch') &&
    bungeeSrc.includes('SignalsmithStretch') &&
    bungeeSrc.includes('applyBypassRouting') &&
    bungeeSrc.includes('semitones !== 0') &&
    bungeeSrc.includes('setUnderrunFallbackHandler'),
  'BungeePitchShifterNode: Signalsmith Stretch Hi-Fi + pitch-0 bypass + mute watchdog'
);
assert(
  audioSrc.includes('falling back to SoundTouch') &&
    audioSrc.includes('setDspEngine') &&
    audioSrc.includes('PitchShifterNode') &&
    audioSrc.includes('applyMediaElementRateForActiveEngine') &&
    audioSrc.includes('Signalsmith Hi-Fi mute watchdog'),
  'AudioGraphManager keeps SoundTouch emergency path + Signalsmith Hi-Fi + mute watchdog'
);

// 2) volume gain = volume² clamped [0,1]
assert(
  audioSrc.includes('Math.pow(clamped, 2)') &&
    audioSrc.includes('computePerceptualGain') &&
    /Math\.max\(0,\s*Math\.min\(1,/.test(audioSrc),
  'AudioGraphManager: perceptual gain = volume² clamped [0,1]'
);

// Runtime mirror of Suite 1 (keeps this verify self-contained)
{
  function computePerceptualGain(volume, isMuted) {
    if (isMuted) return 0;
    const clamped = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0));
    return Math.round(Math.pow(clamped, 2) * 10000) / 10000;
  }
  assert(computePerceptualGain(0.5, false) === 0.25, 'volume²(0.5) === 0.25');
  assert(computePerceptualGain(1.5, false) === 1.0, 'volume > 1 clamps to 1');
  assert(computePerceptualGain(0.8, true) === 0.0, 'mute forces 0');
}

// 3) AI worker MessageEvent raw.data unwrap
assert(
  msgSrc.includes('unwrapAiWorkerInboundMessage') &&
    msgSrc.includes("'data' in obj") &&
    workerSrc.includes('unwrapAiWorkerInboundMessage(raw)'),
  'AI worker unwraps parentPort MessageEvent.data before separate'
);

// 4) SIAE ≥ 120s or natural end
assert(
  storeSrc.includes('currentElapsedSec >= 120') &&
    storeSrc.includes('logCurrentTrackExecution') &&
    storeSrc.includes('naturalEnd'),
  'SIAE log requires natural end OR elapsed ≥ 120s'
);

// 5) GC only queue_cache / temp — never libraryPath
assert(
  storeSrc.includes("filePath.includes('queue_cache')") &&
    storeSrc.includes("filePath.includes('qc_')") &&
    storeSrc.includes('cleanupQueueCacheFileIfUnreferenced'),
  'Store GC guard: only queue_cache / qc_ paths'
);
assert(
  dmSrc.includes('isInCache') &&
    dmSrc.includes('isInTemp') &&
    dmSrc.includes('Refused deletion of file outside queue_cache/temp'),
  'DownloadManager deleteCachedFile refuses paths outside queue_cache/temp'
);

// 6) SpessaSynth 5ms scheduler + latencyHint: 'playback'
assert(
  audioSrc.includes("latencyHint: 'playback'") &&
    audioSrc.includes('}, 5);') &&
    audioSrc.includes('startSchedulerTimer') &&
    audioSrc.includes('tickMidiScheduler'),
  "AudioGraphManager: latencyHint 'playback' + 5ms MIDI scheduler"
);

// Native / ASAR unpack compatibility (do not regress packaging)
assert(
  Array.isArray(packageJson.build?.asarUnpack) &&
    packageJson.build.asarUnpack.some((p) => String(p).includes('better-sqlite3')) &&
    packageJson.build.asarUnpack.some((p) => String(p).includes('ffmpeg-static')),
  'package.json asarUnpack keeps better-sqlite3 + ffmpeg-static unpackable'
);

// MessageEvent unwrap runtime probe (same helper as verify-ai-worker-ipc-unwrap)
{
  const helperPath = path.join(root, 'src/main/workers/aiWorkerMessage.ts');
  const probe = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--no-warnings',
      '-e',
      `
      import { unwrapAiWorkerInboundMessage } from ${JSON.stringify(helperPath)};
      const assert = (c, m) => { if (!c) { console.error('PROBE_FAIL', m); process.exit(2); } };
      const bare = { type: 'separate', requestId: 1 };
      assert(unwrapAiWorkerInboundMessage(bare) === bare, 'bare');
      const wrapped = { data: bare, ports: [] };
      assert(unwrapAiWorkerInboundMessage(wrapped) === bare, 'MessageEvent.data');
      console.log('INVARIANT_UNWRAP_OK');
      `
    ],
    { cwd: root, encoding: 'utf8' }
  );
  assert(
    probe.status === 0 && (probe.stdout || '').includes('INVARIANT_UNWRAP_OK'),
    'unwrapAiWorkerInboundMessage runtime probe',
    (probe.stderr || probe.stdout || `exit ${probe.status}`).slice(0, 400)
  );
}

console.log('\nverify-critical-invariants: all checks passed.');
