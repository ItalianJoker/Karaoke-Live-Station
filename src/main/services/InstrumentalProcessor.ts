/**
 * Offline instrumental pipeline for downloaded videos.
 *
 * 1. Demux audio to PCM WAV via ffmpeg
 * 2. Remove vocals:
 *    - AI methods → OfflineVocalModelManager + utility-process ORT (Download Instrumental)
 *    - Algorithmic → ffmpeg mid/side filter matching AlgorithmicVocalRemoverNode
 * 3. Remux original video with instrumental audio (optional subtitle burn-in)
 *
 * Live Rimozione Vocale stays algorithmic in the renderer — this module is download-only.
 *
 * AI path contract: ORT/MDX/HTDemucs always receive the demuxed PCM WAV
 * (`{downloadId}.extract.wav`), never the source MP4 and never the AI output
 * (`{downloadId}.instrumental.extract.wav`). Remux muxes that AI WAV onto the
 * original video → `{downloadId}.instrumental.mp4`.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  coerceAlgorithmicVocalRemoverMethod,
  coerceInstrumentalVocalRemoverMethod,
  isAiVocalRemoverMethod,
  methodToModelId,
  OFFLINE_VOCAL_MODELS,
  type AlgorithmicVocalRemoverMethod,
  type AiVocalRemoverMethod
} from '../../shared/vocalRemover';
import { mdxPayloadForMethod } from '../../shared/mdxAdvancedSettings';
import { demucsPayloadForMethod } from '../../shared/demucsAdvancedSettings';
import { resolveFfmpegPath } from './BinaryResolver';
import { separateInstrumentalWithAi } from './InstrumentalAiSeparator';
import { isAbortError, killProcessTree, throwIfAborted } from './processKill';
import type { OfflineVocalModelManager } from './OfflineVocalModelManager';
import type { OrtWasmManager } from './OrtWasmManager';
import type { Logger } from './Logger';
import { readPcmWavDurationSec } from '../ai/wavPcm';

/** Safe size probe for debug logs (null when missing/unreadable). */
export function safeFileSizeBytes(filePath: string | null | undefined): number | null {
  if (!filePath) return null;
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
}

/**
 * Temp sidecar names for Download Instrumental.
 * Stem = basename of the staged source MP4 (e.g. `dl_1789681690871_jczi8o`):
 *   - demux / AI input:  `{stem}.extract.wav`
 *   - AI/algo output:    `{stem}.instrumental.extract.wav`
 * Never derive the demux path from the remux basename (`{stem}.instrumental.mp4`) —
 * that wrongly produced `{stem}.instrumental.extract.wav` as the extract step.
 */
export function resolveInstrumentalTempWavPaths(
  sourceMp4: string,
  workDir?: string
): { sourceStem: string; extractedWav: string; instrumentalExtractWav: string } {
  const dir = workDir || path.dirname(path.resolve(sourceMp4));
  const sourceStem = path.basename(path.resolve(sourceMp4), path.extname(sourceMp4));
  return {
    sourceStem,
    extractedWav: path.join(dir, `${sourceStem}.extract.wav`),
    instrumentalExtractWav: path.join(dir, `${sourceStem}.instrumental.extract.wav`)
  };
}

/**
 * Basename check for the demux extract WAV (`*.extract.wav`).
 * Rejects the AI output name (`*.instrumental.extract.wav`) and video paths.
 */
export function isDemuxExtractWavName(filePath: string): boolean {
  const base = path.basename(filePath || '').toLowerCase();
  if (!base.endsWith('.extract.wav')) return false;
  if (base.endsWith('.instrumental.extract.wav')) return false;
  return true;
}

/**
 * True when `candidate` is the demuxed extract WAV for this pipeline (not the MP4
 * and not the AI output `*.instrumental.extract.wav`).
 */
export function isExtractedWavPath(
  candidate: string,
  extractedWav: string,
  sourceMp4: string
): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedExtract = path.resolve(extractedWav);
  const resolvedMp4 = path.resolve(sourceMp4);
  if (resolvedCandidate === resolvedMp4) return false;
  if (resolvedCandidate !== resolvedExtract) return false;
  return isDemuxExtractWavName(resolvedCandidate);
}

