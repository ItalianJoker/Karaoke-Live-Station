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
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  coerceAlgorithmicVocalRemoverMethod,
  coerceVocalRemoverMethod,
  isAiVocalRemoverMethod,
  methodToModelId,
  type AlgorithmicVocalRemoverMethod,
  type AiVocalRemoverMethod
} from '../../shared/vocalRemover';
import { resolveFfmpegPath } from './BinaryResolver';
import { separateInstrumentalWithAi } from './InstrumentalAiSeparator';
import { isAbortError, killProcessTree, throwIfAborted } from './processKill';
import type { OfflineVocalModelManager } from './OfflineVocalModelManager';
import type { OrtWasmManager } from './OrtWasmManager';
import type { Logger } from './Logger';

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
  extractedWav: string,
  instrumentalWav: string,
  method: AiVocalRemoverMethod,
  options: InstrumentalProcessOptions,
  report: (phase: InstrumentalProcessPhase, percent: number) => void
): Promise<void> {
  const { vocalModelManager, ortWasmManager, logger } = options;
  if (!vocalModelManager || !ortWasmManager) {
    throw new Error('AI instrumental separation requires OfflineVocalModelManager + OrtWasmManager');
  }

  const modelId = methodToModelId(method);
  throwIfAborted(options.signal);
  report('ensuring_model', 20);
  // ensureModel skips download when local userData/models copy is already current
  // (URL/SHA/version match); only fetches when missing, corrupt, or newer remote.
  const modelPath = await vocalModelManager.ensureModel(modelId, { signal: options.signal });
  throwIfAborted(options.signal);
  report('ensuring_model', 40);
  const ortPaths = await ortWasmManager.ensureOrtWasm();
  const ortDir = ortPaths.ortDir || ortWasmManager.getOrtDir();

  throwIfAborted(options.signal);
  report('removing_vocals', 45);
  const aiSeparate = options.aiSeparate || separateInstrumentalWithAi;
  await aiSeparate(
    {
      method,
      modelPath,
      ortDir,
      inputWav: extractedWav,
      outputWav: instrumentalWav,
      signal: options.signal,
      onProgress: (info) => {
        const pct = 45 + Math.max(0, Math.min(1, info.progress)) * 25;
        report('removing_vocals', pct);
      }
    },
    logger
  );
}

/**
 * Demux → AI or algorithmic vocal remove → remux (optional lyrics burn).
 */
export async function processInstrumentalVideo(
  options: InstrumentalProcessOptions
): Promise<InstrumentalProcessResult> {
  const input = path.resolve(options.inputVideoPath);
  const output = path.resolve(options.outputPath);
  const selected = coerceVocalRemoverMethod(options.algorithm);
  const useAi = isAiVocalRemoverMethod(selected);

  if (!fs.existsSync(input)) {
    return { success: false, error: `Input video not found: ${input}` };
  }

  const workDir = path.dirname(output);
  const id = path.basename(output, path.extname(output));
  const extractedWav = path.join(workDir, `${id}.extract.wav`);
  const instrumentalWav = path.join(workDir, `${id}.instrumental.wav`);
  const stagingOut = `${output}.partial.mp4`;

  const report = (phase: InstrumentalProcessPhase, percent: number) => {
    try {
      options.onProgress?.(phase, percent);
    } catch {
      /* ignore listener errors */
    }
  };

  const signal = options.signal;

  try {
    throwIfAborted(signal);
    report('extracting', 5);
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

    throwIfAborted(signal);
    if (useAi) {
      await removeVocalsAi(
        extractedWav,
        instrumentalWav,
        selected as AiVocalRemoverMethod,
        options,
        report
      );
    } else {
      report('removing_vocals', 35);
      await removeVocalsAlgorithmic(
        extractedWav,
        instrumentalWav,
        coerceAlgorithmicVocalRemoverMethod(selected),
        signal
      );
    }

    throwIfAborted(signal);
    report('remuxing', 75);
    const subtitlePath =
      options.subtitlePath && fs.existsSync(options.subtitlePath)
        ? options.subtitlePath
        : findSiblingSubtitle(input);

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
      return { success: false, error: 'ffmpeg produced an empty instrumental video' };
    }

    if (fs.existsSync(output)) {
      safeUnlink(output);
    }
    await fs.promises.rename(stagingOut, output);

    report('remuxing', 100);
    return { success: true, outputPath: output, lyricsBurned };
  } catch (err) {
    safeUnlink(stagingOut);
    if (isAbortError(err) || signal?.aborted) {
      return { success: false, cancelled: true, error: 'Cancelled' };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Instrumental processing failed: ${message}` };
  } finally {
    safeUnlink(extractedWav);
    safeUnlink(instrumentalWav);
  }
}
