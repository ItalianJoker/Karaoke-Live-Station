/**
 * Offline karaoke STT job: extract WAV → whisper.cpp word timestamps → TimedKaraokeScript sidecar
 * (+ optional ASS for ffmpeg burn-in during instrumental remux).
 * Never runs on the Electron main event loop for inference (child process only).
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
  resolveWhisperCliBackend,
  whisperForceNoGpu,
  type WhisperModelId,
  type WhisperCliBackend,
  DEFAULT_WHISPER_MODEL_ID
} from '../../shared/whisperStt';
import type { AiGpuPreference } from '../../shared/aiGpuPreference';
import { coerceAiGpuPreference } from '../../shared/aiGpuPreference';
import { coerceAiEnableGpu } from '../../shared/aiOrtProviders';
import { resolveAiCpuThreads } from '../../shared/aiCpuThreads';
import os from 'os';
import {
  coerceSttDisplayMode,
  resolveKaraokeAssPath,
  resolveKaraokeScriptPath,
  timedScriptToAss,
  whisperJsonToTimedScript,
  type SttDisplayMode,
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
  /** ASS beside media when burn-in was requested (for InstrumentalProcessor subtitles=). */
  assPath?: string;
  script?: TimedKaraokeScript;
  error?: string;
  usedVocalStem: boolean;
  /** Effective whisper-cli backend after ensure + optional CUDA→BLAS fallback. */
  sttBackend?: WhisperCliBackend;
  sttThreads?: number;
};

/** Optional telemetry on STT progress (ETA / backend) for DownloadManager. */
export type KaraokeSttProgressMeta = {
  etaSec?: number;
  sttBackend?: WhisperCliBackend;
  sttThreads?: number;
};

/** Clip process stdout/stderr for structured logs (no secrets expected; keep tails short). */
function clipLogTail(text: string, maxChars = 400): string {
  const normalized = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .trim();
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(-maxChars);
}