export type InstrumentalProcessPhase =
  | 'extracting'
  | 'ensuring_model'
  | 'removing_vocals'
  | 'remuxing';

export type InstrumentalProcessOptions = {
  inputVideoPath: string;
  outputPath: string;
  algorithm?: string;
  /** Optional .srt / .ass / .vtt for burn-in */
  subtitlePath?: string | null;
  onProgress?: (phase: InstrumentalProcessPhase, percent: number) => void;
  /**
   * Optional ETA (seconds remaining) during AI vocal removal, derived from
   * observed chunk progress — Download menu binds this to `payload.eta`.
   */
  onAiEta?: (etaSec: number) => void;
  /** Required when algorithm is an AI method */
  vocalModelManager?: OfflineVocalModelManager;
  ortWasmManager?: OrtWasmManager;
  logger?: Logger;
  /** When aborted, ffmpeg/AI jobs are killed and the pipeline returns cancelled. */
  signal?: AbortSignal;
  /**
   * Test/DI hook: replace the real utility-process AI separator.
   * Production callers omit this — {@link separateInstrumentalWithAi} is used.
   */
  aiSeparate?: typeof separateInstrumentalWithAi;
  /**
   * MDX-only advanced knobs (aiMdxKaraoke2). Ignored for other methods.
   * Passed through to {@link separateInstrumentalWithAi} / worker.
   */
  mdxSegmentSize?: number;
  mdxOverlap?: number;
  mdxEnableOrt?: boolean;
  /** Demucs-only advanced knobs (aiHtDemucs). */
  demucsShifts?: number;
  demucsSegmentSize?: number;
  demucsOverlap?: number;
  /** Resolved ORT WASM thread count (AI methods). */
  aiCpuThreads?: number;
  /** GPU-First toggle + probe snapshot. */
  aiEnableGpu?: boolean;
  aiGpuSupported?: boolean;
};

export type InstrumentalProcessResult = {
  success: boolean;
  outputPath?: string;
  lyricsBurned?: boolean;
  error?: string;
  cancelled?: boolean;
};

/**
 * Builds an ffmpeg filter_complex that mirrors AlgorithmicVocalRemoverNode mid/side DSP.
 * mid = (L+R)/2, side = (L−R)/2; then band-split mid and decode back to stereo.
 */
export function buildAlgorithmicVocalRemoverFilter(
  algorithm: AlgorithmicVocalRemoverMethod
): string {
  let low = 1;
  let high = 0.05;
  let side = 1.15;

  switch (algorithm) {
    case 'centerCancel':
      low = 0;
      high = 0;
      side = 1.25;
      break;
    case 'softMid':
      low = 0.85;
      high = 0.28;
      side = 1.05;
      break;
    case 'centerCancelBassKeep':
    default:
      low = 1;
      high = 0.05;
      side = 1.15;
      break;
  }

  return [
    `[0:a]asplit=2[orig][orig2]`,
    `[orig]pan=mono|c0=0.5*c0+0.5*c1[mid]`,
    `[orig2]pan=mono|c0=0.5*c0-0.5*c1[side]`,
    `[mid]asplit=2[midlo][midhi]`,
    `[midlo]lowpass=f=160,volume=${low}[bass]`,
    `[midhi]highpass=f=160,volume=${high}[vband]`,
    `[bass][vband]amix=inputs=2:normalize=0[midf]`,
    `[side]volume=${side}[sidef]`,
    `[midf][sidef]join=inputs=2:channel_layout=stereo:map=0.0-FL|1.0-FR[ms]`,
    `[ms]pan=stereo|c0=c0+c1|c1=c0-c1[aout]`
  ].join(';');
}

/**
 * Spawn ffmpeg so cancel can kill the process tree (execFile cannot be aborted mid-run).
 */
