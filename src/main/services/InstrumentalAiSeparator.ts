/**
 * Spawns a utility process (or Node fork fallback) to run offline AI vocal
 * separation for Download Instrumental — keeps ORT/STFT off the Control UI thread.
 *
 * Contract: `inputWav` must be a demuxed PCM WAV (from InstrumentalProcessor
 * extract), never the source MP4. The worker reads PCM via readPcmWavFile.
 */
import { utilityProcess, type UtilityProcess } from 'electron';
import { fork, type ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { app } from 'electron';
import { Logger } from './Logger';
import { getInstrumentalAiHiddenRenderer } from './InstrumentalAiHiddenRenderer';
import type { AiVocalRemoverMethod } from '../../shared/vocalRemover';
import { methodToModelId, OFFLINE_VOCAL_MODELS } from '../../shared/vocalRemover';
import { isMdxInstrumentalMethod, mdxPayloadForMethod } from '../../shared/mdxAdvancedSettings';
import {
  isDemucsInstrumentalMethod,
  demucsPayloadForMethod
} from '../../shared/demucsAdvancedSettings';
import type { InstrumentalAiSeparateRequest } from '../workers/instrumentalAiSeparateCore';
import { resolveAiCpuThreads } from '../../shared/aiCpuThreads';

export type InstrumentalAiProgress = {
  phase: 'model' | 'decode' | 'separate' | 'ready' | 'error';
  progress: number;
  message: string;
  /** Actual ORT EP from the worker (after session create). */
  ortBackend?: 'webgpu' | 'wasm';
  /** Why WebGPU was skipped or fell back to WASM. */
  ortFallbackReason?: string;
  ortNumThreads?: number;
};

export type InstrumentalAiSeparateOptions = {
  method: AiVocalRemoverMethod;
  modelPath: string;
  ortDir: string;
  /** Demuxed extract WAV path — must not be the source MP4. */
  inputWav: string;
  outputWav: string;
  onProgress?: (info: InstrumentalAiProgress) => void;
  /** When aborted, the utility/fork worker is killed immediately. */
  signal?: AbortSignal;
  /**
   * Audio duration in seconds (used to scale the hard timeout).
   * Prefer reading from the demuxed WAV; defaults to a conservative mid-length track.
   */
  durationSec?: number;
  /**
   * MDX-only advanced knobs. Omit for Demucs / Roformer — worker ignores when method ≠ MDX.
   * segmentSize → dim_t; overlap → mdxStepSamples fraction; enableOrt → ORT accel opts.
   */
  mdxSegmentSize?: number;
  mdxOverlap?: number;
  mdxEnableOrt?: boolean;
  /** Demucs-only advanced knobs. Omit for MDX. */
  demucsShifts?: number;
  demucsSegmentSize?: number;
  demucsOverlap?: number;
  /** Resolved ORT WASM thread count (already clamped by main). */
  aiCpuThreads?: number;
  /** GPU-First toggle (default true). */
  aiEnableGpu?: boolean;
  /** Main GPU probe snapshot. */
  aiGpuSupported?: boolean;
};

/** Minimum hard ceiling so short tracks still get a full CPU WASM run. */
export const AI_SEPARATION_MIN_TIMEOUT_MS = 30 * 60 * 1000;
/** Cap so a bad hang cannot run forever. */
export const AI_SEPARATION_MAX_TIMEOUT_MS = 3 * 60 * 60 * 1000;
/**
 * Wall-clock budget per second of audio for ORT WASM on CPU.
 * ~3 min track → ~30 + 135 = 165 min; ~5 min → ~30 + 225 = 255 min (capped at 3h).
 * Prefer finishing over false timeouts; idle watchdog still catches true hangs.
 */
export const AI_SEPARATION_MS_PER_AUDIO_SEC = 45 * 1000;
/**
 * Fail if the worker goes silent this long (no progress heartbeat) *before*
 * `separate` is running, or between heartbeats when IPC is flowing.
 * During blocking ORT WASM, IPC cannot flush — see ORT silence timeout + parent keep-alive.
 */
export const AI_SEPARATION_IDLE_TIMEOUT_MS = 20 * 60 * 1000;
/**
 * Parent-side keep-alive while the worker may be inside blocking ORT WASM.
 * Re-arms the short idle watchdog so expected ORT silence is not a false stall,
 * while {@link AI_SEPARATION_ORT_SILENCE_TIMEOUT_MS} still bounds true hangs.
 */
export const AI_SEPARATION_PARENT_KEEPALIVE_MS = 60 * 1000;
/**
 * Max wall time with zero worker IPC after `separate` was sent.
 * ORT WASM can block the worker event loop for many minutes per chunk; this is the
 * real stall detector for that phase (short idle is intentionally re-armed).
 */
export const AI_SEPARATION_ORT_SILENCE_TIMEOUT_MS = 45 * 60 * 1000;
/**
 * Max time to wait for the worker's ready ping (requestId 0) before sending `separate`.
 * Must NOT post separate on a fixed short timer — utilityProcess can drop messages posted
 * before parentPort listeners bind (heavy ORT imports often take >>50ms).
 */
export const AI_WORKER_READY_TIMEOUT_MS = 2 * 60 * 1000;
/**
 * Max time to wait for Hidden Renderer WebGPU model initialization before parent
 * forcibly disposes the hung BrowserWindow and re-routes to utilityProcess WASM.
 * Matches WEBGPU_SESSION_TIMEOUT_MS in renderer, but enforced from the Node.js parent
 * in case the renderer thread is completely deadlocked by Chromium GPU / Dawn.
 */
export const AI_HIDDEN_RENDERER_MODEL_TIMEOUT_MS = 15_000;

/**
 * Scale the hard timeout with track length so a ~3–5 min song on CPU is not
 * cut by a fixed short deadline, while still bounding runaway hangs.
 */
export function computeAiSeparationTimeoutMs(durationSec?: number): number {
  const dur =
    typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0
      ? durationSec
      : 240;
  const scaled = AI_SEPARATION_MIN_TIMEOUT_MS + dur * AI_SEPARATION_MS_PER_AUDIO_SEC;
  return Math.min(AI_SEPARATION_MAX_TIMEOUT_MS, Math.max(AI_SEPARATION_MIN_TIMEOUT_MS, scaled));
}

function safeSize(filePath: string): number | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
}