function countScriptWords(script: TimedKaraokeScript): number {
  let n = 0;
  for (const line of script.lines || []) {
    n += Array.isArray(line.words) ? line.words.length : 0;
  }
  return n;
}

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
  /**
   * When true, also write an ASS sibling beside the attach/input media so
   * `InstrumentalProcessor` can burn hardsubs via the existing `subtitles=` remux path.
   */
  burnInAss?: boolean;
  /** Persisted on TimedKaraokeScript so Stage can suppress overlay for burn-in. */
  displayMode?: SttDisplayMode;
  whisperManager: WhisperCppManager;
  onProgress?: (phase: KaraokeSttPhase, percent: number, meta?: KaraokeSttProgressMeta) => void;
  signal?: AbortSignal;
  logger?: Logger;
  /** Correlation id (typically `downloadId`) for joining DownloadManager → STT → promote logs. */
  correlationId?: string;
  /**
   * Same Settings knobs as Instrumental AI (GPU toggle / discrete preference / CPU threads).
   * STT maps these to whisper.cpp backends — never ORT WebGPU.
   */
  aiEnableGpu?: boolean | null;
  aiGpuPreference?: AiGpuPreference | string | null;
  aiCpuThreads?: number | null;
}): Promise<KaraokeSttResult> {
  const modelId = coerceWhisperModelId(options.modelId || DEFAULT_WHISPER_MODEL_ID);
  const workDir = path.dirname(path.resolve(options.inputVideoPath));
  const stem = path.basename(options.inputVideoPath, path.extname(options.inputVideoPath));
  const sttWav = path.join(workDir, `${stem}.stt.16k.wav`);
  const jsonOutBase = path.join(workDir, `${stem}.stt`);
  let usedVocalStem = false;
  const totalCpus = Math.max(1, os.cpus()?.length || 1);
  const sttThreads = resolveAiCpuThreads(options.aiCpuThreads, totalCpus);
  const gpuOn = coerceAiEnableGpu(options.aiEnableGpu);
  const gpuPref = coerceAiGpuPreference(options.aiGpuPreference);
  const requestedBackend = resolveWhisperCliBackend({
    aiEnableGpu: gpuOn,
    aiGpuPreference: gpuPref
  });
  let sttBackend: WhisperCliBackend = requestedBackend;
  const forceNoGpu = whisperForceNoGpu({ aiEnableGpu: gpuOn, aiGpuPreference: gpuPref });
  const corr = {
    downloadId: options.correlationId || undefined,
    trackId: options.trackId,
    modelId,
    sttBackend,
    sttThreads,
    aiEnableGpu: gpuOn,
    aiGpuPreference: gpuPref,
    requestedBackend
  };

  const report = (phase: KaraokeSttPhase, percent: number, meta?: KaraokeSttProgressMeta) => {
    options.onProgress?.(phase, Math.max(0, Math.min(100, percent)), {
      sttBackend,
      sttThreads,
      ...meta
    });
  };

  try {
    options.logger?.info('KaraokeSttProcessor', 'STT job start', {
      ...corr,
      inputVideoPath: options.inputVideoPath,
      hasVocalStem: Boolean(options.vocalStemPath),
      language: options.language || 'auto'
    });

    // Hard guard: Whisper must never receive instrumental-only audio.
    if (isInstrumentalOnlySttPath(options.inputVideoPath)) {
      options.logger?.warn('KaraokeSttProcessor', 'Rejected instrumental STT input', {
        ...corr,
        inputVideoPath: options.inputVideoPath,
        reason: STT_INSTRUMENTAL_INPUT_REJECTED
      });
      return {
        success: false,
        error: STT_INSTRUMENTAL_INPUT_REJECTED,
        usedVocalStem: false
      };
    }
    if (options.vocalStemPath && isInstrumentalOnlySttPath(options.vocalStemPath)) {
      options.logger?.warn('KaraokeSttProcessor', 'Rejected instrumental vocalStemPath', {
        ...corr,
        vocalStemPath: options.vocalStemPath,
        reason: STT_INSTRUMENTAL_INPUT_REJECTED
      });
      return {
        success: false,
        error: STT_INSTRUMENTAL_INPUT_REJECTED,
        usedVocalStem: false
      };
    }

    throwIfAborted(options.signal);
    report('ensuring_engine', 2);
    options.logger?.debug('KaraokeSttProcessor', 'Ensuring whisper-cli binary', {
      ...corr,
      forceNoGpu
    });
    let binPath = await options.whisperManager.ensureBinary(options.signal, requestedBackend);
    // ensureBinary may soft-fallback CUDA → BLAS; refresh marker for logs / flags.
    const installed = options.whisperManager.getInstalledBackend();
    if (installed) sttBackend = installed;
    corr.sttBackend = sttBackend;
    options.logger?.info('KaraokeSttProcessor', 'Whisper binary ready', {
      ...corr,
      binaryPath: binPath,
      installedBackend: installed || null
    });
    throwIfAborted(options.signal);
    report('ensuring_engine', 8);
    options.logger?.debug('KaraokeSttProcessor', 'Ensuring Whisper model', corr);
    const modelPath = await options.whisperManager.ensureModel(modelId, {
      signal: options.signal
    });
    options.logger?.info('KaraokeSttProcessor', 'Whisper model ready', {
      ...corr,
      modelPath
    });
    throwIfAborted(options.signal);
    report('ensuring_engine', 15);

    // -ng when Settings say CPU/integrated, or when we wanted CUDA but only BLAS is installed.
    // Do NOT force -ng merely because the backend marker is "blas" on macOS/Linux (Metal).
    const effectiveNoGpu =
      forceNoGpu || (requestedBackend === 'cublas-11.8' && sttBackend === 'blas');

    // Prefer explicit vocal stem when present; else extract 16 kHz mono from the source
    // (ORIGINAL mix / vocals / retained demux — never the instrumental remux).
    let audioForStt = options.vocalStemPath;
    if (audioForStt && fs.existsSync(audioForStt)) {
      usedVocalStem = true;
      report('separating_vocals', 20);
      options.logger?.debug('KaraokeSttProcessor', 'Extracting 16k WAV from vocal stem', {
        ...corr,
        sourcePath: audioForStt,
        sttWav
      });
      // Resample vocal stem to 16k mono for whisper
      await runFfmpegExtract(audioForStt, sttWav, options.signal, options.logger, corr);
    } else {
      usedVocalStem = false;
      report('extracting_audio', 20);
      options.logger?.debug('KaraokeSttProcessor', 'Extracting 16k WAV from mix/original', {
        ...corr,
        sourcePath: options.inputVideoPath,
        sttWav
      });
      await runFfmpegExtract(
        options.inputVideoPath,
        sttWav,
        options.signal,
        options.logger,
        corr
      );
    }
    throwIfAborted(options.signal);
    report('extracting_audio', 35);
    let wavBytes = 0;
    try {
      wavBytes = fs.statSync(sttWav).size;
    } catch {
      wavBytes = 0;
    }
    options.logger?.debug('KaraokeSttProcessor', 'STT WAV ready', {
      ...corr,
      sttWav,
      wavBytes,
      usedVocalStem
    });

    report('transcribing', 40, { etaSec: undefined });
    const transcribeStartedAt = Date.now();
    let jsonPath: string;
    try {
      jsonPath = await runWhisperCli({
        binPath,
        modelPath,
        wavPath: sttWav,
        outputBase: jsonOutBase,
        language: options.language,
        threads: sttThreads,
        noGpu: effectiveNoGpu,
        signal: options.signal,
        logger: options.logger,
        correlation: corr,
        onProgress: (p) => {
          const mapped = 40 + Math.round(p * 0.5);
          let etaSec: number | undefined;
          if (p > 0.02) {
            const elapsed = (Date.now() - transcribeStartedAt) / 1000;
            const remaining = elapsed * ((1 - p) / p);
            if (Number.isFinite(remaining) && remaining >= 0) etaSec = remaining;
          }
          report('transcribing', mapped, { etaSec });
        }
      });
    } catch (whisperErr) {
      // Runtime CUDA failure after a successful -h probe → one BLAS retry (soft).
      if (sttBackend === 'cublas-11.8' && !options.signal?.aborted) {
        options.logger?.warn(
          'KaraokeSttProcessor',
          'CUDA whisper-cli failed at runtime — retrying with CPU BLAS',
          {
            ...corr,
            error: whisperErr instanceof Error ? whisperErr.message : String(whisperErr)
          }
        );
        binPath = await options.whisperManager.ensureBinary(options.signal, 'blas');
        sttBackend = options.whisperManager.getInstalledBackend() || 'blas';
        corr.sttBackend = sttBackend;
        jsonPath = await runWhisperCli({
          binPath,
          modelPath,
          wavPath: sttWav,
          outputBase: jsonOutBase,
          language: options.language,
          threads: sttThreads,
          noGpu: true,
          signal: options.signal,
          logger: options.logger,
          correlation: corr,
          onProgress: (p) => {
            const mapped = 40 + Math.round(p * 0.5);
            let etaSec: number | undefined;
            if (p > 0.02) {
              const elapsed = (Date.now() - transcribeStartedAt) / 1000;
              const remaining = elapsed * ((1 - p) / p);
              if (Number.isFinite(remaining) && remaining >= 0) etaSec = remaining;
            }
            report('transcribing', mapped, { etaSec, sttBackend });
          }
        });
      } else {
        throw whisperErr;
      }
    }
    throwIfAborted(options.signal);
    report('transcribing', 92, { etaSec: 0 });

    report('writing_script', 94);
    let jsonBytes = 0;
    try {
      jsonBytes = fs.statSync(jsonPath).size;
    } catch {
      jsonBytes = 0;
    }
    options.logger?.debug('KaraokeSttProcessor', 'Whisper JSON present', {
      ...corr,
      jsonPath,
      jsonBytes
    });
    const rawJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const attachMedia =
      options.attachScriptToMediaPath && fs.existsSync(options.attachScriptToMediaPath)
        ? options.attachScriptToMediaPath
        : options.inputVideoPath;
    const displayMode =
      options.displayMode != null
        ? coerceSttDisplayMode(options.displayMode)
        : options.burnInAss
          ? 'burn-in'
          : undefined;
    const script = whisperJsonToTimedScript({
      raw: rawJson,
      sourceTrackId: options.trackId,
      sourcePath: attachMedia,
      modelId,
      language: options.language,
      usedVocalStem,
      displayMode
    });
    const wordCount = countScriptWords(script);

    // Empty transcript must not soft-succeed — Stage would mount a blank overlay.
    if (!script.lines.length) {
      options.logger?.warn('KaraokeSttProcessor', 'Whisper produced empty transcription', {
        ...corr,
        usedVocalStem,
        jsonBytes,
        wordCount: 0,
        lines: 0
      });
      return {
        success: false,
        error: 'Whisper produced empty transcription (no timed words)',
        usedVocalStem
      };
    }

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

    let assPath: string | undefined;
    if (options.burnInAss) {
      // Write ASS beside media for InstrumentalProcessor findSiblingSubtitle / explicit subtitlePath.
      const assOut = resolveKaraokeAssPath(attachMedia);
      const assBody = timedScriptToAss(script);
      const tmpAss = `${assOut}.tmp`;
      fs.writeFileSync(tmpAss, assBody, 'utf8');
      fs.renameSync(tmpAss, assOut);
      assPath = assOut;
      options.logger?.info('KaraokeSttProcessor', 'ASS sidecar written for burn-in', {
        ...corr,
        assPath,
        dialogueLines: script.lines.length
      });
    }

    report('writing_script', 100);
    options.logger?.info('KaraokeSttProcessor', 'STT script written', {
      ...corr,
      scriptPath,
      assPath: assPath || null,
      lines: script.lines.length,
      wordCount,
      usedVocalStem,
      attachMedia
    });

    return {
      success: true,
      scriptPath,
      assPath,
      script,
      usedVocalStem,
      sttBackend,
      sttThreads
    };
  } catch (err) {
    if (isAbortError(err) || options.signal?.aborted) {
      options.logger?.info('KaraokeSttProcessor', 'STT cancelled', {
        ...corr,
        usedVocalStem
      });
      return {
        success: false,
        cancelled: true,
        usedVocalStem,
        error: 'Cancelled',
        sttBackend,
        sttThreads
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    options.logger?.error('KaraokeSttProcessor', `STT failed: ${message}`, {
      ...corr,
      usedVocalStem,
      error: message
    });
    return { success: false, error: message, usedVocalStem, sttBackend, sttThreads };
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
  signal?: AbortSignal,
  logger?: Logger,
  correlation?: { downloadId?: string; trackId?: string; modelId?: string }
): Promise<void> {
  const ffmpegBin = resolveFfmpegPath();
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
      return;
    }
    // Mild highpass only (cheap single-pass). Avoid aggressive denoise (hurts sibilants)
    // and multi-pass loudnorm (costly). Do not add unverified whisper CLI decode flags
    // here — unknown args exit 0 (#90 trap).
    const args = [
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-af',
      'highpass=f=80',
      '-c:a',
      'pcm_s16le',
      outputWav
    ];
    logger?.debug('KaraokeSttProcessor', 'ffmpeg STT extract spawn', {
      ...correlation,
      ffmpegBin,
      args
    });
    const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const onAbort = () => {
      killProcessTree(child);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 64 * 1024) stderr = stderr.slice(-32 * 1024);
    });
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
        logger?.warn('KaraokeSttProcessor', 'ffmpeg STT extract failed', {
          ...correlation,
          exitCode: code,
          stderrTail: clipLogTail(stderr),
          outputWavExists: fs.existsSync(outputWav)
        });
        reject(
          new Error(
            `ffmpeg STT extract failed (code ${code})${
              stderr ? `: ${clipLogTail(stderr)}` : ''
            }`
          )
        );
        return;
      }
      logger?.debug('KaraokeSttProcessor', 'ffmpeg STT extract ok', {
        ...correlation,
        exitCode: code,
        outputWav
      });
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
  /** whisper `-t` / `--threads` (Settings aiCpuThreads). */
  threads?: number;
  /** When true, pass `-ng` (CPU even on CUDA/Metal builds). */
  noGpu?: boolean;
  signal?: AbortSignal;
  onProgress?: (fraction0to1: number) => void;
  logger?: Logger;
  correlation?: Record<string, unknown>;
}): Promise<string> {
  // whisper.cpp CLI (v1.7.x): `-ojf` writes JSON *with* token/word timestamps.
  // Do NOT use `-oj` alone (no tokens) or `-ow` (invalid; real flag is `-owts` for .wts karaoke
  // scripts). Unknown args make whisper-cli `exit(0)` after printing usage — no JSON written —
  // which previously soft-failed the download and left Stage with nothing to overlay.
  // `-pp` enables `progress = N%` on stderr (needed for Downloads ETA). `-np` still quiets
  // other chatter; the two flags are independent in whisper.cpp v1.7.x.
  const threads =
    typeof opts.threads === 'number' && Number.isFinite(opts.threads) && opts.threads >= 1
      ? Math.floor(opts.threads)
      : undefined;
  const args = [
    '-m',
    opts.modelPath,
    '-f',
    opts.wavPath,
    '-of',
    opts.outputBase,
    '-ojf',
    '-np',
    '-pp'
  ];
  if (threads != null) {
    args.push('-t', String(threads));
  }
  if (opts.noGpu) {
    args.push('-ng');
  }
  if (opts.language && opts.language !== 'auto') {
    args.push('-l', opts.language);
  }

  opts.logger?.info('KaraokeSttProcessor', 'whisper-cli spawn', {
    ...opts.correlation,
    binPath: opts.binPath,
    args,
    threads: threads ?? null,
    noGpu: opts.noGpu === true
  });

  await new Promise<void>((resolve, reject) => {
    if (opts.signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
      return;
    }
    const child = spawn(opts.binPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let stdout = '';
    const onAbort = () => killProcessTree(child);
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 64 * 1024) stdout = stdout.slice(-32 * 1024);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 64 * 1024) stderr = stderr.slice(-32 * 1024);
      // Last "progress = N%" wins (buffer may contain many steps).
      const matches = stderr.match(/progress\s*=\s*(\d+)/gi);
      if (matches && matches.length > 0) {
        const last = matches[matches.length - 1];
        const num = last.match(/(\d+)/);
        if (num) opts.onProgress?.(Math.min(1, parseInt(num[1], 10) / 100));
      }
    });
    child.on('error', (err) => {
      opts.signal?.removeEventListener('abort', onAbort);
      opts.logger?.error('KaraokeSttProcessor', 'whisper-cli spawn error', {
        ...opts.correlation,
        error: err instanceof Error ? err.message : String(err)
      });
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
      const stdoutTail = clipLogTail(stdout);
      const stderrTail = clipLogTail(stderr);
      // whisper.cpp exits 0 on unknown args after printing usage — treat as failure.
      if (/unknown argument/i.test(stderr)) {
        opts.logger?.error('KaraokeSttProcessor', 'whisper-cli rejected arguments', {
          ...opts.correlation,
          exitCode: code,
          stdoutTail,
          stderrTail,
          args
        });
        reject(
          new Error(
            `whisper-cli rejected arguments${stderrTail ? `: ${stderrTail}` : ''}`
          )
        );
        return;
      }
      if (code !== 0) {
        opts.logger?.error('KaraokeSttProcessor', 'whisper-cli non-zero exit', {
          ...opts.correlation,
          exitCode: code,
          stdoutTail,
          stderrTail
        });
        reject(
          new Error(
            `whisper-cli exited with code ${code}${stderrTail ? `: ${stderrTail}` : ''}`
          )
        );
        return;
      }
      opts.logger?.debug('KaraokeSttProcessor', 'whisper-cli exit ok', {
        ...opts.correlation,
        exitCode: code,
        stdoutTail,
        stderrTail
      });
      resolve();
    });
  });

  const jsonPath = `${opts.outputBase}.json`;
  if (!fs.existsSync(jsonPath)) {
    opts.logger?.error('KaraokeSttProcessor', 'whisper-cli did not write JSON', {
      ...opts.correlation,
      jsonPath,
      outputBase: opts.outputBase
    });
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

/** Ordered lookup paths Stage / IPC try for a track’s TimedKaraokeScript sidecar. */
export function listKaraokeScriptCandidates(opts: {
  trackId: string;
  mediaPath?: string;
  libraryPath?: string;
}): string[] {
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
  // De-dupe while preserving order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    if (!c) continue;
    const key = path.resolve(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export function findKaraokeScriptForTrack(opts: {
  trackId: string;
  mediaPath?: string;
  libraryPath?: string;
}): string | null {
  for (const c of listKaraokeScriptCandidates(opts)) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
