#!/usr/bin/env node
/**
 * Probe whether Electron utilityProcess exposes navigator.gpu for ORT WebGPU.
 *
 * Production AppImage evidence: ORT strips webgpu with
 *   removing requested execution provider "webgpu" … backend not found
 * while Settings GPU-First stays on (main `getGPUFeatureStatus` ≠ worker EP).
 *
 * Usage (must run under Electron — utilityProcess is not available in plain Node):
 *   npx electron scripts/probe-worker-webgpu.js
 *
 * Plain Node still prints a static summary + in-process navigator probe.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '..');

function probeHere(label) {
  const nav = typeof globalThis !== 'undefined' ? globalThis.navigator : undefined;
  const navigatorType = typeof nav;
  const gpu =
    nav && typeof nav === 'object' && 'gpu' in nav ? nav.gpu : undefined;
  const row = {
    label,
    processType: process.type || 'node',
    pid: process.pid,
    platform: process.platform,
    electron: process.versions.electron || null,
    chrome: process.versions.chrome || null,
    navigatorType,
    hasNavigatorGpu: gpu != null,
    cpus: Math.max(1, (os.cpus() || []).length)
  };
  console.log(JSON.stringify(row));
  return row;
}

async function runUnderElectron() {
  // Lazy-require so `node scripts/probe-worker-webgpu.js` still works.
  const { app, utilityProcess } = require('electron');

  await app.whenReady();

  console.log('=== main process ===');
  probeHere('main');

  try {
    if (typeof app.getGPUFeatureStatus === 'function') {
      const status = app.getGPUFeatureStatus();
      console.log(
        JSON.stringify({
          label: 'main-gpu-feature-status',
          webgpu: status.webgpu,
          webgl: status.webgl,
          gpu_compositing: status.gpu_compositing
        })
      );
    }
  } catch (err) {
    console.log(
      JSON.stringify({
        label: 'main-gpu-feature-status-error',
        message: err instanceof Error ? err.message : String(err)
      })
    );
  }

  const workerBody = `
const os = require('os');
function report() {
  const nav = typeof globalThis !== 'undefined' ? globalThis.navigator : undefined;
  const gpu = nav && typeof nav === 'object' && 'gpu' in nav ? nav.gpu : undefined;
  const msg = {
    type: 'probe',
    processType: process.type || 'utility',
    pid: process.pid,
    navigatorType: typeof nav,
    hasNavigatorGpu: gpu != null,
    cpus: Math.max(1, (os.cpus() || []).length)
  };
  if (process.parentPort && process.parentPort.postMessage) {
    process.parentPort.postMessage(msg);
  } else if (typeof process.send === 'function') {
    process.send(msg);
  } else {
    console.log(JSON.stringify(msg));
  }
}
report();
setTimeout(() => process.exit(0), 50);
`;

  const tmpWorker = path.join(os.tmpdir(), `kls-probe-webgpu-worker-${process.pid}.js`);
  fs.writeFileSync(tmpWorker, workerBody, 'utf8');

  console.log('=== utilityProcess.fork ===');
  if (typeof utilityProcess?.fork !== 'function') {
    console.log(
      JSON.stringify({
        label: 'utilityProcess',
        available: false,
        note: 'utilityProcess.fork missing — cannot mirror Instrumental AI worker'
      })
    );
    app.quit();
    return;
  }

  await new Promise((resolve) => {
    const child = utilityProcess.fork(tmpWorker, [], {
      serviceName: 'probe-worker-webgpu',
      stdio: 'pipe'
    });
    const done = (payload) => {
      console.log(JSON.stringify({ label: 'utilityProcess', ...payload }));
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve();
    };
    const timer = setTimeout(() => {
      done({ error: 'timeout waiting for utilityProcess probe message' });
    }, 8000);
    child.on('message', (raw) => {
      clearTimeout(timer);
      const msg = raw && typeof raw === 'object' && 'data' in raw ? raw.data : raw;
      done(msg && typeof msg === 'object' ? msg : { raw: String(msg) });
    });
    child.on('exit', (code) => {
      // Message may already have resolved.
      clearTimeout(timer);
    });
    child.stdout?.on('data', (c) => process.stdout.write(`[utility stdout] ${c}`));
    child.stderr?.on('data', (c) => process.stderr.write(`[utility stderr] ${c}`));
  });

  try {
    fs.unlinkSync(tmpWorker);
  } catch {
    /* ignore */
  }

  console.log('=== interpretation ===');
  console.log(
    JSON.stringify({
      note:
        'If utilityProcess hasNavigatorGpu=false, ORT WebGPU EP will log ' +
        '"backend not found" / strip webgpu and run WASM (100% CPU with aiCpuThreads=all cores). ' +
        'Electron --enable-unsafe-webgpu helps BrowserWindow, not utilityProcess. ' +
        'Long-term: onnxruntime-node (DirectML/CUDA) or run ORT in a hidden BrowserWindow.',
      probeScript: pathToFileURL(__filename).href
    })
  );

  app.quit();
}

function main() {
  const isElectron = !!(process.versions && process.versions.electron);
  console.log('=== probe-worker-webgpu ===');
  console.log(
    JSON.stringify({
      cwd: root,
      isElectron,
      hint: isElectron
        ? 'running under Electron'
        : 're-run with: npx electron scripts/probe-worker-webgpu.js'
    })
  );
  console.log('=== this process ===');
  probeHere(isElectron ? 'electron-entry' : 'plain-node');

  if (!isElectron) {
    console.log(
      JSON.stringify({
        label: 'skip-utilityProcess',
        reason: 'Not Electron — Instrumental AI uses utilityProcess.fork; re-run under Electron'
      })
    );
    process.exit(0);
    return;
  }

  runUnderElectron().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

main();
