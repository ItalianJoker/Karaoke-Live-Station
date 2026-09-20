#!/usr/bin/env node
/**
 * Verify AI worker WebGPU telemetry + early skip (navigator.gpu) + no silent catch.
 * Run: node scripts/verify-ai-worker-webgpu-telemetry.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function assert(cond, msg, detail) {
  if (!cond) {
    console.error('FAIL:', msg);
    if (detail) console.error(String(detail).slice(0, 800));
    process.exit(1);
  }
  console.log('OK:', msg);
}

const shared = fs.readFileSync(path.join(root, 'src/shared/aiWorkerWebGpu.ts'), 'utf8');
const mdx = fs.readFileSync(path.join(root, 'src/main/ai/MdxNetSeparator.ts'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'src/main/workers/instrumentalAiWorker.ts'), 'utf8');
const sepCore = fs.readFileSync(
  path.join(root, 'src/main/workers/instrumentalAiSeparateCore.ts'),
  'utf8'
);
const sep = fs.readFileSync(path.join(root, 'src/main/services/InstrumentalAiSeparator.ts'), 'utf8');
const proc = fs.readFileSync(path.join(root, 'src/main/services/InstrumentalProcessor.ts'), 'utf8');
const probe = fs.readFileSync(path.join(root, 'src/main/ai/probeGpuStatus.ts'), 'utf8');
const probeScript = fs.readFileSync(path.join(root, 'scripts/probe-worker-webgpu.js'), 'utf8');
const hidden = fs.readFileSync(
  path.join(root, 'src/main/services/InstrumentalAiHiddenRenderer.ts'),
  'utf8'
);
const gpuRenderer = fs.readFileSync(
  path.join(root, 'src/main/workers/instrumentalAiGpuRenderer.ts'),
  'utf8'
);

assert(
  shared.includes('probeWorkerWebGpu') &&
    shared.includes('resolveWorkerOrtProviders') &&
    shared.includes('formatOrtInitError') &&
    shared.includes('navigator.gpu'),
  'aiWorkerWebGpu: probe + resolve + format helpers'
);

assert(
  mdx.includes('resolveWorkerOrtProviders') &&
    mdx.includes("executionProviders: ['webgpu']") &&
    mdx.includes("executionProviders: ['wasm']") &&
    mdx.includes('formatOrtInitError') &&
    mdx.includes('ortFallbackReason') &&
    mdx.includes('console.warn') &&
    mdx.includes("from 'onnxruntime-web/all'") &&
    mdx.includes('GpuFallbackRequestedError') &&
    mdx.includes('allowInProcessWasmFallback') &&
    !mdx.includes('preferGpu ? [\'webgpu\', \'wasm\']') &&
    !/catch\s*\{\s*\n\s*this\.session = await ort\.InferenceSession\.create/.test(mdx),
  'MdxNetSeparator: ort/all + webgpu-only then wasm (or GpuFallback); no silent catch'
);

assert(
  worker.includes('runInstrumentalAiSeparate') &&
    worker.includes('unwrapAiWorkerInboundMessage') &&
    sepCore.includes('resolveWorkerOrtProviders') &&
    sepCore.includes("createAndRun(['webgpu'])") &&
    sepCore.includes('formatOrtInitError') &&
    sepCore.includes("from 'onnxruntime-web/all'") &&
    sepCore.includes('gpu-fallback-requested') &&
    sepCore.includes('allowInProcessWasmFallback') &&
    !/catch\s*\{\s*\n\s*\/\/ WebGPU EP may be unavailable/.test(sepCore),
  'instrumentalAiWorker + separateCore: ort/all + Demucs webgpu + gpu-fallback IPC'
);

assert(
  sep.includes('ortFallbackReason') &&
    sep.includes('backend not found') &&
    sep.includes('ORT stderr indicates WebGPU EP unavailable') &&
    sep.includes("ortBackend: 'pending'") &&
    sep.includes('gpu-fallback-requested') &&
    sep.includes('allowInProcessWasmFallback') &&
    sep.includes('Hidden Renderer requested WASM re-route') &&
    !sep.includes("ortBackend: 'wasm',\n      ortNumThreads: 1"),
  'InstrumentalAiSeparator: stderr webgpu hint + gpu-fallback → utility + no hardcoded ortNumThreads:1'
);

assert(
  proc.includes('ortBackendPreferred') &&
    proc.includes('ortFallbackReason') &&
    proc.includes('ortNumThreads: options.aiCpuThreads ?? null') &&
    !proc.includes('ortNumThreads: options.aiCpuThreads ?? 1'),
  'InstrumentalProcessor: pending EP + no ?? 1 thread lie'
);

assert(
  probe.includes('workerWebGpuAvailable') &&
    probe.includes('workerOrtBackend') &&
    probe.includes('getInstrumentalAiHiddenRenderer') &&
    probe.includes('probeWebGpu') &&
    (probe.includes('adapterOk') || probe.includes('isSupported: workerWebGpuAvailable')),
  'probeGpuStatus: Hidden Renderer WebGPU probe (not hardcoded utilityProcess false)'
);

assert(
  probeScript.includes('utilityProcess') &&
    probeScript.includes('hasNavigatorGpu') &&
    probeScript.includes('backend not found'),
  'scripts/probe-worker-webgpu.js present'
);

assert(
  hidden.includes('show: false') &&
    hidden.includes('backgroundThrottling: false') &&
    hidden.includes('BrowserWindow') &&
    hidden.includes('executeJavaScript') &&
    hidden.includes('userData') &&
    hidden.includes('requestAdapter') &&
    hidden.includes('requestDevice') &&
    hidden.includes('WEBGPU_DEVICE_PROBE_TIMEOUT_MS') &&
    sep.includes('hidden-renderer') &&
    sep.includes('getInstrumentalAiHiddenRenderer') &&
    sep.includes('gpuToggleOn') &&
    !sep.includes('aiEnableGpu !== false && options.aiGpuSupported === true'),
  'Hidden Renderer: asar-safe shell + requestDevice probe; route on live GPU toggle (not sticky snapshot)'
);

assert(
  gpuRenderer.includes('ipcRenderer') &&
    gpuRenderer.includes('runInstrumentalAiSeparate') &&
    gpuRenderer.includes('requestAdapter') &&
    gpuRenderer.includes('requestDevice') &&
    gpuRenderer.includes('gpu-fallback-requested') &&
    sepCore.includes('runInstrumentalAiSeparate') &&
    sepCore.includes("createAndRun(['webgpu'])") &&
    sepCore.includes('GpuFallbackRequestedError') &&
    sepCore.includes('WEBGPU_SESSION_TIMEOUT_MS') &&
    sepCore.includes('jsepWasm') &&
    mdx.includes('WEBGPU_SESSION_TIMEOUT_MS') &&
    mdx.includes('raceWithTimeout') &&
    mdx.includes('forWebGpu') &&
    mdx.includes('jsepWasm'),
  'GPU renderer entry + shared core: WebGPU watchdog + JSEP paths (no CPU wasmBinary on WebGPU)'
);

assert(
  sep.includes("worker.kind === 'hidden-renderer' ? true") &&
    sep.includes('Routing Instrumental AI to Hidden Renderer WebGPU'),
  'Hidden Renderer forces aiGpuSupported on wire; logs routing decision'
);

const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kls-webgpu-'));
const outDir = path.join(tmp, 'out');
fs.mkdirSync(outDir);

const tscBin = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
assert(fs.existsSync(tscBin), 'local typescript bin present (npm install)');

const tsc = spawnSync(
  process.execPath,
  [
    tscBin,
    '--outDir',
    outDir,
    '--module',
    'commonjs',
    '--target',
    'ES2020',
    '--esModuleInterop',
    '--skipLibCheck',
    path.join(root, 'src/shared/aiWorkerWebGpu.ts'),
    path.join(root, 'src/shared/aiOrtProviders.ts')
  ],
  { cwd: root, encoding: 'utf8' }
);
assert(tsc.status === 0, 'tsc compile aiWorkerWebGpu + aiOrtProviders', tsc.stderr || tsc.stdout);

const webgpu = require(path.join(outDir, 'aiWorkerWebGpu.js'));
const ortProv = require(path.join(outDir, 'aiOrtProviders.js'));

const probeResult = webgpu.probeWorkerWebGpu();
assert(
  probeResult && typeof probeResult.available === 'boolean' && probeResult.navigatorType,
  `probeWorkerWebGpu in Node → available=${probeResult.available} navigator=${probeResult.navigatorType}`
);
assert(
  probeResult.available === false,
  'plain Node: navigator.gpu unavailable (mirrors utilityProcess expectation)'
);

const skipped = webgpu.resolveWorkerOrtProviders({
  aiEnableGpu: true,
  aiGpuSupported: true,
  resolveProviders: ortProv.resolveAiOrtExecutionProviders
});
assert(
  JSON.stringify(skipped.providers) === JSON.stringify(['wasm']) &&
    skipped.preferWebGpu === false &&
    typeof skipped.skipWebGpuReason === 'string',
  'GPU on+supported but no navigator.gpu → wasm + skip reason'
);

const forced = webgpu.resolveWorkerOrtProviders({
  aiEnableGpu: true,
  aiGpuSupported: true,
  workerWebGpu: { available: true, navigatorType: 'object' },
  resolveProviders: ortProv.resolveAiOrtExecutionProviders
});
assert(
  JSON.stringify(forced.providers) === JSON.stringify(['webgpu', 'wasm']) &&
    forced.preferWebGpu === true,
  'when workerWebGpu.available → keep webgpu preference'
);

assert(
  webgpu.formatOrtInitError(new Error('backend not found')).includes('backend not found'),
  'formatOrtInitError preserves ORT message'
);

console.log('verify-ai-worker-webgpu-telemetry: all checks passed');
