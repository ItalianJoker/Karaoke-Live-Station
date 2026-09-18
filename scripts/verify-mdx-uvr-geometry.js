#!/usr/bin/env node
/**
 * Fast check: UVR-MDX Karaoke 2 geometry + timeout helpers (no Electron / ORT).
 * Run: node scripts/verify-mdx-uvr-geometry.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('OK:', msg);
}

const geomSrc = fs.readFileSync(path.join(root, 'src/main/ai/mdxUvrGeometry.ts'), 'utf8');
const mdxSrc = fs.readFileSync(path.join(root, 'src/main/ai/MdxNetSeparator.ts'), 'utf8');
const fftSrc = fs.readFileSync(path.join(root, 'src/main/ai/audioFft.ts'), 'utf8');
const sepSrc = fs.readFileSync(path.join(root, 'src/main/services/InstrumentalAiSeparator.ts'), 'utf8');

assert(geomSrc.includes('mdxStepSamples') && geomSrc.includes("overlap === 'default'"), 'Geometry exports Default overlap step');
assert(
  mdxSrc.includes('mdxStepSamples(cfg.mdxOverlap') && mdxSrc.includes('mdxTailPadSamples'),
  'MdxNetSeparator uses fractional overlap via mdxStepSamples(cfg.mdxOverlap)'
);
assert(mdxSrc.includes("mdxStepSamples('default'"), 'DEFAULT_STEP export still documents UVR Default');
assert(!/CHUNK_SIZE \/ 2/.test(mdxSrc) && !/num_overlap ≈ 2/.test(mdxSrc), 'MdxNetSeparator no longer uses 50% triangular OLA step');
assert(fftSrc.includes('warmAudioFftForMdx') && fftSrc.includes('periodic'), 'FFT warm + periodic Hann');
assert(
  sepSrc.includes('AI_SEPARATION_ORT_SILENCE_TIMEOUT_MS') &&
    sepSrc.includes('startParentKeepAlive') &&
    sepSrc.includes('ort_silence_timeout'),
  'Parent ORT silence keep-alive / clear stall logs'
);

// Inline UVR math (mirrors mdxUvrGeometry.ts)
const HOP = 1024;
const DIM_T = 256;
const N_FFT = 5120;
const CHUNK = HOP * (DIM_T - 1);
const TRIM = N_FFT >> 1;
const GEN = CHUNK - 2 * TRIM;
const STEP_DEFAULT = CHUNK - N_FFT;
const STEP_HALF = Math.floor(CHUNK / 2);
const STEP_025 = Math.floor((1 - 0.25) * CHUNK);

assert(CHUNK === 261120, `chunk_size=${CHUNK}`);
assert(TRIM === 2560, `trim=${TRIM}`);
assert(GEN === 256000, `gen_size=${GEN}`);
assert(STEP_025 === 195840, `overlap 0.25 step=${STEP_025}`);
assert(STEP_025 < STEP_DEFAULT, '0.25 overlap hop < UVR Default hop (more ORT windows)');
assert(STEP_HALF < STEP_025, '0.50 overlap hop < 0.25 hop');
assert(STEP_DEFAULT === 256000, `UVR Default step=${STEP_DEFAULT}`);
assert(STEP_DEFAULT === GEN, 'Default step equals gen_size (UVR)');

function defaultCount(mixLen) {
  const pad = GEN + TRIM - (mixLen % GEN);
  const mixtureLen = TRIM + mixLen + pad;
  let c = 0;
  for (let i = 0; i < mixtureLen; i += STEP_DEFAULT) c++;
  return c;
}
function halfCount(mixLen) {
  const padded = mixLen + 2 * TRIM;
  let c = 0;
  for (let start = 0; start + CHUNK <= padded; start += STEP_HALF) c++;
  return c;
}

for (const dur of [60, 180, 300]) {
  const n = Math.round(dur * 44100);
  const d = defaultCount(n);
  const h = halfCount(n);
  assert(d < h, `${dur}s: Default chunks ${d} < half-overlap ${h}`);
  assert(h / d > 1.5, `${dur}s: half-overlap is >1.5× Default (${h}/${d})`);
}

// Timeout scaling still generous for CPU WASM
function computeTimeout(durationSec) {
  const MIN = 30 * 60 * 1000;
  const MAX = 3 * 60 * 60 * 1000;
  const PER = 45 * 1000;
  const dur = durationSec > 0 ? durationSec : 240;
  return Math.min(MAX, Math.max(MIN, MIN + dur * PER));
}
assert(computeTimeout(180) >= 30 * 60 * 1000 + 180 * 45 * 1000, '3 min track gets scaled hard timeout');
assert(computeTimeout(10) === 30 * 60 * 1000 + 10 * 45 * 1000, 'short track still above 30 min floor via scaled budget');
assert(computeTimeout(10) >= 30 * 60 * 1000, 'short track hard timeout ≥ 30 min');

// Compile geometry + FFT helpers and run a tiny round-trip
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kls-mdx-geom-'));
const outDir = path.join(tmp, 'out');
fs.mkdirSync(outDir);
const tsc = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  [
    'tsc',
    '--outDir',
    outDir,
    '--module',
    'commonjs',
    '--target',
    'ES2020',
    '--esModuleInterop',
    '--skipLibCheck',
    path.join(root, 'src/main/ai/mdxUvrGeometry.ts'),
    path.join(root, 'src/main/ai/audioFft.ts'),
    path.join(root, 'src/main/ai/yieldToMain.ts')
  ],
  { cwd: root, encoding: 'utf8' }
);
assert(tsc.status === 0, `tsc geometry/fft: ${tsc.stderr || tsc.stdout || 'ok'}`);

// Resolve deps (fft.js) from the repo node_modules, not the temp outDir.
const Module = require('module');
const nodeModules = path.join(root, 'node_modules');
const prevNodePath = process.env.NODE_PATH || '';
process.env.NODE_PATH = [nodeModules, prevNodePath].filter(Boolean).join(path.delimiter);
Module._initPaths();

const geom = require(path.join(outDir, 'mdxUvrGeometry.js'));
assert(geom.mdxStepSamples('default') === STEP_DEFAULT, 'compiled Default step');
assert(geom.mdxDefaultChunkCount(180 * 44100) === defaultCount(180 * 44100), 'compiled default count matches');
assert(
  geom.mdxHalfOverlapChunkCount(180 * 44100) > geom.mdxDefaultChunkCount(180 * 44100),
  'compiled half-overlap count > Default'
);

const fft = require(path.join(outDir, 'audioFft.js'));
fft.warmAudioFftForMdx(5120);
const impulse = new Float32Array(5120);
impulse[0] = 1;
const { re, im } = fft.realFftFrame(impulse, 5120, 0);
const back = fft.realIfftFrame(re, im, 5120, 0);
assert(Math.abs(back[0] - 1) < 1e-3, `FFT round-trip peak=${back[0]}`);
const w = fft.hannWindow(8, true);
assert(Math.abs(w[0]) < 1e-6 && Math.abs(w[4] - 1) < 1e-6, 'periodic Hann endpoints');

console.log('verify-mdx-uvr-geometry: all checks passed');