async function runFfmpeg(
  args: string[],
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 20 * 60 * 1000;
  const signal = options?.signal;
  throwIfAborted(signal);

  const ffmpegBin = resolveFfmpegPath();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    });

    let settled = false;
    let stderr = '';
    const timer = setTimeout(() => {
      killProcessTree(child);
      fail(new Error(`ffmpeg timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(err);
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };

    const onAbort = () => {
      killProcessTree(child);
      const err = new Error('Aborted');
      err.name = 'AbortError';
      fail(err);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 64 * 1024) stderr = stderr.slice(-32 * 1024);
    });

    child.on('error', (err) => fail(err));
    child.on('close', (code) => {
      if (settled) return;
      if (code === 0) succeed();
      else fail(new Error(`ffmpeg exited with code ${code}: ${stderr.trim().slice(-500)}`));
    });
  });
}

function safeUnlink(filePath: string | undefined | null): void {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore cleanup races
  }
}

/**
 * Finds a subtitle file written next to a yt-dlp download (same basename stem).
 */
export function findSiblingSubtitle(videoPath: string): string | null {
  const dir = path.dirname(videoPath);
  const stem = path.basename(videoPath, path.extname(videoPath));
  try {
    const entries = fs.readdirSync(dir);
    const preferred = entries.find((name) => {
      const lower = name.toLowerCase();
      return (
        name.startsWith(stem) &&
        (lower.endsWith('.srt') || lower.endsWith('.ass') || lower.endsWith('.vtt'))
      );
    });
    return preferred ? path.join(dir, preferred) : null;
  } catch {
    return null;
  }
}

async function removeVocalsAlgorithmic(
  extractedWav: string,
  instrumentalWav: string,
  algorithm: AlgorithmicVocalRemoverMethod,
  signal?: AbortSignal
): Promise<void> {
  const filter = buildAlgorithmicVocalRemoverFilter(algorithm);
  await runFfmpeg(
    [
      '-y',
      '-i',
      extractedWav,
      '-filter_complex',
      filter,
      '-map',
      '[aout]',
      '-ac',
      '2',
      '-ar',
      '44100',
      '-c:a',
      'pcm_s16le',
      instrumentalWav
    ],
    { signal }
  );
}

async function removeVocalsAi(
  sourceMp4: string,
  extractedWav: string,
  instrumentalWav: string,
  method: AiVocalRemoverMethod,
  options: InstrumentalProcessOptions,
  report: (phase: InstrumentalProcessPhase, percent: number) => void,
  stageClock: { mark: (stage: string, data?: Record<string, unknown>) => void }
): Promise<void> {
  const { vocalModelManager, ortWasmManager, logger } = options;
  if (!vocalModelManager || !ortWasmManager) {
    throw new Error('AI instrumental separation requires OfflineVocalModelManager + OrtWasmManager');
  }

  // Hard guard: AI must consume demuxed WAV (`{stem}.extract.wav`), never the
  // source MP4 and never the AI output (`{stem}.instrumental.extract.wav`).
  if (!isExtractedWavPath(extractedWav, extractedWav, sourceMp4)) {
    throw new Error(
      `AI vocal separation refused non-extract input (expected {stem}.extract.wav). ` +
        `sourceMp4=${sourceMp4} extractedWav=${extractedWav}`
    );
  }
  if (!isDemuxExtractWavName(extractedWav)) {
    throw new Error(
      `AI input must be named {stem}.extract.wav (not instrumental.extract): ${extractedWav}`
    );
  }
  if (!fs.existsSync(extractedWav)) {
    throw new Error(`Extracted WAV missing before AI separation: ${extractedWav}`);
  }

  const modelId = methodToModelId(method);
  const catalog = OFFLINE_VOCAL_MODELS[modelId];
  throwIfAborted(options.signal);
  report('ensuring_model', 20);
  stageClock.mark('ensuring_model_start', {
    method,
    modelId,
    modelVersion: catalog?.version,
    modelLabel: catalog?.label,
    sourceMp4,
    extractedWav,
    extractedWavBytes: safeFileSizeBytes(extractedWav),
    aiInputPath: extractedWav,
    aiInputIsExtractWav: true,
    aiInputMatchesSourceMp4: false
  });
  // ensureModel skips download when local userData/models copy is already current
  // (URL/SHA/version match); only fetches when missing, corrupt, or newer remote.
  const modelPath = await vocalModelManager.ensureModel(modelId, { signal: options.signal });
  throwIfAborted(options.signal);
  report('ensuring_model', 40);
  stageClock.mark('ensuring_model_ready', {
    modelId,
    modelPath,
    modelBytes: safeFileSizeBytes(modelPath),
    modelVersion: catalog?.version
  });
  const ortPaths = await ortWasmManager.ensureOrtWasm();
  const ortDir = ortPaths.ortDir || ortWasmManager.getOrtDir();
  stageClock.mark('ort_ready', {
    ortDir,
    ortWasmBytes: safeFileSizeBytes(path.join(ortDir, 'ort-wasm-simd-threaded.wasm')),
    ortBackend: 'wasm',
    ortNumThreads: options.aiCpuThreads ?? 1
  });

  throwIfAborted(options.signal);
  report('removing_vocals', 45);
  let durationSec = 0;
  try {
    durationSec = readPcmWavDurationSec(extractedWav);
  } catch {
    durationSec = 0;
  }
  const aiSeparate = options.aiSeparate || separateInstrumentalWithAi;
  const aiStartedAt = Date.now();
  // Phase-aware floors so model-ready (progress=1) then separate(0) never snaps the bar
  // back to 45% — that reset made Rimozione voce look frozen during the first MDX chunk.
  let lastAiPct = 45;
  let lastLoggedPhase: string | null = null;
  let lastLoggedPctBucket = -1;

  logger?.debug('InstrumentalProcessor', 'AI separation input path check', {
    sourceMp4,
    sourceMp4Bytes: safeFileSizeBytes(sourceMp4),
    extractedWav,
    extractedWavBytes: safeFileSizeBytes(extractedWav),
    aiInputPath: extractedWav,
    aiOutputWav: instrumentalWav,
    aiInputEqualsExtractedWav: path.resolve(extractedWav) === path.resolve(extractedWav),
    aiInputEqualsSourceMp4: path.resolve(extractedWav) === path.resolve(sourceMp4),
    aiInputIsDemuxExtractName: isDemuxExtractWavName(extractedWav),
    aiOutputIsInstrumentalExtractName: path
      .basename(instrumentalWav)
      .toLowerCase()
      .endsWith('.instrumental.extract.wav'),
    durationSec: durationSec || null
  });

  stageClock.mark('ai_separate_start', {
    method,
    modelId,
    modelPath,
    ortDir,
    sourceMp4,
    extractedWav,
    aiInputPath: extractedWav,
    outputWav: instrumentalWav,
    durationSec: durationSec || null
  });

  await aiSeparate(
    {
      method,
      modelPath,
      ortDir,
      // Explicit: demuxed extract WAV only — never sourceMp4.
      inputWav: extractedWav,
      outputWav: instrumentalWav,
      signal: options.signal,
      durationSec: durationSec > 0 ? durationSec : undefined,
      aiCpuThreads: options.aiCpuThreads,
      aiEnableGpu: options.aiEnableGpu,
      aiGpuSupported: options.aiGpuSupported,
      // MDX knobs only when method is aiMdxKaraoke2; undefined for Demucs.
      ...mdxPayloadForMethod(method, {
        mdxSegmentSize: options.mdxSegmentSize,
        mdxOverlap: options.mdxOverlap,
        mdxEnableOrt: options.mdxEnableOrt
      }),
      // Demucs knobs only when method is aiHtDemucs; undefined for MDX.
      ...demucsPayloadForMethod(method, {
        demucsShifts: options.demucsShifts,
        demucsSegmentSize: options.demucsSegmentSize,
        demucsOverlap: options.demucsOverlap
      }),
      onProgress: (info) => {
        const ratio = Math.max(0, Math.min(1, info.progress));
        let mapped: number;
        switch (info.phase) {
          case 'decode':
            mapped = 45 + ratio * 3; // 45–48
            break;
          case 'model':
            mapped = 48 + ratio * 4; // 48–52
            break;
          case 'separate':
            mapped = 52 + ratio * 18; // 52–70
            break;
          case 'ready':
            mapped = 70;
            break;
          default:
            mapped = 45 + ratio * 25;
            break;
        }
        lastAiPct = Math.max(lastAiPct, mapped);
        report('removing_vocals', lastAiPct);

        // Debug: phase transitions + ~10% separate buckets (avoid flooding every chunk).
        const pctBucket = Math.floor(ratio * 10);
        const phaseChanged = info.phase !== lastLoggedPhase;
        const bucketChanged = info.phase === 'separate' && pctBucket !== lastLoggedPctBucket;
        if (phaseChanged || bucketChanged) {
          lastLoggedPhase = info.phase;
          if (info.phase === 'separate') lastLoggedPctBucket = pctBucket;
          logger?.debug('InstrumentalProcessor', 'AI separation progress', {
            phase: info.phase,
            progress: ratio,
            mappedPercent: lastAiPct,
            message: info.message,
            elapsedMs: Date.now() - aiStartedAt,
            aiInputPath: extractedWav
          });
        }

        // Surface conversion ETA from observed separate-phase velocity
        if (
          info.phase === 'separate' &&
          ratio > 0.02 &&
          typeof options.onAiEta === 'function'
        ) {
          const elapsed = (Date.now() - aiStartedAt) / 1000;
          const remaining = elapsed * ((1 - ratio) / ratio);
          if (Number.isFinite(remaining) && remaining >= 0) {
            options.onAiEta(remaining);
          }
        }
      }
    },
    logger
  );

  const outBytes = safeFileSizeBytes(instrumentalWav);
  if (outBytes === null || outBytes < 1024) {
    throw new Error(
      `AI separation finished but ${path.basename(instrumentalWav)} was not written ` +
        `(expected instrumental extract WAV at ${instrumentalWav})`
    );
  }
  stageClock.mark('ai_separate_done', {
    method,
    outputWav: instrumentalWav,
    outputWavBytes: outBytes,
    aiElapsedMs: Date.now() - aiStartedAt,
    aiOutputExists: true
  });
}

/**
 * Demux → AI or algorithmic vocal remove → remux (optional lyrics burn).
 */
export async function processInstrumentalVideo(
  options: InstrumentalProcessOptions
): Promise<InstrumentalProcessResult> {
  const input = path.resolve(options.inputVideoPath);
  const output = path.resolve(options.outputPath);
  // Download Instrumental defaults to AI (UVR-MDX Karaoke 2) — do not use the
  // live-DSP coerceVocalRemoverMethod default (centerCancelBassKeep).
  const selected = coerceInstrumentalVocalRemoverMethod(options.algorithm);
  const useAi = isAiVocalRemoverMethod(selected);
  const logger = options.logger;

  if (!fs.existsSync(input)) {
    return { success: false, error: `Input video not found: ${input}` };
  }

  const workDir = path.dirname(output);
  // Paths keyed off the source MP4 stem (downloadId), not the remux basename.
  const { sourceStem, extractedWav, instrumentalExtractWav: instrumentalWav } =
    resolveInstrumentalTempWavPaths(input, workDir);
  const stagingOut = `${output}.partial.mp4`;

  const pipelineStartedAt = Date.now();
  let stageStartedAt = pipelineStartedAt;
  const stageClock = {
    mark: (stage: string, data?: Record<string, unknown>) => {
      const now = Date.now();
      logger?.debug('InstrumentalProcessor', `stage=${stage}`, {
        ...data,
        stageMs: now - stageStartedAt,
        totalMs: now - pipelineStartedAt
      });
      stageStartedAt = now;
    }
  };

  const report = (phase: InstrumentalProcessPhase, percent: number) => {
    try {
      options.onProgress?.(phase, percent);
    } catch {
      /* ignore listener errors */
    }
  };

  const signal = options.signal;

  // Explain AI vs algo routing so debug logs show skip reasons clearly.
  let vocalPathReason: string;
  if (useAi) {
    if (!options.vocalModelManager || !options.ortWasmManager) {
      vocalPathReason = 'ai_method_selected_but_managers_missing';
    } else if (options.aiSeparate) {
      vocalPathReason = 'ai_method_selected_di_hook';
    } else {
      vocalPathReason = 'ai_method_selected';
    }
  } else {
    vocalPathReason = `algorithmic_method_selected_ai_skipped:${selected}`;
  }

  logger?.debug('InstrumentalProcessor', 'Instrumental pipeline start', {
    sourceStem,
    sourceMp4: input,
    sourceMp4Bytes: safeFileSizeBytes(input),
    outputPath: output,
    extractedWav,
    aiInputPath: extractedWav,
    aiOutputWav: instrumentalWav,
    stagingOut,
    algorithmRaw: options.algorithm ?? null,
    algorithm: selected,
    useAi,
    vocalPathReason,
    hasVocalModelManager: Boolean(options.vocalModelManager),
    hasOrtWasmManager: Boolean(options.ortWasmManager),
    // Guard against the old bug: extract must NOT be `{stem}.instrumental.extract.wav`.
    extractNameOk: isDemuxExtractWavName(extractedWav),
    aiOutputNameOk: path
      .basename(instrumentalWav)
      .toLowerCase()
      .endsWith('.instrumental.extract.wav'),
    cancelled: Boolean(signal?.aborted)
  });

  if (useAi && (!options.vocalModelManager || !options.ortWasmManager)) {
    logger?.error(
      'InstrumentalProcessor',
      'AI instrumental selected but OfflineVocalModelManager/OrtWasmManager not wired — cannot run AI',
      { algorithm: selected, vocalPathReason }
    );
    return {
      success: false,
      error:
        'AI instrumental separation requires OfflineVocalModelManager + OrtWasmManager ' +
        '(DownloadManager.setInstrumentalAiDeps was not called)'
    };
  }

  try {
    throwIfAborted(signal);
    report('extracting', 5);
    stageClock.mark('extract_start', { sourceMp4: input, extractedWav });
    await runFfmpeg(
      [
        '-y',
        '-i',
        input,
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
      { signal }
    );
    stageClock.mark('extract_done', {
      sourceMp4: input,
      extractedWav,
      extractedWavBytes: safeFileSizeBytes(extractedWav)
    });

    throwIfAborted(signal);
    if (useAi) {
      await removeVocalsAi(
        input,
        extractedWav,
        instrumentalWav,
        selected as AiVocalRemoverMethod,
        options,
        report,
        stageClock
      );
    } else {
      logger?.debug(
        'InstrumentalProcessor',
        'AI vocal separation skipped — using algorithmic mid/side DSP',
        {
          algorithm: selected,
          algorithmRaw: options.algorithm ?? null,
          reason: vocalPathReason,
          sourceMp4: input,
          extractedWav,
          extractedWavBytes: safeFileSizeBytes(extractedWav),
          aiOutputWav: instrumentalWav
        }
      );
      report('removing_vocals', 35);
      stageClock.mark('algo_remove_start', { algorithm: selected, extractedWav });
      await removeVocalsAlgorithmic(
        extractedWav,
        instrumentalWav,
        coerceAlgorithmicVocalRemoverMethod(selected),
        signal
      );
      stageClock.mark('algo_remove_done', {
        instrumentalWav,
        instrumentalWavBytes: safeFileSizeBytes(instrumentalWav)
      });
    }

    const instrumentalBytes = safeFileSizeBytes(instrumentalWav);
    if (instrumentalBytes === null || instrumentalBytes < 1024) {
      logger?.error('InstrumentalProcessor', 'Instrumental extract WAV missing before remux', {
        instrumentalWav,
        useAi,
        algorithm: selected,
        vocalPathReason,
        extractedWav,
        extractedWavBytes: safeFileSizeBytes(extractedWav)
      });
      return {
        success: false,
        error:
          `Instrumental extract WAV was not produced (${path.basename(instrumentalWav)}). ` +
          `AI/algo step did not write output.`
      };
    }

    throwIfAborted(signal);
    report('remuxing', 75);
    const subtitlePath =
      options.subtitlePath && fs.existsSync(options.subtitlePath)
        ? options.subtitlePath
        : findSiblingSubtitle(input);

    stageClock.mark('remux_start', {
      sourceMp4: input,
      instrumentalWav,
      instrumentalWavBytes: safeFileSizeBytes(instrumentalWav),
      stagingOut,
      subtitlePath: subtitlePath || null
    });

    let lyricsBurned = false;
    if (subtitlePath) {
      const escapedSub = subtitlePath
        .replace(/\\/g, '/')
        .replace(/:/g, '\\:')
        .replace(/'/g, "\\'");
      try {
        await runFfmpeg(
          [
            '-y',
            '-i',
            input,
            '-i',
            instrumentalWav,
            '-vf',
            `subtitles='${escapedSub}'`,
            '-map',
            '0:v:0',
            '-map',
            '1:a:0',
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '20',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-shortest',
            '-movflags',
            '+faststart',
            stagingOut
          ],
          { signal }
        );
        lyricsBurned = true;
      } catch (err) {
        if (isAbortError(err)) throw err;
        lyricsBurned = false;
        logger?.warn(
          'InstrumentalProcessor',
          'Subtitle burn-in failed; remuxing without lyrics',
          { subtitlePath, error: err instanceof Error ? err.message : String(err) }
        );
        await runFfmpeg(
          [
            '-y',
            '-i',
            input,
            '-i',
            instrumentalWav,
            '-map',
            '0:v:0',
            '-map',
            '1:a:0',
            '-c:v',
            'copy',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-shortest',
            '-movflags',
            '+faststart',
            stagingOut
          ],
          { signal }
        );
      }
    } else {
      await runFfmpeg(
        [
          '-y',
          '-i',
          input,
          '-i',
          instrumentalWav,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-shortest',
          '-movflags',
          '+faststart',
          stagingOut
        ],
        { signal }
      );
    }

    throwIfAborted(signal);
    const staged = await fs.promises.stat(stagingOut);
    if (staged.size < 1024) {
      safeUnlink(stagingOut);
      logger?.error('InstrumentalProcessor', 'Remux produced empty instrumental video', {
        stagingOut,
        stagedBytes: staged.size
      });
      return { success: false, error: 'ffmpeg produced an empty instrumental video' };
    }

    if (fs.existsSync(output)) {
      safeUnlink(output);
    }
    await fs.promises.rename(stagingOut, output);

    report('remuxing', 100);
    stageClock.mark('pipeline_done', {
      outputPath: output,
      outputBytes: safeFileSizeBytes(output),
      lyricsBurned,
      useAi,
      algorithm: selected
    });
    return { success: true, outputPath: output, lyricsBurned };
  } catch (err) {
    safeUnlink(stagingOut);
    if (isAbortError(err) || signal?.aborted) {
      logger?.info('InstrumentalProcessor', 'Instrumental pipeline cancelled', {
        sourceMp4: input,
        extractedWav,
        algorithm: selected,
        useAi,
        totalMs: Date.now() - pipelineStartedAt
      });
      return { success: false, cancelled: true, error: 'Cancelled' };
    }
    const message = err instanceof Error ? err.message : String(err);
    logger?.error('InstrumentalProcessor', 'Instrumental processing failed', {
      error: message,
      sourceMp4: input,
      extractedWav,
      algorithm: selected,
      useAi,
      totalMs: Date.now() - pipelineStartedAt
    });
    return { success: false, error: `Instrumental processing failed: ${message}` };
  } finally {
    safeUnlink(extractedWav);
    safeUnlink(instrumentalWav);
  }
}
