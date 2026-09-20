#!/usr/bin/env node
/**
 * Lab: Signalsmith Stretch continuous 128-frame blocks at pitch -1..-4 ST.
 * Asserts maxAmp never stays at 0 after latency warm-up (500+ blocks).
 *
 * Run: node scripts/lab-signalsmith-pitch.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const stretchJs = path.join(root, 'node_modules/signalsmith-stretch/SignalsmithStretch.js');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function ok(msg) {
  console.log('OK:', msg);
}

if (!fs.existsSync(stretchJs)) {
  fail('signalsmith-stretch not installed (npm install signalsmith-stretch)');
}

const src = fs.readFileSync(stretchJs, 'utf8');
const m = src.match(/data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)/);
if (!m) fail('could not extract embedded wasm from SignalsmithStretch.js');

const wasmBytes = Buffer.from(m[1], 'base64');
let memory;

function growHeap(requestedSize) {
  const pageSize = 65536;
  const oldPages = memory.buffer.byteLength / pageSize;
  const newPages = Math.ceil(requestedSize / pageSize);
  const delta = newPages - oldPages;
  if (delta > 0) memory.grow(delta);
  return memory.buffer.byteLength;
}

const imports = {
  a: {
    d: () => {
      throw new Error('abort');
    },
    c: (dest, srcPtr, num) => {
      new Uint8Array(memory.buffer).copyWithin(dest, srcPtr, srcPtr + num);
    },
    b: (requestedSize) => growHeap(requestedSize),
    a: (buf, size) => {
      const view = new Uint8Array(memory.buffer, buf, size);
      for (let i = 0; i < size; i++) view[i] = (Math.random() * 256) | 0;
      return 0;
    }
  }
};

async function runPitchLab(semitones, blocks = 520) {
  const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
  const exp = instance.exports;
  memory = exp.e;
  exp.f(); // ctors

  const channels = 2;
  const sampleRate = 44100;
  const blockSize = 128;

  exp.n(channels, sampleRate); // presetDefault
  const bufLen = exp.k() + exp.l(); // inputLatency + outputLatency
  const ptr = exp.h(channels, bufLen); // setBuffers
  const in0 = ptr >> 2;
  const in1 = in0 + bufLen;
  const out0 = in1 + bufLen;
  const out1 = out0 + bufLen;

  exp.r(semitones, 8000 / sampleRate); // setTransposeSemitones

  let firstNonZero = -1;
  let zeroAfterWarm = 0;
  let minMaxAfterWarm = Infinity;

  for (let block = 0; block < blocks; block++) {
    const heapF = new Float32Array(memory.buffer);
    for (let i = 0; i < blockSize; i++) {
      const t = (block * blockSize + i) / sampleRate;
      const s = 0.35 * Math.sin(2 * Math.PI * 440 * t);
      heapF[in0 + i] = s;
      heapF[in1 + i] = s * 0.85;
    }
    exp.w(blockSize, blockSize); // process
    const heapOut = new Float32Array(memory.buffer);
    let maxAmp = 0;
    for (let i = 0; i < blockSize; i++) {
      maxAmp = Math.max(
        maxAmp,
        Math.abs(heapOut[out0 + i] || 0),
        Math.abs(heapOut[out1 + i] || 0)
      );
    }
    if (maxAmp >= 1e-6) {
      if (firstNonZero < 0) firstNonZero = block;
      if (maxAmp < minMaxAfterWarm) minMaxAfterWarm = maxAmp;
    } else if (firstNonZero >= 0) {
      zeroAfterWarm++;
    }
  }

  return {
    semitones,
    blocks,
    firstNonZero,
    zeroAfterWarm,
    minMaxAfterWarm: firstNonZero < 0 ? 0 : minMaxAfterWarm
  };
}

(async () => {
  for (const st of [-1, -2, -3, -4]) {
    const r = await runPitchLab(st, 520);
    if (r.firstNonZero < 0 || r.firstNonZero > 64) {
      fail(`pitch ${st} ST: never left silence (firstNonZero=${r.firstNonZero})`);
    }
    if (r.zeroAfterWarm !== 0) {
      fail(
        `pitch ${st} ST: ${r.zeroAfterWarm} silent blocks after warm-up (mute regression)`
      );
    }
    if (!(r.minMaxAfterWarm > 0)) {
      fail(`pitch ${st} ST: minMaxAfterWarm is 0`);
    }
    ok(
      `pitch ${st} ST: 520 blocks, warm-up ${r.firstNonZero}, zeroAfterWarm=0, minMax=${r.minMaxAfterWarm.toFixed(4)}`
    );
  }
  console.log('lab-signalsmith-pitch: all checks passed');
})().catch((err) => {
  fail(err && err.stack ? err.stack : String(err));
});