/** Reject video / non-demux-extract paths before spawning the ORT worker. */
export function assertAiInputIsWav(inputWav: string): void {
  const base = path.basename(inputWav || '').toLowerCase();
  const ext = path.extname(inputWav).toLowerCase();
  if (ext !== '.wav') {
    throw new Error(
      `Instrumental AI input must be a demuxed .wav (got ${ext || 'no-ext'}): ${inputWav}`
    );
  }
  // Common mis-wire: feeding the staged MP4 (or .partial.mp4) into AI.
  if (base.endsWith('.mp4') || base.endsWith('.webm') || base.endsWith('.mkv')) {
    throw new Error(`Instrumental AI refused video path as input: ${inputWav}`);
  }
  // AI output name must not be fed back as input.
  if (base.endsWith('.instrumental.extract.wav')) {
    throw new Error(
      `Instrumental AI input must be {stem}.extract.wav, not AI output: ${inputWav}`
    );
  }
  if (!base.endsWith('.extract.wav')) {
    throw new Error(
      `Instrumental AI input should be named {stem}.extract.wav (got ${base})`
    );
  }
}

function resolveWorkerScript(): string {
  // Packaged / vite-plugin-electron: sibling of main bundle
  const candidates = [
    path.join(__dirname, 'instrumentalAiWorker.js'),
    path.join(__dirname, 'workers', 'instrumentalAiWorker.js'),
    path.join(app.getAppPath(), 'dist-electron', 'main', 'instrumentalAiWorker.js'),
    path.join(process.cwd(), 'dist-electron', 'main', 'instrumentalAiWorker.js')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    `Instrumental AI worker script not found. Looked in: ${candidates.join(', ')}`
  );
}

type WorkerHandle =
  | { kind: 'utility'; proc: UtilityProcess; script: string }
  | { kind: 'fork'; proc: ChildProcess; script: string }
  | { kind: 'hidden-renderer'; script: string };

function spawnWorker(): WorkerHandle {
  const script = resolveWorkerScript();
  if (typeof utilityProcess?.fork === 'function') {
    const proc = utilityProcess.fork(script, [], {
      serviceName: 'instrumental-ai',
      stdio: 'pipe'
    });
    return { kind: 'utility', proc, script };
  }
  const proc = fork(script, [], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  });
  return { kind: 'fork', proc, script };
}

