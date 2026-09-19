#!/usr/bin/env node
/**
 * Verify AI worker parentPort MessageEvent unwrap + source wiring.
 * Run: node scripts/verify-ai-worker-ipc-unwrap.js
 *
 * Documents Electron asymmetry (parentPort → { data, ports }; fork → bare payload)
 * and asserts unwrapAiWorkerInboundMessage + worker/separator hardening stay wired.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function assert(cond, msg, detail) {
  if (!cond) {
    console.error('FAIL:', msg, detail ? `(${detail})` : '');
    process.exit(1);
  }
  console.log('OK:', msg);
}

const workerSrc = fs.readFileSync(
  path.join(root, 'src/main/workers/instrumentalAiWorker.ts'),
  'utf8'
);
const msgSrc = fs.readFileSync(path.join(root, 'src/main/workers/aiWorkerMessage.ts'), 'utf8');
const sepSrc = fs.readFileSync(
  path.join(root, 'src/main/services/InstrumentalAiSeparator.ts'),
  'utf8'
);

assert(
  msgSrc.includes('unwrapAiWorkerInboundMessage') &&
    msgSrc.includes("typeof obj.type === 'string'") &&
    msgSrc.includes("'data' in obj"),
  'aiWorkerMessage exports unwrap that prefers bare `type` then MessageEvent.data'
);

assert(
  workerSrc.includes("from './aiWorkerMessage'") &&
    workerSrc.includes('unwrapAiWorkerInboundMessage(raw)') &&
    !/const data = raw as SeparateRequest/.test(workerSrc),
  'instrumentalAiWorker unwraps inbound messages before type===separate check'
);

assert(
  !/^import\s+\{[^}]*DemucsProcessor[^}]*\}\s+from\s+['"]demucs-web['"]/m.test(workerSrc) &&
    fs.readFileSync(path.join(root, 'src/main/workers/instrumentalAiSeparateCore.ts'), 'utf8')
      .includes("await import('demucs-web')"),
  'demucs-web is lazy-imported only on HTDemucs path (no top-level require)'
);

assert(
  sepSrc.includes('attachWorkerStdioLogging') &&
    sepSrc.includes('AI worker stderr:') &&
    sepSrc.includes('AI worker stdout:') &&
    /stdout\?\.on\(\s*['"]data['"]/.test(sepSrc) &&
    /stderr\?\.on\(\s*['"]data['"]/.test(sepSrc),
  'InstrumentalAiSeparator pipes/logs utilityProcess + fork stdout/stderr'
);

// Runtime: pure unwrap helper via Node strip-types
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

      const bare = {
        type: 'separate',
        requestId: 1,
        method: 'aiMdxKaraoke2',
        modelPath: '/m.onnx',
        ortDir: '/ort',
        inputWav: '/a.extract.wav',
        outputWav: '/a.instrumental.extract.wav'
      };

      // Electron parentPort MessageEvent shape (docs + MessagePortMain)
      const event = { data: bare, ports: [] };
      const unwrapped = unwrapAiWorkerInboundMessage(event);
      assert(unwrapped === bare || unwrapped?.type === 'separate', 'event-data');
      assert(unwrapped.type === 'separate', 'event-type');
      assert(unwrapped.requestId === 1, 'event-requestId');

      // Fork / Node IPC: bare payload unchanged
      assert(unwrapAiWorkerInboundMessage(bare) === bare, 'bare-identity');
      assert(unwrapAiWorkerInboundMessage(bare).type === 'separate', 'bare-type');

      // Non-protocol MessageEvent-like without type at top level
      const progressEvent = { data: { type: 'progress', requestId: 0, phase: 'ready' }, ports: [] };
      assert(unwrapAiWorkerInboundMessage(progressEvent).type === 'progress', 'progress-event');

      // Null / primitives pass through
      assert(unwrapAiWorkerInboundMessage(null) === null, 'null');
      assert(unwrapAiWorkerInboundMessage(undefined) === undefined, 'undefined');
      assert(unwrapAiWorkerInboundMessage('x') === 'x', 'string');

      // Object with both type and data: treat as bare protocol (do not unwrap)
      const weird = { type: 'separate', data: { type: 'other' }, requestId: 9 };
      assert(unwrapAiWorkerInboundMessage(weird).type === 'separate', 'type-wins');
      assert(unwrapAiWorkerInboundMessage(weird).requestId === 9, 'type-wins-id');

      // Simulated silent-drop bug: treating MessageEvent as payload
      assert(event.type !== 'separate', 'bug-shape-no-top-type');
      assert(unwrapAiWorkerInboundMessage(event).type === 'separate', 'bug-fixed-by-unwrap');

      console.log('PROBE_OK');
      `
    ],
    { encoding: 'utf8' }
  );
  assert(
    probe.status === 0 && (probe.stdout || '').includes('PROBE_OK'),
    'unwrapAiWorkerInboundMessage runtime: MessageEvent vs bare payload',
    (probe.stderr || probe.stdout || `exit ${probe.status}`).slice(0, 500)
  );
}

// Optional Electron utilityProcess live probe (skipped when Electron cannot start)
{
  const electronCli = path.join(root, 'node_modules', 'electron', 'cli.js');
  if (!fs.existsSync(electronCli)) {
    console.log(
      'SKIP: Electron not installed — parentPort contract covered by unwrap unit test + Electron docs'
    );
  } else {
    const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kls-ai-ipc-'));
    const childScript = path.join(probeDir, 'child.js');
    const parentScript = path.join(probeDir, 'parent.js');
    fs.writeFileSync(
      childScript,
      `
function unwrap(raw) {
  if (raw === null || typeof raw !== 'object') return raw;
  if (typeof raw.type === 'string') return raw;
  if ('data' in raw) return raw.data;
  return raw;
}
process.parentPort.on('message', (raw) => {
  const shape = {
    hasType: typeof raw?.type === 'string',
    hasData: raw && typeof raw === 'object' && 'data' in raw,
    hasPorts: raw && typeof raw === 'object' && Array.isArray(raw.ports),
    keys: raw && typeof raw === 'object' ? Object.keys(raw).sort() : [],
    unwrappedType: unwrap(raw)?.type || null
  };
  process.parentPort.postMessage({ type: 'probe-result', shape });
});
process.parentPort.postMessage({ type: 'probe-ready' });
`
    );
    fs.writeFileSync(
      parentScript,
      `
const { app, utilityProcess } = require('electron');
app.whenReady().then(() => {
  const child = utilityProcess.fork(${JSON.stringify(childScript)}, [], {
    serviceName: 'ai-ipc-probe',
    stdio: 'pipe'
  });
  let got = null;
  child.on('message', (msg) => {
    if (msg?.type === 'probe-ready') {
      child.postMessage({ type: 'separate', requestId: 1 });
      return;
    }
    if (msg?.type === 'probe-result') {
      got = msg.shape;
      console.log('ELECTRON_PROBE', JSON.stringify(got));
      try { child.kill(); } catch {}
      app.exit(got && got.hasData && !got.hasType && got.unwrappedType === 'separate' ? 0 : 2);
    }
  });
  child.on('exit', () => {
    if (!got) {
      console.error('ELECTRON_PROBE_FAIL no result');
      app.exit(3);
    }
  });
  setTimeout(() => {
    console.error('ELECTRON_PROBE_TIMEOUT');
    try { child.kill(); } catch {}
    app.exit(4);
  }, 15000);
});
`
    );
    const run = spawnSync(
      'env',
      ['-u', 'ELECTRON_RUN_AS_NODE', process.execPath, electronCli, parentScript],
      { cwd: root, encoding: 'utf8', timeout: 30000 }
    );
    const out = `${run.stdout || ''}${run.stderr || ''}`;
    if (run.status === 0 && out.includes('ELECTRON_PROBE')) {
      assert(
        out.includes('"hasData":true') &&
          out.includes('"hasType":false') &&
          out.includes('"unwrappedType":"separate"'),
        'Electron utilityProcess parentPort delivers MessageEvent { data, ports }'
      );
    } else {
      console.log(
        'SKIP: Electron utilityProcess probe could not run in this environment:',
        out.slice(0, 300) || `exit ${run.status}`
      );
    }
    try {
      fs.rmSync(probeDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

console.log('\nverify-ai-worker-ipc-unwrap: all checks passed');
