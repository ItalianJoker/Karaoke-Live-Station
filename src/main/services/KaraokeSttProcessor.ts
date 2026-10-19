/**
 * Offline karaoke STT job: extract WAV → whisper.cpp word timestamps → TimedKaraokeScript sidecar.
 * Never runs on the Electron main event loop for inference (child process only).
 * Stage overlay is the v1 delivery path; ASS burn-in is deferred (v1.1).
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { resolveFfmpegPath } from './BinaryResolver';
import { isAbortError, killProcessTree, throwIfAborted } from './processKill';
import type { Logger } from './Logger';
import type { WhisperCppManager } from './WhisperCppManager';
import {
  coerceWhisperModelId,
  type WhisperModelId,
  DEFAULT_WHISPER_MODEL_ID
} from '../../shared/whisperStt';
import {
  resolveKaraokeScriptPath,
  whisperJsonToTimedScript,
  type TimedKaraokeScript
} from '../../shared/timedKaraoke';
import {
  isInstrumentalOnlySttPath,
  STT_INSTRUMENTAL_INPUT_REJECTED
} from '../../shared/karaokeSttPaths';

export type KaraokeSttPhase =
  | 'ensuring_engine'
  | 'extracting_audio'
  | 'separating_vocals'
  | 'transcribing'
  | 'writing_script'
  | 'remuxing';

export type KaraokeSttResult = {
  success: boolean;
  cancelled?: boolean;
  scriptPath?: string;
  script?: TimedKaraokeScript;
  error?: string;
  usedVocalStem: boolean;
};

export async function processKaraokeSttOverlay(options: {
  inputVideoPath: string;
  trackId: string;
  libraryPath?: string;
  language?: string;
  modelId?: WhisperModelId;
  /** Best-effort: if a vocal WAV path is provided, prefer it over the mix. */
  vocalStemPath?: string | null;
  /**
   * When set, write the TimedKaraokeScript beside this media path (typically the
   * instrumental remux) for Stage overlay during instrumental playback.
   */
  attachScriptToMediaPath?: string | null;
  /** When true, attempt burn-in ASS remux (deferred — ignored in v1). */
  burnInAss?: boolean;
  whisperManager: WhisperCppManager;
  onProgress?: (phase: KaraokeSttPhase, percent: number) => void;
  signal?: AbortSignal;
  logger?: Logger;
}): Promise<KaraokeSttResult> {
  const modelId = coerceWhisperModelId(options.modelId || DEFAULT_WHISPER_MODEL_ID);
  const workDir = path.dirname(path.resolve(options.inputVideoPath));
  const stem = path.basename(options.inputVideoPath, path.extname(options.inputVideoPath));
  const sttWav = path.join(workDir, `${stem}.stt.16k.wav`);
  const jsonOutBase = path.join(workDir, `${stem}.stt`);
  let usedVocalStem = false;

  const report = (phase: KaraokeSttPhase, percent: number) => {
    options.onProgress?.(phase, Math.max(0, Math.min(100, percent)));
  };

  try {
    // Hard guard: Whisper must never receive instrumental-only audio.
    if (isInstrumentalOnlySttPath(options.inputVideoPath)) {
      options.logger?.warn(
        'KaraokeSttProcessor',
        `Rejected instrumental STT input: ${options.inputVideoPath}`
      );
      return {
        success: false,
        error: STT_INSTRUMENTAL_INPUT_REJECTED,
        usedVocalStem: false
      };
    }
    if (options.vocalStemPath && isInstrumentalOnlySttPath(options.vocalStemPath)) {
      options.logger?.warn(
        'KaraokeSttProcessor',
        `Rejected instrumental vocalStemPath: ${options.vocalStemPath}`
      );
      return {
        success: false,
        error: STT_INSTRUMENTAL_INPUT_REJECTED,
        usedVocalStem: false
      };
    }

    throwIfAborted(options.signal);
    report('ensuring_engine', 2);
    const binPath = await options.whisperManager.ensureBinary(options.signal);
    throwIfAborted(options.signal);
    report('ensuring_engine', 8);
    const modelPath = await options.whisperManager.ensureModel(modelId, {
      signal: options.signal
    });
    throwIfAborted(options.signal);
    report('ensuring_engine', 15);

    // Prefer explicit vocal stem when present; else extract 16 kHz mono from the source
    // (ORIGINAL mix / vocals / retained demux — never the instrumental remux).
    let audioForStt = options.vocalStemPath;
    if (audioForStt && fs.existsSync(audioForStt)) {
      usedVocalStem = true;
      report('separating_vocals', 20);
      // Resample vocal stem to 16k mono for whisper
      await runFfmpegExtract(audioForStt, sttWav, options.signal);
    } else {
      usedVocalStem = false;
      report('extracting_audio', 20);
      await runFfmpegExtract(options.inputVideoPath, sttWav, options.signal);
    }
    throwIfAborted(options.signal);
    report('extracting_audio', 35);

    report('transcribing', 40);
    const jsonPath = await runWhisperCli({
      binPath,
      modelPath,
      wavPath: sttWav,
      outputBase: jsonOutBase,
      language: options.language,
      signal: options.signal,
      onProgress: (p) => report('transcribing', 40 + Math.round(p * 0.5))
    });
    throwIfAborted(options.signal);
    report('transcribing', 92);

    report('writing_script', 94);
    const rawJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const attachMedia =
      options.attachScriptToMediaPath && fs.existsSync(options.attachScriptToMediaPath)
        ? options.attachScriptToMediaPath
        : options.inputVideoPath;
    const script = whisperJsonToTimedScript({
      raw: rawJson,
      sourceTrackId: options.trackId,
      sourcePath: attachMedia,
      modelId,
      language: options.language,
      usedVocalStem
    });

    const scriptPath = resolveKaraokeScriptPath({
      mediaPath: attachMedia,
      trackId: options.trackId,
      libraryPath: options.libraryPath
    });
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    // Atomic write — no partial sidecar on crash
    const tmpScript = `${scriptPath}.tmp`;
    fs.writeFileSync(tmpScript, JSON.stringify(script, null, 2), 'utf8');
    fs.renameSync(tmpScript, scriptPath);

    // v1: Stage overlay only — burn-in ASS deferred (options.burnInAss ignored).
    if (options.burnInAss) {
      options.logger?.info(
        'KaraokeSttProcessor',
        'ASS burn-in requested but deferred in v1 (Stage overlay only)'
      );
    }

    report('writing_script', 100);
    options.logger?.info('KaraokeSttProcessor', 'STT script written', {
      scriptPath,
      lines: script.lines.length,
      modelId,
      usedVocalStem
    });

    return { success: true, scriptPath, script, usedVocalStem };
  } catch (err) {
    if (isAbortError(err) || options.signal?.aborted) {
      return { success: false, cancelled: true, usedVocalStem, error: 'Cancelled' };
    }
    const message = err instanceof Error ? err.message : String(err);
    options.logger?.error('KaraokeSttProcessor', `STT failed: ${message}`);
    return { success: false, error: message, usedVocalStem };
  } finally {
    // Cleanup work temps (keep script)
    for (const p of [
      sttWav,
      `${jsonOutBase}.json`,
      `${jsonOutBase}.txt`,
      `${jsonOutBase}.vtt`,
      `${jsonOutBase}.srt`
    ]) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
}

async function runFfmpegExtract(
  inputPath: string,
  outputWav: string,
  signal?: AbortSignal
): Promise<void> {
  const ffmpegBin = resolveFfmpegPath();
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
      return;
    }
    const args = [
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      outputWav
    ];
    const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const onAbort = () => {
      killProcessTree(child);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
        return;
      }
      if (code !== 0 || !fs.existsSync(outputWav)) {
        reject(new Error(`ffmpeg STT extract failed (code ${code})`));
        return;
      }
      resolve();
    });
  });
}

