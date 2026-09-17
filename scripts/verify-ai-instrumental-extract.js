#!/usr/bin/env node
/**
 * Focused check: Download Instrumental AI path produces
 * `{id}.instrumental.extract.wav` (orchestration wiring), without Electron/ORT.
 *
 * Run: node scripts/verify-ai-instrumental-extract.js
 *
 * Proves:
 * 1. Temp naming: {id}.extract.wav → AI → {id}.instrumental.extract.wav
 * 2. AI is invoked with extract wav (not MP4 / not AI-output name)
 * 3. Mock separator write is observed; missing write fails the pipeline
 * 4. finally cleanup removes both WAVs
 * 5. Source: parent waits for worker ready ping before postMessage (no 50ms race)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const Module = require('module');

const root = path.resolve(__dirname, '..');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('OK:', msg);
}

const aiSepSrc = fs.readFileSync(
  path.join(root, 'src/main/services/InstrumentalAiSeparator.ts'),
  'utf8'
);
const procSrc = fs.readFileSync(
  path.join(root, 'src/main/services/InstrumentalProcessor.ts'),
  'utf8'
);
const dmSrc = fs.readFileSync(path.join(root, 'src/main/services/DownloadManager.ts'), 'utf8');

// --- Source: ready-ping gate (root cause of missing AI output WAV) ---
assert(
  aiSepSrc.includes('AI_WORKER_READY_TIMEOUT_MS') &&
    aiSepSrc.includes('sendSeparate') &&
    aiSepSrc.includes('separateSent') &&
    /requestId === 0/.test(aiSepSrc) &&
    aiSepSrc.includes('sendSeparate()') &&
    !/setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]*?postMessage\(\s*\{[\s\S]*?type:\s*'separate'/.test(
      aiSepSrc
    ),
  'AI worker: separate is sent only after ready ping (not fixed 50ms postMessage)'
);
assert(
  aiSepSrc.includes('output_missing') && aiSepSrc.includes('ready_timeout'),
  'AI separator fails clearly when output missing or worker never ready'
);
assert(
  procSrc.includes('coerceInstrumentalVocalRemoverMethod') &&
    !procSrc.includes('coerceVocalRemoverMethod('),
  'InstrumentalProcessor uses instrumental coerce (AI default), not live-DSP default'
);
assert(
  procSrc.includes('Instrumental extract WAV was not produced') &&
    procSrc.includes('ai_method_selected_but_managers_missing'),
  'Processor verifies AI/algo output WAV before remux and logs AI skip reasons'
);
assert(
  dmSrc.includes('${downloadId}.extract.wav') &&
    dmSrc.includes('${downloadId}.instrumental.extract.wav') &&
    dmSrc.includes('cleanupInstrumentalRunTemps'),
  'DownloadManager cleans extract + AI output per downloadId'
);

function resolveFfmpeg() {
  try {
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) return ffmpegStatic;
  } catch {
    /* PATH */
  }
  return 'ffmpeg';
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function compileProcessor(tmp) {
  const electronStub = path.join(tmp, 'electron-stub.js');
  fs.writeFileSync(
    electronStub,
    `module.exports = {
  app: {
    getPath: (n) => require('path').join(require('os').tmpdir(), 'kls-' + n),
    getAppPath: () => process.cwd()
  },
  utilityProcess: undefined
};
`
  );

  const tscBin = path.join(root, 'node_modules/.bin/tsc');
  const outDir = path.join(tmp, 'out');
  const tsc = spawnSync(
    tscBin,
    [
      '--outDir',
      outDir,
      '--rootDir',
      path.join(root, 'src'),
      '--module',
      'commonjs',
      '--esModuleInterop',
      '--skipLibCheck',
      '--resolveJsonModule',
      '--target',
      'ES2020',
      path.join(root, 'src/main/services/InstrumentalProcessor.ts'),
      path.join(root, 'src/shared/vocalRemover.ts'),
      path.join(root, 'src/main/services/BinaryResolver.ts'),
      path.join(root, 'src/main/services/processKill.ts'),
      path.join(root, 'src/main/services/InstrumentalAiSeparator.ts'),
      path.join(root, 'src/main/ai/MdxNetSeparator.ts'),
      path.join(root, 'src/main/ai/audioFft.ts'),
      path.join(root, 'src/main/ai/wavPcm.ts'),
      path.join(root, 'src/main/ai/yieldToMain.ts'),
      path.join(root, 'src/shared/ortWasm.ts')
    ],
    { cwd: root, encoding: 'utf8', timeout: 120000 }
  );

  const compiled = path.join(outDir, 'main/services/InstrumentalProcessor.js');
  if (tsc.status !== 0 || !fs.existsSync(compiled)) {
    throw new Error(
      `tsc harness failed:\n${tsc.stderr || ''}\n${tsc.stdout || ''}`
    );
  }

  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === 'electron') return electronStub;
    return origResolve.call(this, request, parent, isMain, options);
  };

  // eslint-disable-next-line import/no-dynamic-require, global-require
  return require(compiled);
}

