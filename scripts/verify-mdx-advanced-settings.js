#!/usr/bin/env node
/**
 * Coerce/validate MDX advanced ETA settings + conditional payload for non-MDX methods.
 * Run: node scripts/verify-mdx-advanced-settings.js
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

const sharedSrc = fs.readFileSync(path.join(root, 'src/shared/mdxAdvancedSettings.ts'), 'utf8');
const storeSrc = fs.readFileSync(path.join(root, 'src/renderer/store/karaokeStore.ts'), 'utf8');
const settingsSrc = [
  fs.readFileSync(path.join(root, 'src/renderer/components/SettingsModal.tsx'), 'utf8'),
  fs.readFileSync(path.join(root, 'src/renderer/components/settings/SettingsLibraryTab.tsx'), 'utf8'),
  fs.readFileSync(path.join(root, 'src/renderer/components/settings/SettingsAudioTab.tsx'), 'utf8')
].join('\n');
const librarySrc = fs.readFileSync(
  path.join(root, 'src/renderer/components/LibraryPanel.tsx'),
  'utf8'
);
const workerSrc = fs.readFileSync(
  path.join(root, 'src/main/workers/instrumentalAiSeparateCore.ts'),
  'utf8'
);
const sepSrc = fs.readFileSync(
  path.join(root, 'src/main/services/InstrumentalAiSeparator.ts'),
  'utf8'
);
const mdxSrc = fs.readFileSync(path.join(root, 'src/main/ai/MdxNetSeparator.ts'), 'utf8');
const typesSrc = fs.readFileSync(path.join(root, 'src/shared/types.ts'), 'utf8');

assert(sharedSrc.includes('coerceMdxSegmentSize'), 'coerceMdxSegmentSize exported');
assert(sharedSrc.includes('coerceMdxOverlap'), 'coerceMdxOverlap exported');
assert(sharedSrc.includes('coerceMdxEnableOrt'), 'coerceMdxEnableOrt exported');
assert(sharedSrc.includes('mdxPayloadForMethod'), 'mdxPayloadForMethod exported');
assert(sharedSrc.includes('MDX_DEFAULT_SEGMENT_SIZE') && sharedSrc.includes('256'), 'Default segment 256');
assert(sharedSrc.includes('MDX_DEFAULT_OVERLAP = 0.25'), 'Default overlap 0.25');
assert(sharedSrc.includes('MDX_DEFAULT_ENABLE_ORT = true'), 'Default enableOrt true');

assert(typesSrc.includes('mdxSegmentSize: number'), 'AppSettings has mdxSegmentSize');
assert(typesSrc.includes('mdxOverlap: number'), 'AppSettings has mdxOverlap');
assert(typesSrc.includes('mdxEnableOrt: boolean'), 'AppSettings has mdxEnableOrt');

assert(
  storeSrc.includes('mdxSegmentSize: MDX_DEFAULT_SEGMENT_SIZE') &&
    storeSrc.includes('coerceMdxSegmentSize') &&
    storeSrc.includes('coerceMdxOverlap') &&
    storeSrc.includes('coerceMdxEnableOrt'),
  'Store defaults + coerce MDX advanced settings'
);

assert(
  settingsSrc.includes('mdxAdvancedTitle') &&
    settingsSrc.includes('isMdxInstrumentalMethod') &&
    settingsSrc.includes('MDX_OVERLAP_WARN_THRESHOLD') &&
    settingsSrc.includes('mdxOverlapHighWarning'),
  'SettingsModal MDX advanced panel + high-overlap warning'
);

assert(
  librarySrc.includes("method === 'aiMdxKaraoke2'") &&
    librarySrc.includes('mdxSegmentSize: settings.mdxSegmentSize') &&
    librarySrc.includes('mdxOverlap: settings.mdxOverlap'),
  'LibraryPanel sends MDX knobs only for aiMdxKaraoke2'
);

assert(
  sepSrc.includes('mdxPayloadForMethod') && sepSrc.includes('mdxAdvanced'),
  'InstrumentalAiSeparator attaches MDX payload via mdxPayloadForMethod'
);

assert(
  workerSrc.includes('coerceMdxAdvancedSettings') &&
    (workerSrc.includes('new MdxNetSeparator(advanced)') ||
      workerSrc.includes('new MdxNetSeparator({')),
  'Worker wires MDX opts into separator; Demucs ignores knobs'
);

assert(
  mdxSrc.includes('mdxStepSamples(cfg.mdxOverlap') &&
    mdxSrc.includes('enableOrtAcceleration') &&
    (mdxSrc.includes("graphOptimizationLevel: this.enableOrtAcceleration ? 'all' : 'disabled'") ||
      mdxSrc.includes("this.enableOrtAcceleration ? 'all' : 'disabled'")),
  'MdxNetSeparator maps overlap fraction → step; ORT toggle controls graph opts + SIMD'
);

// Compile shared coerce module and assert runtime behavior
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kls-mdx-adv-'));
const outShared = path.join(tmp, 'shared');
const outGeom = path.join(tmp, 'geom');
fs.mkdirSync(outShared);
fs.mkdirSync(outGeom);

const tscShared = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  [
    'tsc',
    '--outDir',
    outShared,
    '--module',
    'commonjs',
    '--target',
    'ES2020',
    '--esModuleInterop',
    '--skipLibCheck',
    path.join(root, 'src/shared/mdxAdvancedSettings.ts')
  ],
  { cwd: root, encoding: 'utf8' }
);
assert(
  tscShared.status === 0,
  'tsc compile mdxAdvancedSettings',
  (tscShared.stderr || tscShared.stdout || '').slice(0, 400)
);

const tscGeom = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  [
    'tsc',
    '--outDir',
    outGeom,
    '--module',
    'commonjs',
    '--target',
    'ES2020',
    '--esModuleInterop',
    '--skipLibCheck',
    path.join(root, 'src/main/ai/mdxUvrGeometry.ts')
  ],
  { cwd: root, encoding: 'utf8' }
);
assert(
  tscGeom.status === 0,
  'tsc compile mdxUvrGeometry',
  (tscGeom.stderr || tscGeom.stdout || '').slice(0, 400)
);

const adv = require(path.join(outShared, 'mdxAdvancedSettings.js'));
const geom = require(path.join(outGeom, 'mdxUvrGeometry.js'));

assert(adv.coerceMdxSegmentSize(undefined) === 256, 'segment default 256');
assert(adv.coerceMdxSegmentSize(200) === 256, 'segment snaps to nearest power of 2');
assert(adv.coerceMdxSegmentSize(480) === 512, 'segment 480 → 512');
assert(adv.coerceMdxSegmentSize(9999) === 1024, 'segment clamps max 1024');
assert(adv.coerceMdxSegmentSize(10) === 64, 'segment clamps min 64');

assert(adv.coerceMdxOverlap(undefined) === 0.25, 'overlap default 0.25');
assert(adv.coerceMdxOverlap(0) === 0.1, 'overlap clamps min 0.10');
assert(adv.coerceMdxOverlap(1.5) === 0.99, 'overlap clamps max 0.99');
assert(adv.coerceMdxOverlap(0.753) === 0.75, 'overlap rounds to 0.01');

assert(adv.coerceMdxEnableOrt(undefined) === true, 'enableOrt default true');
assert(adv.coerceMdxEnableOrt(false) === false, 'enableOrt false');
assert(adv.coerceMdxEnableOrt('off') === false, 'enableOrt off string');

assert(
  adv.mdxPayloadForMethod('aiHtDemucs', { mdxSegmentSize: 512, mdxOverlap: 0.5 }) === undefined,
  'Demucs: mdxPayloadForMethod returns undefined (no MDX params)'
);
assert(
  adv.mdxPayloadForMethod('aiBsRoformer', { mdxSegmentSize: 512 }) === undefined,
  'Roformer: no MDX params in payload'
);
assert(
  adv.mdxPayloadForMethod('centerCancelBassKeep', {}) === undefined,
  'Algorithmic: no MDX params in payload'
);

const mdxPayload = adv.mdxPayloadForMethod('aiMdxKaraoke2', {
  mdxSegmentSize: 512,
  mdxOverlap: 0.5,
  mdxEnableOrt: false
});
assert(mdxPayload && mdxPayload.mdxSegmentSize === 512, 'MDX payload segment 512');
assert(mdxPayload.mdxOverlap === 0.5, 'MDX payload overlap 0.5');
assert(mdxPayload.mdxEnableOrt === false, 'MDX payload enableOrt false');

// Overlap → step mapping (Karaoke 2 dim_t=256 → chunk 261120)
const CHUNK = geom.mdxChunkSize(1024, 256);
assert(CHUNK === 261120, 'chunk_size for dim_t=256');
assert(geom.mdxStepSamples(0.25, CHUNK) === Math.floor(0.75 * CHUNK), 'overlap 0.25 → step 195840');
assert(geom.mdxStepSamples(0.25, CHUNK) === 195840, 'step exactly 195840');
assert(geom.mdxStepSamples(0.5, CHUNK) === Math.floor(0.5 * CHUNK), 'overlap 0.50 → half chunk');
assert(
  geom.mdxStepSamples(0.25, CHUNK) < geom.mdxStepSamples('default', CHUNK),
  '0.25 overlap has smaller hop (more windows) than UVR Default'
);

// Segment size changes chunk_size
const chunk512 = geom.mdxChunkSize(1024, 512);
assert(chunk512 === 1024 * 511, 'dim_t=512 → larger chunk');
assert(geom.mdxStepSamples(0.25, chunk512) === Math.floor(0.75 * chunk512), 'overlap maps on custom dim_t');

// Locale keys present in all 4 langs
for (const lang of ['en', 'it', 'es', 'fr']) {
  const loc = JSON.parse(fs.readFileSync(path.join(root, `locales/${lang}.json`), 'utf8'));
  assert(
    loc.settings.mdxAdvancedTitle &&
      loc.settings.mdxSegmentSizeTooltip &&
      loc.settings.mdxOverlapHighWarning &&
      loc.settings.mdxEnableOrtDesc,
    `Locale ${lang} has MDX advanced i18n keys`
  );
}
assert(
  JSON.parse(fs.readFileSync(path.join(root, 'locales/it.json'), 'utf8')).settings
    .mdxAdvancedTitle === 'Impostazioni Avanzate UVR-MDX-NET (Ottimizzazione ETA)',
  'IT advanced panel title matches Luca wording'
);

console.log('verify-mdx-advanced-settings: all checks passed');