/**
 * Prefer Hidden BrowserWindow when Settings wants GPU and a live Hidden Renderer
 * probe reports a WebGPU adapter. Do NOT gate solely on the download-start
 * `aiGpuSupported` snapshot (v1.4.0 logs: aiEnableGpu=true but snapshot false
 * kept workerKind=utility forever). Re-probe here; utility WASM only when GPU
 * is off or no adapter.
 */
async function resolveWorkerHandle(
  options: InstrumentalAiSeparateOptions,
  logger?: Logger
): Promise<WorkerHandle> {
  const gpuToggleOn = options.aiEnableGpu !== false;
  if (gpuToggleOn) {
    try {
      const hidden = getInstrumentalAiHiddenRenderer(logger);
      if (await hidden.isWebGpuReady()) {
        logger?.info('InstrumentalAiSeparator', 'Routing Instrumental AI to Hidden Renderer WebGPU', {
          aiEnableGpu: options.aiEnableGpu ?? null,
          aiGpuSupportedSnapshot: options.aiGpuSupported ?? null,
          probe: hidden.getCachedProbe()
        });
        return {
          kind: 'hidden-renderer',
          script: 'instrumentalAiGpuRenderer (Hidden BrowserWindow)'
        };
      }
      logger?.info(
        'InstrumentalAiSeparator',
        'Hidden Renderer WebGPU adapter unavailable — using utilityProcess WASM',
        {
          aiEnableGpu: options.aiEnableGpu ?? null,
          aiGpuSupportedSnapshot: options.aiGpuSupported ?? null,
          probe: hidden.getCachedProbe()
        }
      );
    } catch (err) {
      logger?.warn(
        'InstrumentalAiSeparator',
        `Hidden Renderer probe failed — WASM fallback: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
  return spawnWorker();
}

/** Drain piped worker stdio so crash traces are not lost (stdio:'pipe' without readers). */
function attachWorkerStdioLogging(
  worker: Exclude<WorkerHandle, { kind: 'hidden-renderer' }> | null,
  logger?: Logger,
  onOrtStderrHint?: (hint: string) => void
): void {
  if (!worker) return;
  const emit = (stream: 'stdout' | 'stderr', chunk: Buffer | string) => {
    const text = String(chunk).replace(/\r?\n$/, '');
    if (!text) return;
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      if (stream === 'stderr') {
        logger?.warn('InstrumentalAiSeparator', `AI worker stderr: ${line}`);
        // Production AppImage: ORT strips webgpu without always throwing on combined EPs.
        const lower = line.toLowerCase();
        if (
          lower.includes('webgpu') &&
          (lower.includes('backend not found') ||
            lower.includes('not available') ||
            lower.includes('removing requested execution provider'))
        ) {
          onOrtStderrHint?.(line.trim());
        }
      } else {
        logger?.debug('InstrumentalAiSeparator', `AI worker stdout: ${line}`);
      }
    }
  };
  const stdout = worker.proc.stdout;
  const stderr = worker.proc.stderr;
  stdout?.on('data', (chunk: Buffer | string) => emit('stdout', chunk));
  stderr?.on('data', (chunk: Buffer | string) => emit('stderr', chunk));
}

/**
 * Run one AI separation job. Creates a short-lived worker per call so ORT memory
 * is released after the instrumental remux.
 */
export async function separateInstrumentalWithAi(
  options: InstrumentalAiSeparateOptions,
  logger?: Logger
): Promise<void> {
  const { method, modelPath, ortDir, inputWav, outputWav, onProgress, signal } = options;
  if (signal?.aborted) {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    throw err;
  }

  assertAiInputIsWav(inputWav);
  if (!fs.existsSync(inputWav)) {
    throw new Error(`Instrumental AI input WAV not found: ${inputWav}`);
  }
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Instrumental AI model not found: ${modelPath}`);
  }
  if (!fs.existsSync(ortDir)) {
    throw new Error(`Instrumental AI ORT dir not found: ${ortDir}`);
  }

  const modelId = methodToModelId(method);
  const catalog = OFFLINE_VOCAL_MODELS[modelId];
  // Honor Settings CPU cores even after WebGPU → utilityProcess WASM re-route.
  // Never silently fall back to "all cores" when the operator set a limit.
  const totalCpus = Math.max(1, os.cpus()?.length || 1);
  const effectiveAiCpuThreads = resolveAiCpuThreads(options.aiCpuThreads, totalCpus);
  const worker = await resolveWorkerHandle(options, logger);
  let requestId = 1;
  let settled = false;
  let separateSent = false;
  let hardTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let readyTimer: ReturnType<typeof setTimeout> | null = null;
  let parentKeepAliveTimer: ReturnType<typeof setInterval> | null = null;
  let hiddenRendererModelWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
  const hardTimeoutMs = computeAiSeparationTimeoutMs(options.durationSec);
  const startedAt = Date.now();
  let lastPhase: string | null = null;
  let lastProgressAt = startedAt;
  let lastProgressMessage = '';
  /** Last known ORT EP from worker progress (defaults unknown until reported). */
  let lastOrtBackend: 'webgpu' | 'wasm' | 'unknown' = 'unknown';
  let lastOrtFallbackReason: string | undefined;
  /** Effective WASM thread count — Settings aiCpuThreads, not WebGPU's temporary 1. */
  let lastOrtNumThreads: number = effectiveAiCpuThreads;
  /** Prevents double utility re-route if Hidden Renderer posts fallback twice. */
  let utilityFallbackStarted = false;

  attachWorkerStdioLogging(
    worker.kind === 'hidden-renderer' ? null : worker,
    logger,
    (hint) => {
    if (!lastOrtFallbackReason) {
      lastOrtFallbackReason = hint;
    } else if (!lastOrtFallbackReason.includes(hint)) {
      lastOrtFallbackReason = `${lastOrtFallbackReason} | ${hint}`;
    }
    if (lastOrtBackend === 'unknown' || lastOrtBackend === 'webgpu') {
      lastOrtBackend = 'wasm';
    }
    logger?.warn('InstrumentalAiSeparator', 'ORT stderr indicates WebGPU EP unavailable', {
      ortBackend: lastOrtBackend,
      ortFallbackReason: lastOrtFallbackReason,
      ortNumThreads: lastOrtNumThreads ?? null
    });
  });

  const kill = () => {
    try {
      if (worker.kind === 'hidden-renderer') {
        getInstrumentalAiHiddenRenderer(logger).clearJobHandler();
        return;
      }
      if (worker.kind === 'utility') worker.proc.kill();
      else worker.proc.kill();
    } catch {
      /* ignore */
    }
  };

  const clearHiddenRendererWatchdog = () => {
    if (hiddenRendererModelWatchdogTimer) {
      clearTimeout(hiddenRendererModelWatchdogTimer);
      hiddenRendererModelWatchdogTimer = null;
    }
  };

  const clearTimers = () => {
    clearHiddenRendererWatchdog();
    if (hardTimer) {
      clearTimeout(hardTimer);
      hardTimer = null;
    }
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (readyTimer) {
      clearTimeout(readyTimer);
      readyTimer = null;
    }
    if (parentKeepAliveTimer) {
      clearInterval(parentKeepAliveTimer);
      parentKeepAliveTimer = null;
    }
  };

  return new Promise<void>((resolve, reject) => {
    const fail = (message: string, asAbort = false, reason = 'error') => {
      if (settled) return;
      settled = true;
      clearTimers();
      signal?.removeEventListener('abort', onAbort);
      kill();
      logger?.warn('InstrumentalAiSeparator', `AI separate end reason=${reason}`, {
        method,
        modelId,
        modelPath,
        modelVersion: catalog?.version,
        ortDir,
        ortBackend: lastOrtBackend,
        ortFallbackReason: lastOrtFallbackReason ?? null,
        ortNumThreads: lastOrtNumThreads ?? options.aiCpuThreads ?? null,
        aiEnableGpu: options.aiEnableGpu ?? null,
        aiGpuSupported: options.aiGpuSupported ?? null,
        inputWav,
        inputWavBytes: safeSize(inputWav),
        outputWav,
        outputWavBytes: safeSize(outputWav),
        outputWavExists: fs.existsSync(outputWav),
        separateSent,
        workerKind: worker.kind,
        elapsedMs: Date.now() - startedAt,
        hardTimeoutMs,
        lastPhase,
        message,
        cancelled: asAbort
      });
      if (asAbort) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
        return;
      }
      reject(new Error(message));
    };

    const succeed = () => {
      if (settled) return;
      // Hard guarantee: parent must see the AI output WAV before resolving.
      if (!fs.existsSync(outputWav) || (safeSize(outputWav) ?? 0) < 1024) {
        fail(
          `AI separation reported done but output WAV missing/empty: ${outputWav}`,
          false,
          'output_missing'
        );
        return;
      }
      settled = true;
      clearTimers();
      signal?.removeEventListener('abort', onAbort);
      kill();
      logger?.info('InstrumentalAiSeparator', 'AI separate completed', {
        method,
        modelId,
        modelPath,
        modelVersion: catalog?.version,
        ortDir,
        ortBackend: lastOrtBackend,
        ortFallbackReason: lastOrtFallbackReason ?? null,
        ortNumThreads: lastOrtNumThreads ?? options.aiCpuThreads ?? null,
        aiEnableGpu: options.aiEnableGpu ?? null,
        aiGpuSupported: options.aiGpuSupported ?? null,
        inputWav,
        inputWavBytes: safeSize(inputWav),
        outputWav,
        outputWavBytes: safeSize(outputWav),
        workerKind: worker.kind,
        elapsedMs: Date.now() - startedAt
      });
      resolve();
    };

    const onAbort = () => fail('Aborted', true, 'cancel');

    const triggerUtilityWasmFallback = (reason: string, disposeHiddenWindow = false) => {
      if (utilityFallbackStarted || settled) return;
      utilityFallbackStarted = true;
      lastOrtFallbackReason = reason;
      lastOrtBackend = 'wasm';
      lastOrtNumThreads = effectiveAiCpuThreads;
      lastProgressAt = Date.now();
      lastProgressMessage = `WebGPU unavailable — switching to WASM CPU (${effectiveAiCpuThreads} threads; ${reason})`;
      logger?.warn(
        'InstrumentalAiSeparator',
        'Hidden Renderer requested WASM re-route (utilityProcess)',
        {
          reason,
          disposeHiddenWindow,
          ortNumThreads: effectiveAiCpuThreads,
          aiCpuThreadsConfigured: options.aiCpuThreads ?? null,
          totalCpus,
          elapsedMs: Date.now() - startedAt
        }
      );
      onProgress?.({
        phase: 'model',
        progress: 0.05,
        message: lastProgressMessage,
        ortBackend: 'wasm',
        ortFallbackReason: reason,
        ortNumThreads: effectiveAiCpuThreads
      });
      // Detach Hidden Renderer job; keep outer promise open for utility re-run.
      clearTimers();
      signal?.removeEventListener('abort', onAbort);
      kill();
      if (disposeHiddenWindow) {
        getInstrumentalAiHiddenRenderer(logger).dispose();
      } else {
        getInstrumentalAiHiddenRenderer(logger).clearJobHandler();
      }
      void separateInstrumentalWithAi(
        {
          ...options,
          aiEnableGpu: false,
          aiGpuSupported: false,
          // Re-assert Settings CPU cores — never drop the limit on GPU→CPU fallback.
          aiCpuThreads: effectiveAiCpuThreads
        },
        logger
      ).then(
        () => {
          if (settled) return;
          settled = true;
          resolve();
        },
        (err: unknown) => {
          if (settled) return;
          const message = err instanceof Error ? err.message : String(err);
          const asAbort =
            err instanceof Error && (err.name === 'AbortError' || message === 'Aborted');
          fail(message, asAbort, asAbort ? 'cancel' : 'utility_fallback_error');
        }
      );
    };

    const armIdleWatchdog = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        const silentSec = Math.round((Date.now() - lastProgressAt) / 1000);
        fail(
          `Instrumental AI separation stalled (no progress for ${Math.round(
            AI_SEPARATION_IDLE_TIMEOUT_MS / 60000
          )} min; last update ${silentSec}s ago` +
            `${lastProgressMessage ? `: ${lastProgressMessage}` : ''}` +
            `${lastPhase ? `; phase=${lastPhase}` : ''}). ` +
            `Cancel and retry, or pick an algorithmic Download Instrumental method.`,
          false,
          'idle_timeout'
        );
      }, AI_SEPARATION_IDLE_TIMEOUT_MS);
    };

    const startParentKeepAlive = () => {
      if (parentKeepAliveTimer) return;
      // ORT WASM often blocks the worker thread during session.run — no IPC heartbeats.
      // Re-arm short idle so it does not false-timeout; enforce a longer ORT silence ceiling.
      parentKeepAliveTimer = setInterval(() => {
        if (settled) return;
        const silentMs = Date.now() - lastProgressAt;
        if (silentMs >= AI_SEPARATION_ORT_SILENCE_TIMEOUT_MS) {
          fail(
            `Instrumental AI separation stalled during ORT ` +
              `(no worker progress for ${Math.round(silentMs / 60000)} min; ` +
              `phase=${lastPhase || 'none'}` +
              `${lastProgressMessage ? `; ${lastProgressMessage}` : ''}). ` +
              `Cancel and retry, or pick an algorithmic Download Instrumental method.`,
            false,
            'ort_silence_timeout'
          );
          return;
        }
        armIdleWatchdog();
        logger?.debug('InstrumentalAiSeparator', 'AI parent keep-alive (worker may be in ORT)', {
          elapsedMs: Date.now() - startedAt,
          lastPhase,
          lastProgressMessage,
          silentMs,
          separateSent,
          ortSilenceTimeoutMs: AI_SEPARATION_ORT_SILENCE_TIMEOUT_MS
        });
      }, AI_SEPARATION_PARENT_KEEPALIVE_MS);
    };

    const sendSeparate = () => {
      if (settled || separateSent) return;
      separateSent = true;
      if (readyTimer) {
        clearTimeout(readyTimer);
        readyTimer = null;
      }
      const mdxPayload = mdxPayloadForMethod(method, {
        mdxSegmentSize: options.mdxSegmentSize,
        mdxOverlap: options.mdxOverlap,
        mdxEnableOrt: options.mdxEnableOrt
      });
      const demucsPayload = demucsPayloadForMethod(method, {
        demucsShifts: options.demucsShifts,
        demucsSegmentSize: options.demucsSegmentSize,
        demucsOverlap: options.demucsOverlap
      });
      const payload = {
        type: 'separate' as const,
        requestId,
        method,
        modelPath,
        ortDir,
        inputWav,
        outputWav,
        aiCpuThreads: effectiveAiCpuThreads,
        aiEnableGpu: options.aiEnableGpu,
        // Hidden Renderer path: force supported so ORT prefers WebGPU EP.
        // utility/fork path: false so worker skips doomed webgpu session.create.
        aiGpuSupported:
          worker.kind === 'hidden-renderer' ? true : options.aiGpuSupported === true,
        // Never run multithreaded WASM inside the Hidden BrowserWindow.
        allowInProcessWasmFallback: worker.kind !== 'hidden-renderer',
        // Only attach MDX knobs for aiMdxKaraoke2 — Demucs must not receive them.
        ...(mdxPayload || {}),
        // Only attach Demucs knobs for aiHtDemucs — MDX must not receive them.
        ...(demucsPayload || {})
      };
      logger?.debug('InstrumentalAiSeparator', 'Sending separate to AI worker', {
        workerKind: worker.kind,
        requestId,
        inputWav,
        outputWav,
        waitMs: Date.now() - startedAt,
        aiEnableGpu: options.aiEnableGpu ?? null,
        aiGpuSupported: options.aiGpuSupported ?? null,
        aiCpuThreads: effectiveAiCpuThreads,
        mdxAdvanced: isMdxInstrumentalMethod(method) ? mdxPayload : null,
        demucsAdvanced: isDemucsInstrumentalMethod(method) ? demucsPayload : null
      });
      if (worker.kind === 'hidden-renderer') {
        clearHiddenRendererWatchdog();
        hiddenRendererModelWatchdogTimer = setTimeout(() => {
          logger?.warn(
            'InstrumentalAiSeparator',
            `Hidden Renderer WebGPU model init watchdog timed out after ${Math.round(
              AI_HIDDEN_RENDERER_MODEL_TIMEOUT_MS / 1000
            )}s (Chromium/Dawn hang) — disposing Hidden Renderer and falling back to utilityProcess WASM`
          );
          triggerUtilityWasmFallback(
            `WebGPU model init watchdog timed out after ${Math.round(
              AI_HIDDEN_RENDERER_MODEL_TIMEOUT_MS / 1000
            )}s`,
            true
          );
        }, AI_HIDDEN_RENDERER_MODEL_TIMEOUT_MS);

        void getInstrumentalAiHiddenRenderer(logger).startSeparate(
          payload as InstrumentalAiSeparateRequest,
          { onMessage: onMsg }
        );
      } else if (worker.kind === 'utility') {
        worker.proc.postMessage(payload);
      } else {
        worker.proc.send(payload);
      }
      startParentKeepAlive();
    };

    const onMsg = (raw: unknown) => {
      const msg = raw as {
        type?: string;
        requestId?: number;
        phase?: InstrumentalAiProgress['phase'];
        progress?: number;
        message?: string;
        outputWav?: string;
        reason?: string;
        ortBackend?: 'webgpu' | 'wasm' | string;
        ortFallbackReason?: string;
        ortNumThreads?: number;
      };
      if (!msg?.type) return;
      // Ignore Hidden Renderer probe-result noise on the job channel.
      if (msg.type === 'probe-result') return;

      // Hidden Renderer WebGPU failed — never WASM in-window; re-route to utilityProcess.
      if (
        msg.type === 'gpu-fallback-requested' &&
        worker.kind === 'hidden-renderer' &&
        (msg.requestId === undefined || msg.requestId === requestId)
      ) {
        clearHiddenRendererWatchdog();
        const reason =
          (typeof msg.reason === 'string' && msg.reason.trim()) ||
          'WebGPU unavailable in Hidden Renderer';
        triggerUtilityWasmFallback(reason, false);
        return;
      }

      if (msg.type === 'progress') {
        // Any progress (including worker-ready ping) proves the child is alive.
        lastProgressAt = Date.now();
        if (typeof msg.message === 'string' && msg.message) {
          lastProgressMessage = msg.message;
        }
        if (msg.ortBackend === 'webgpu' || msg.ortBackend === 'wasm') {
          lastOrtBackend = msg.ortBackend;
        }
        if (typeof msg.ortFallbackReason === 'string' && msg.ortFallbackReason) {
          lastOrtFallbackReason = msg.ortFallbackReason;
          logger?.warn('InstrumentalAiSeparator', 'AI ORT WebGPU fallback', {
            ortBackend: lastOrtBackend,
            ortFallbackReason: lastOrtFallbackReason,
            ortNumThreads: msg.ortNumThreads ?? lastOrtNumThreads ?? null,
            phase: msg.phase ?? null,
            message: msg.message ?? null
          });
        }
        if (typeof msg.ortNumThreads === 'number' && Number.isFinite(msg.ortNumThreads)) {
          // Keep Settings CPU limit for WASM; ignore WebGPU's temporary numThreads=1.
          if (msg.ortBackend === 'wasm' || lastOrtBackend === 'wasm') {
            lastOrtNumThreads = msg.ortNumThreads;
          } else if (msg.ortBackend !== 'webgpu') {
            lastOrtNumThreads = msg.ortNumThreads;
          }
        }
        armIdleWatchdog();
        if (
          msg.phase === 'separate' ||
          (typeof msg.progress === 'number' && msg.progress > 0.15 && msg.phase !== 'model')
        ) {
          clearHiddenRendererWatchdog();
        }
        if (msg.requestId === 0) {
          logger?.debug('InstrumentalAiSeparator', 'AI worker ready ping', {
            workerKind: worker.kind,
            script: worker.script,
            waitMs: Date.now() - startedAt
          });
          // Critical: only send separate AFTER ready — fixed 50ms timers race heavy imports
          // and utilityProcess can drop messages posted before parentPort listeners bind.
          sendSeparate();
          return;
        }
        if (msg.phase && msg.phase !== lastPhase) {
          lastPhase = msg.phase;
          logger?.debug('InstrumentalAiSeparator', `AI worker phase=${msg.phase}`, {
            progress: msg.progress,
            message: msg.message,
            ortBackend: lastOrtBackend,
            ortFallbackReason: lastOrtFallbackReason ?? null,
            ortNumThreads: lastOrtNumThreads ?? null,
            inputWav,
            outputWav,
            elapsedMs: Date.now() - startedAt
          });
        }
        onProgress?.({
          phase: msg.phase || 'separate',
          progress: typeof msg.progress === 'number' ? msg.progress : 0,
          message: msg.message || '',
          ortBackend:
            msg.ortBackend === 'webgpu' || msg.ortBackend === 'wasm'
              ? msg.ortBackend
              : undefined,
          ortFallbackReason: msg.ortFallbackReason,
          ortNumThreads: msg.ortNumThreads
        });
        return;
      }
      if (msg.type === 'done' && msg.requestId === requestId) {
        succeed();
        return;
      }
      if (msg.type === 'error' && msg.requestId === requestId) {
        fail(msg.message || 'AI separation failed', false, 'worker_error');
      }
    };

    if (worker.kind === 'utility') {
      worker.proc.on('message', onMsg);
      worker.proc.on('exit', (code) => {
        if (!settled) {
          fail(
            `Instrumental AI worker exited early (code ${code}` +
              `${separateSent ? '' : '; separate never sent — worker may not have become ready'})`,
            false,
            separateSent ? 'worker_exit' : 'worker_exit_before_ready'
          );
        }
      });
    } else if (worker.kind === 'fork') {
      worker.proc.on('message', onMsg);
      worker.proc.on('exit', (code) => {
        if (!settled) {
          fail(
            `Instrumental AI worker exited early (code ${code}` +
              `${separateSent ? '' : '; separate never sent — worker may not have become ready'})`,
            false,
            separateSent ? 'worker_exit' : 'worker_exit_before_ready'
          );
        }
      });
      worker.proc.on('error', (err) => fail(err.message, false, 'worker_spawn_error'));
    } else {
      // hidden-renderer: window may already be warm (ready ping fired before attach).
      // Probe ensures the window exists, then synthesize ready so sendSeparate runs.
      const hidden = getInstrumentalAiHiddenRenderer(logger);
      void (async () => {
        try {
          await hidden.probeWebGpu();
          onMsg({
            type: 'progress',
            requestId: 0,
            phase: 'ready',
            progress: 0,
            message: 'Instrumental AI Hidden Renderer ready'
          });
        } catch (err) {
          fail(
            err instanceof Error ? err.message : String(err),
            false,
            'hidden_renderer_ready_error'
          );
        }
      })();
    }

    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    logger?.info('InstrumentalAiSeparator', 'AI separate start', {
      method,
      modelId,
      modelPath,
      modelVersion: catalog?.version,
      modelLabel: catalog?.label,
      modelBytes: safeSize(modelPath),
      ortDir,
      // Preference label only — live routing uses Hidden Renderer probe in resolveWorkerHandle.
      ortBackendPreferred: worker.kind === 'hidden-renderer' ? 'webgpu' : 'wasm',
      ortBackend: 'pending',
      ortNumThreads: effectiveAiCpuThreads,
      aiEnableGpu: options.aiEnableGpu ?? null,
      aiGpuSupported: options.aiGpuSupported ?? null,
      inputWav,
      inputWavBytes: safeSize(inputWav),
      inputExt: path.extname(inputWav).toLowerCase(),
      outputWav,
      workerKind: worker.kind,
      workerScript: worker.script,
      timeoutMs: hardTimeoutMs,
      idleTimeoutMs: AI_SEPARATION_IDLE_TIMEOUT_MS,
      ortSilenceTimeoutMs: AI_SEPARATION_ORT_SILENCE_TIMEOUT_MS,
      parentKeepAliveMs: AI_SEPARATION_PARENT_KEEPALIVE_MS,
      readyTimeoutMs: AI_WORKER_READY_TIMEOUT_MS,
      durationSec: options.durationSec ?? null,
      note:
        'Waiting for worker ready ping before sending separate; ortBackend finalized after session.create'
    });

    armIdleWatchdog();
    readyTimer = setTimeout(() => {
      if (!separateSent && !settled) {
        fail(
          `Instrumental AI worker did not become ready within ${Math.round(
            AI_WORKER_READY_TIMEOUT_MS / 1000
          )}s (no ready ping). Worker script: ${worker.script}`,
          false,
          'ready_timeout'
        );
      }
    }, AI_WORKER_READY_TIMEOUT_MS);
    hardTimer = setTimeout(() => {
      fail(
        `Instrumental AI separation timed out after ${Math.round(hardTimeoutMs / 60000)} min ` +
          `(track ~${Math.round(options.durationSec || 240)}s; last phase=${lastPhase || 'none'}` +
          `${lastProgressMessage ? `; ${lastProgressMessage}` : ''}). ` +
          `CPU ORT WASM is slow for long tracks; cancel, retry, or use an algorithmic instrumental method.`,
        false,
        'hard_timeout'
      );
    }, hardTimeoutMs);
  });
}