async function run() {
  const ffmpeg = resolveFfmpeg();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kls-ai-extract-'));
  const downloadId = 'dl_1789681690871_jczi8o';
  const mp4 = path.join(tmp, `${downloadId}.mp4`);
  const outAi = path.join(tmp, `${downloadId}.instrumental.mp4`);
  const expectedExtract = path.join(tmp, `${downloadId}.extract.wav`);
  const expectedAiOut = path.join(tmp, `${downloadId}.instrumental.extract.wav`);
  const wav = path.join(tmp, 'tone.wav');

  const mkWav = spawnSync(
    ffmpeg,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=0.8',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:duration=0.8',
      '-filter_complex',
      '[0:a][1:a]join=inputs=2:channel_layout=stereo[a]',
      '-map',
      '[a]',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-c:a',
      'pcm_s16le',
      wav
    ],
    { encoding: 'utf8' }
  );
  assert(mkWav.status === 0 && fs.existsSync(wav), 'Fixture WAV created');

  const mkMp4 = spawnSync(
    ffmpeg,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=320x240:d=0.8',
      '-i',
      wav,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      mp4
    ],
    { encoding: 'utf8' }
  );
  assert(mkMp4.status === 0 && fs.existsSync(mp4), 'Fixture MP4 created');

  let processInstrumentalVideo;
  let resolveInstrumentalTempWavPaths;
  let isDemuxExtractWavName;
  try {
    const mod = compileProcessor(tmp);
    processInstrumentalVideo = mod.processInstrumentalVideo;
    resolveInstrumentalTempWavPaths = mod.resolveInstrumentalTempWavPaths;
    isDemuxExtractWavName = mod.isDemuxExtractWavName;
  } catch (err) {
    console.error(err.message || err);
    cleanup(tmp);
    process.exit(1);
  }

  const paths = resolveInstrumentalTempWavPaths(mp4, tmp);
  assert(paths.sourceStem === downloadId, 'sourceStem is downloadId');
  assert(
    path.resolve(paths.extractedWav) === path.resolve(expectedExtract),
    'extract path is {id}.extract.wav'
  );
  assert(
    path.resolve(paths.instrumentalExtractWav) === path.resolve(expectedAiOut),
    'AI output path is {id}.instrumental.extract.wav'
  );
  assert(isDemuxExtractWavName(expectedExtract), 'extract name accepted as demux');
  assert(!isDemuxExtractWavName(expectedAiOut), 'AI output name rejected as demux input');

  // Contract: caller must pass SOURCE mp4 — remux basename would mis-stem.
  const remuxStemPaths = resolveInstrumentalTempWavPaths(outAi, tmp);
  assert(
    remuxStemPaths.sourceStem === `${downloadId}.instrumental`,
    'Remux path stem is {id}.instrumental (must not be used as source)'
  );
  assert(
    remuxStemPaths.extractedWav.endsWith(`${downloadId}.instrumental.extract.wav`),
    'Wrong source (remux) would recreate the pre-#26 extract misname'
  );

  let ensureCalled = null;
  let aiCalled = null;
  let sawExtractDuringAi = false;
  let wroteAiOut = false;
  const mockManager = {
    ensureModel: async (modelId) => {
      ensureCalled = modelId;
      return path.join(tmp, 'fake.onnx');
    }
  };
  const mockOrt = {
    ensureOrtWasm: async () => ({ ortDir: tmp }),
    getOrtDir: () => tmp
  };

  const aiResult = await processInstrumentalVideo({
    inputVideoPath: mp4,
    outputPath: outAi,
    algorithm: 'aiMdxKaraoke2',
    vocalModelManager: mockManager,
    ortWasmManager: mockOrt,
    aiSeparate: async (opts) => {
      aiCalled = opts.method;
      assert(
        path.resolve(opts.inputWav) === path.resolve(expectedExtract),
        'AI invoked with {id}.extract.wav'
      );
      assert(
        path.resolve(opts.outputWav) === path.resolve(expectedAiOut),
        'AI told to write {id}.instrumental.extract.wav'
      );
      assert(fs.existsSync(opts.inputWav), 'extract WAV exists when AI starts');
      sawExtractDuringAi = true;
      const silence = spawnSync(
        ffmpeg,
        [
          '-y',
          '-f',
          'lavfi',
          '-i',
          'anullsrc=r=44100:cl=stereo',
          '-t',
          '0.8',
          '-c:a',
          'pcm_s16le',
          opts.outputWav
        ],
        { encoding: 'utf8' }
      );
      if (silence.status !== 0) throw new Error('mock separator failed to write output WAV');
      assert(fs.existsSync(opts.outputWav) && fs.statSync(opts.outputWav).size > 1024, 'mock wrote AI output');
      wroteAiOut = true;
    }
  });

  assert(aiResult.success === true, 'AI-routed pipeline succeeded with mock separator');
  assert(ensureCalled === 'mdxKaraoke2', 'ensureModel(mdxKaraoke2) called');
  assert(aiCalled === 'aiMdxKaraoke2', 'AI separator invoked (not skipped)');
  assert(sawExtractDuringAi && wroteAiOut, 'AI saw extract and wrote instrumental.extract.wav');
  assert(fs.existsSync(outAi) && fs.statSync(outAi).size > 1024, 'remux instrumental mp4 produced');
  // finally cleanup removes both WAVs after success
  assert(!fs.existsSync(expectedExtract), 'cleanup removed extract WAV');
  assert(!fs.existsSync(expectedAiOut), 'cleanup removed AI output WAV');

  // Missing AI write must fail (regression: "AI never wrote output")
  const outMissing = path.join(tmp, `${downloadId}.missing.mp4`);
  // Need a fresh source copy — previous run deleted nothing of mp4 (only wavs); mp4 still there
  const missingResult = await processInstrumentalVideo({
    inputVideoPath: mp4,
    outputPath: outMissing,
    algorithm: 'aiMdxKaraoke2',
    vocalModelManager: mockManager,
    ortWasmManager: mockOrt,
    aiSeparate: async () => {
      // Intentionally do not write outputWav
    }
  });
  assert(
    missingResult.success === false &&
      /not written|not produced|missing\/empty|Instrumental extract WAV/i.test(
        missingResult.error || ''
      ),
    'Pipeline fails when AI separator does not write instrumental.extract.wav'
  );

  // Undefined algorithm → instrumental coerce defaults to AI (not live DSP)
  let defaultAi = false;
  await processInstrumentalVideo({
    inputVideoPath: mp4,
    outputPath: path.join(tmp, `${downloadId}.default.mp4`),
    algorithm: undefined,
    vocalModelManager: mockManager,
    ortWasmManager: mockOrt,
    aiSeparate: async (opts) => {
      defaultAi = opts.method === 'aiMdxKaraoke2';
      spawnSync(
        ffmpeg,
        [
          '-y',
          '-f',
          'lavfi',
          '-i',
          'anullsrc=r=44100:cl=stereo',
          '-t',
          '0.8',
          '-c:a',
          'pcm_s16le',
          opts.outputWav
        ],
        { encoding: 'utf8' }
      );
    }
  });
  assert(defaultAi, 'Undefined algorithm coerces to aiMdxKaraoke2 and invokes AI');

  cleanup(tmp);
  console.log('\nAll AI instrumental extract checks passed.');
}

run().catch((err) => {
  console.error('verify-ai-instrumental-extract failed:', err);
  process.exit(1);
});
