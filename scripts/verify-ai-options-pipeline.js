#!/usr/bin/env node
/**
 * Verify AI GPU-First + prune instrumental methods + Demucs advanced + locale rename.
 * Run: node scripts/verify-ai-options-pipeline.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function assert(cond, msg, detail) {
  if (!cond) {
    console.error('FAIL:', msg);
    if (detail) console.error(String(detail).slice(0, 600));
    process.exit(1);
  }
  console.log('OK:', msg);
}

const sharedOrt = fs.readFileSync(path.join(root, 'src/shared/aiOrtProviders.ts'), 'utf8');
const demucsAdv = fs.readFileSync(path.join(root, 'src/shared/demucsAdvancedSettings.ts'), 'utf8');
const vocalSrc = fs.readFileSync(path.join(root, 'src/shared/vocalRemover.ts'), 'utf8');
const typesSrc = fs.readFileSync(path.join(root, 'src/shared/types.ts'), 'utf8');
const storeSrc = fs.readFileSync(path.join(root, 'src/renderer/store/karaokeStore.ts'), 'utf8');
const settingsSrc = [
  fs.readFileSync(path.join(root, 'src/renderer/components/SettingsModal.tsx'), 'utf8'),
  fs.readFileSync(
    path.join(root, 'src/renderer/components/settings/SettingsLibraryTab.tsx'),
    'utf8'
  )
].join('\n');
const librarySrc = fs.readFileSync(
  path.join(root, 'src/renderer/components/LibraryPanel.tsx'),
  'utf8'
);
const workerSrc = fs.readFileSync(
  path.join(root, 'src/main/workers/instrumentalAiWorker.ts'),
  'utf8'
);
const mdxSrc = fs.readFileSync(path.join(root, 'src/main/ai/MdxNetSeparator.ts'), 'utf8');
const demucsSepSrc = fs.readFileSync(
  path.join(root, 'src/main/ai/demucsSeparateWithOptions.ts'),
  'utf8'
);
const sepSrc = fs.readFileSync(
  path.join(root, 'src/main/services/InstrumentalAiSeparator.ts'),
  'utf8'
);
const mainSrc = fs.readFileSync(path.join(root, 'src/main/index.ts'), 'utf8');
const preloadSrc = fs.readFileSync(path.join(root, 'src/preload/index.ts'), 'utf8');
const probeSrc = fs.readFileSync(path.join(root, 'src/main/ai/probeGpuStatus.ts'), 'utf8');

assert(
  sharedOrt.includes('resolveAiOrtExecutionProviders') &&
    sharedOrt.includes("['webgpu', 'wasm']") &&
    sharedOrt.includes("['wasm']") &&
    sharedOrt.includes('coerceAiEnableGpu'),
  'aiOrtProviders: GPU on+supported → webgpu,wasm; else wasm'
);

assert(
  demucsAdv.includes('demucsPayloadForMethod') &&
    demucsAdv.includes('coerceDemucsShifts') &&
    demucsAdv.includes('DEMUCS_DEFAULT_SEGMENT_SIZE') &&
    demucsAdv.includes('isDemucsInstrumentalMethod'),
  'demucsAdvancedSettings module present'
);

assert(
  vocalSrc.includes('INSTRUMENTAL_AI_METHODS') &&
    vocalSrc.includes("return 'aiMdxKaraoke2'") &&
    /coerceInstrumentalVocalRemoverMethod[\s\S]*InstrumentalAiMethod/.test(vocalSrc),
  'coerceInstrumentalVocalRemoverMethod → InstrumentalAiMethod (Karaoke2|HTDemucs)'
);

assert(
  typesSrc.includes('aiEnableGpu: boolean') &&
    typesSrc.includes('demucsShifts: number') &&
    typesSrc.includes('demucsSegmentSize: number') &&
    typesSrc.includes('demucsOverlap: number') &&
    /instrumentalVocalRemoverMethod:\s*'aiMdxKaraoke2'\s*\|\s*'aiHtDemucs'/.test(typesSrc),
  'AppSettings: aiEnableGpu + Demucs knobs; instrumental AI-only union'
);

assert(
  storeSrc.includes('aiEnableGpu: true') &&
    storeSrc.includes('coerceAiEnableGpu') &&
    storeSrc.includes('coerceDemucsShifts') &&
    storeSrc.includes('DEMUCS_DEFAULT_OVERLAP'),
  'Store defaults + coerce GPU/Demucs'
);

assert(
  settingsSrc.includes('aiEnableGpu') &&
    settingsSrc.includes('getGpuStatus') &&
    settingsSrc.includes('aiGpuBadgeGpu') &&
    settingsSrc.includes('isDemucsInstrumentalMethod') &&
    settingsSrc.includes('demucsAdvancedTitle') &&
    settingsSrc.includes("value=\"aiMdxKaraoke2\"") &&
    settingsSrc.includes("value=\"aiHtDemucs\"") &&
    !settingsSrc.includes("value=\"aiBsRoformer\"") &&
    !/instrumentalVocalRemoverMethod[\s\S]{0,800}vocalGroupAlgorithmic/.test(settingsSrc),
  'Settings: GPU toggle+badge; Demucs panel; download select AI-only (no DSP/Roformer)'
);

assert(
  librarySrc.includes('demucsShifts: settings.demucsShifts') &&
    librarySrc.includes('aiEnableGpu: settings.aiEnableGpu') &&
    librarySrc.includes('isDemucs') &&
    !librarySrc.includes("method === 'aiBsRoformer'"),
  'LibraryPanel sends Demucs/GPU knobs; no Roformer isAi branch'
);

assert(
  mainSrc.includes('system:get-gpu-status') &&
    preloadSrc.includes('getGpuStatus') &&
    probeSrc.includes('getGPUFeatureStatus') &&
    mainSrc.includes('aiGpuSupported') &&
    mainSrc.includes('coerceDemucsShifts'),
  'IPC GPU probe + download:start Demucs/GPU wiring'
);

assert(
  mdxSrc.includes('resolveAiOrtExecutionProviders') &&
    (mdxSrc.includes('resolveWorkerOrtProviders') ||
      mdxSrc.includes("preferGpu ? ['webgpu', 'wasm'] : ['wasm']") ||
      mdxSrc.includes("executionProviders: ['webgpu']")) &&
    (mdxSrc.includes("graphOptimizationLevel: this.enableOrtAcceleration ? 'all' : 'disabled'") ||
      mdxSrc.includes("this.enableOrtAcceleration ? 'all' : 'disabled'")) &&
    mdxSrc.includes('ort.env.wasm.numThreads = this.numThreads'),
  'MdxNetSeparator: providers from GPU flag; graph opts; numThreads'
);

assert(
  workerSrc.includes('resolveAiOrtExecutionProviders') &&
    workerSrc.includes('separateDemucsWithAdvancedOptions') &&
    workerSrc.includes('demucsShifts') &&
    workerSrc.includes('ort.env.wasm.numThreads = threads') &&
    demucsSepSrc.includes('demucsOverlap') &&
    demucsSepSrc.includes('SEGMENT_OVERLAP'),
  'Worker Demucs injects shifts/segment/overlap; sets numThreads'
);

assert(
  sepSrc.includes('demucsPayloadForMethod') &&
    sepSrc.includes('mdxPayloadForMethod') &&
    sepSrc.includes('aiEnableGpu') &&
    sepSrc.includes('demucsAdvanced'),
  'InstrumentalAiSeparator payload separation MDX vs Demucs + GPU'
);

// Compile shared modules and assert runtime behavior
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kls-ai-opts-'));
const outDir = path.join(tmp, 'out');
fs.mkdirSync(outDir);

function tscFile(rel) {
  const r = spawnSync(
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
      path.join(root, rel)
    ],
    { cwd: root, encoding: 'utf8' }
  );
  assert(r.status === 0, `tsc compile ${rel}`, (r.stderr || r.stdout || '').slice(0, 400));
}

tscFile('src/shared/aiOrtProviders.ts');
tscFile('src/shared/demucsAdvancedSettings.ts');
tscFile('src/shared/mdxAdvancedSettings.ts');
tscFile('src/shared/vocalRemover.ts');
tscFile('src/shared/aiCpuThreads.ts');

const ortProv = require(path.join(outDir, 'aiOrtProviders.js'));
const demucs = require(path.join(outDir, 'demucsAdvancedSettings.js'));
const mdx = require(path.join(outDir, 'mdxAdvancedSettings.js'));
const vocal = require(path.join(outDir, 'vocalRemover.js'));
const threads = require(path.join(outDir, 'aiCpuThreads.js'));

assert(
  JSON.stringify(ortProv.resolveAiOrtExecutionProviders(true, true)) ===
    JSON.stringify(['webgpu', 'wasm']),
  'GPU on + supported → [webgpu, wasm]'
);
assert(
  JSON.stringify(ortProv.resolveAiOrtExecutionProviders(true, false)) ===
    JSON.stringify(['wasm']),
  'GPU on + unsupported → [wasm]'
);
assert(
  JSON.stringify(ortProv.resolveAiOrtExecutionProviders(false, true)) ===
    JSON.stringify(['wasm']),
  'GPU off + supported → [wasm]'
);
assert(ortProv.coerceAiEnableGpu(undefined) === true, 'aiEnableGpu default true');
assert(ortProv.coerceAiEnableGpu(false) === false, 'aiEnableGpu false');

assert(threads.resolveAiCpuThreads(null, 8) === 8, 'null threads → all cores');
assert(threads.resolveAiCpuThreads(2, 8) === 2, 'threads 2 → 2');
assert(threads.resolveAiCpuThreads(99, 4) === 4, 'threads clamp to N');

assert(mdx.coerceMdxSegmentSize(512) === 512, 'MDX segment 512');
assert(mdx.coerceMdxOverlap(0.5) === 0.5, 'MDX overlap 0.5');
assert(mdx.coerceMdxEnableOrt(false) === false, 'MDX enableOrt false');
assert(
  mdx.mdxPayloadForMethod('aiHtDemucs', { mdxSegmentSize: 512 }) === undefined,
  'Demucs method: MDX payload omitted'
);
const mdxPay = mdx.mdxPayloadForMethod('aiMdxKaraoke2', {
  mdxSegmentSize: 256,
  mdxOverlap: 0.25,
  mdxEnableOrt: true
});
assert(mdxPay && mdxPay.mdxSegmentSize === 256, 'MDX payload present for Karaoke2');

assert(demucs.coerceDemucsShifts(5) === 2, 'Demucs shifts clamp max 2');
assert(demucs.coerceDemucsShifts(-1) === 0, 'Demucs shifts clamp min 0');
assert(demucs.coerceDemucsSegmentSize(3) === 5, 'Demucs segment min 5');
assert(demucs.coerceDemucsSegmentSize(30) === 20, 'Demucs segment max 20');
assert(demucs.coerceDemucsOverlap(0.01) === 0.1, 'Demucs overlap min 0.10');
assert(demucs.coerceDemucsOverlap(0.9) === 0.5, 'Demucs overlap max 0.50');
assert(
  demucs.demucsPayloadForMethod('aiMdxKaraoke2', { demucsShifts: 2 }) === undefined,
  'MDX method: Demucs payload omitted'
);
const dPay = demucs.demucsPayloadForMethod('aiHtDemucs', {
  demucsShifts: 1,
  demucsSegmentSize: 10,
  demucsOverlap: 0.3
});
assert(dPay && dPay.demucsShifts === 1 && dPay.demucsSegmentSize === 10, 'Demucs payload injected');

assert(
  vocal.coerceInstrumentalVocalRemoverMethod('aiBsRoformer') === 'aiMdxKaraoke2',
  'coerce Roformer → Karaoke2'
);
assert(
  vocal.coerceInstrumentalVocalRemoverMethod('centerCancelBassKeep') === 'aiMdxKaraoke2',
  'coerce DSP → Karaoke2'
);
assert(
  vocal.coerceInstrumentalVocalRemoverMethod('aiHtDemucs') === 'aiHtDemucs',
  'coerce HTDemucs kept'
);
assert(
  vocal.coerceInstrumentalVocalRemoverMethod('garbage') === 'aiMdxKaraoke2',
  'coerce unknown → Karaoke2'
);

// Locale rename Experimental → Basic Algorithm (+ ES/FR equivalents)
const en = JSON.parse(fs.readFileSync(path.join(root, 'locales/en.json'), 'utf8'));
const it = JSON.parse(fs.readFileSync(path.join(root, 'locales/it.json'), 'utf8'));
const es = JSON.parse(fs.readFileSync(path.join(root, 'locales/es.json'), 'utf8'));
const fr = JSON.parse(fs.readFileSync(path.join(root, 'locales/fr.json'), 'utf8'));

assert(
  /Basic Algorithm/i.test(en.player.vocalRemover) &&
    /Basic Algorithm/i.test(en.settings.vocalRemoverAlgorithm) &&
    !/Experimental/i.test(en.player.vocalRemover) &&
    !/Experimental/i.test(en.settings.vocalAiHtDemucs),
  'EN: Basic Algorithm; no Experimental on player/Demucs blurb'
);
assert(
  /Algoritmo Base/i.test(it.player.vocalRemover) &&
    /Algoritmo Base/i.test(it.settings.vocalRemoverAlgorithm) &&
    !/Sperimentale/i.test(it.player.vocalRemover) &&
    !/Sperimentale/i.test(it.settings.vocalAiHtDemucs),
  'IT: Algoritmo Base; no Sperimentale on player/Demucs blurb'
);
assert(
  /Algoritmo Básico/i.test(es.player.vocalRemover) &&
    /Algoritmo Básico/i.test(es.settings.vocalRemoverAlgorithm),
  'ES: Algoritmo Básico'
);
assert(
  /Algorithme de Base/i.test(fr.player.vocalRemover) &&
    /Algorithme de Base/i.test(fr.settings.vocalRemoverAlgorithm),
  'FR: Algorithme de Base'
);
assert(
  en.settings.demucsAdvancedTitle &&
    it.settings.aiEnableGpu &&
    es.settings.demucsShifts &&
    fr.settings.aiGpuBadgeGpu,
  'All langs have Demucs + GPU i18n keys'
);

console.log('verify-ai-options-pipeline: all checks passed');