async function runWhisperCli(opts: {
  binPath: string;
  modelPath: string;
  wavPath: string;
  outputBase: string;
  language?: string;
  signal?: AbortSignal;
  onProgress?: (fraction0to1: number) => void;
}): Promise<string> {
  // whisper.cpp CLI: word timestamps + JSON
  // Prefer modern flags; fall back to short flags used by older builds.
  const args = [
    '-m',
    opts.modelPath,
    '-f',
    opts.wavPath,
    '-of',
    opts.outputBase,
    '-oj',
    '-ow',
    '-np'
  ];
  if (opts.language && opts.language !== 'auto') {
    args.push('-l', opts.language);
  }

  await new Promise<void>((resolve, reject) => {
    if (opts.signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
      return;
    }
    const child = spawn(opts.binPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const onAbort = () => killProcessTree(child);
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      // Best-effort progress from "progress = N%" lines
      const m = stderr.match(/progress\s*=\s*(\d+)/i);
      if (m) opts.onProgress?.(Math.min(1, parseInt(m[1], 10) / 100));
    });
    child.on('error', (err) => {
      opts.signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort);
      if (opts.signal?.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `whisper-cli exited with code ${code}${stderr ? `: ${stderr.slice(-400)}` : ''}`
          )
        );
        return;
      }
      resolve();
    });
  });

  const jsonPath = `${opts.outputBase}.json`;
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`whisper-cli did not write JSON output at ${jsonPath}`);
  }
  return jsonPath;
}

/** Load sidecar if present (Stage / IPC). */
export function loadKaraokeScript(scriptPath: string): TimedKaraokeScript | null {
  try {
    if (!scriptPath || !fs.existsSync(scriptPath)) return null;
    const raw = JSON.parse(fs.readFileSync(scriptPath, 'utf8')) as TimedKaraokeScript;
    if (raw?.version !== 1 || !Array.isArray(raw.lines)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function findKaraokeScriptForTrack(opts: {
  trackId: string;
  mediaPath?: string;
  libraryPath?: string;
}): string | null {
  const candidates: string[] = [];
  if (opts.mediaPath) {
    candidates.push(
      resolveKaraokeScriptPath({
        mediaPath: opts.mediaPath,
        trackId: opts.trackId,
        libraryPath: opts.libraryPath
      })
    );
    candidates.push(`${opts.mediaPath}.karaoke.json`);
  }
  if (opts.libraryPath) {
    candidates.push(
      path.join(opts.libraryPath, '.kls-karaoke', `${opts.trackId}.karaoke.json`)
    );
  }
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}
