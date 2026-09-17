/**
 * Spawns a utility process (or Node fork fallback) to run offline AI vocal
 * separation for Download Instrumental — keeps ORT/STFT off the Control UI thread.
 */
import { utilityProcess, type UtilityProcess } from 'electron';
import { fork, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { Logger } from './Logger';
import type { AiVocalRemoverMethod } from '../../shared/vocalRemover';

export type InstrumentalAiProgress = {
  phase: 'model' | 'decode' | 'separate' | 'ready' | 'error';
  progress: number;
  message: string;
};

export type InstrumentalAiSeparateOptions = {
  method: AiVocalRemoverMethod;
  modelPath: string;
  ortDir: string;
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
/** Fail if the worker goes silent this long (no progress heartbeat). */
export const AI_SEPARATION_IDLE_TIMEOUT_MS = 8 * 60 * 1000;

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
  | { kind: 'utility'; proc: UtilityProcess }
  | { kind: 'fork'; proc: ChildProcess };

function spawnWorker(): WorkerHandle {
  const script = resolveWorkerScript();
  if (typeof utilityProcess?.fork === 'function') {
    const proc = utilityProcess.fork(script, [], {
      serviceName: 'instrumental-ai',
      stdio: 'pipe'
    });
    return { kind: 'utility', proc };
  }
  const proc = fork(script, [], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  });
  return { kind: 'fork', proc };
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

  const worker = spawnWorker();
  let requestId = 1;
  let settled = false;
  let hardTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const hardTimeoutMs = computeAiSeparationTimeoutMs(options.durationSec);

  const kill = () => {
    try {
      if (worker.kind === 'utility') worker.proc.kill();
      else worker.proc.kill();
    } catch {
      /* ignore */
    }
  };

  const clearTimers = () => {
    if (hardTimer) {
      clearTimeout(hardTimer);
      hardTimer = null;
    }
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  return new Promise<void>((resolve, reject) => {
    const fail = (message: string, asAbort = false) => {
      if (settled) return;
      settled = true;
      clearTimers();
      signal?.removeEventListener('abort', onAbort);
      kill();
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
      settled = true;
      clearTimers();
      signal?.removeEventListener('abort', onAbort);
      kill();
      resolve();
    };

    const onAbort = () => fail('Aborted', true);

    const armIdleWatchdog = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        fail(
          `Instrumental AI separation stalled (no progress for ${Math.round(
            AI_SEPARATION_IDLE_TIMEOUT_MS / 60000
          )} min). Try again or pick an algorithmic Download Instrumental method.`
        );
      }, AI_SEPARATION_IDLE_TIMEOUT_MS);
    };

    const onMsg = (raw: unknown) => {
      const msg = raw as {
        type?: string;
        requestId?: number;
        phase?: InstrumentalAiProgress['phase'];
        progress?: number;
        message?: string;
        outputWav?: string;
      };
      if (!msg?.type) return;
      if (msg.type === 'progress') {
        // Any progress (including worker-ready ping) proves the child is alive.
        armIdleWatchdog();
        if (msg.requestId === 0) return; // worker ready ping
        onProgress?.({
          phase: msg.phase || 'separate',
          progress: typeof msg.progress === 'number' ? msg.progress : 0,
          message: msg.message || ''
        });
        return;
      }
      if (msg.type === 'done' && msg.requestId === requestId) {
        succeed();
        return;
      }
      if (msg.type === 'error' && msg.requestId === requestId) {
        fail(msg.message || 'AI separation failed');
      }
    };

    if (worker.kind === 'utility') {
      worker.proc.on('message', onMsg);
      worker.proc.on('exit', (code) => {
        if (!settled) fail(`Instrumental AI worker exited early (code ${code})`);
      });
      // Give the worker a tick to bind parentPort
      setTimeout(() => {
        worker.proc.postMessage({
          type: 'separate',
          requestId,
          method,
          modelPath,
          ortDir,
          inputWav,
          outputWav
        });
      }, 50);
    } else {
      worker.proc.on('message', onMsg);
      worker.proc.on('exit', (code) => {
        if (!settled) fail(`Instrumental AI worker exited early (code ${code})`);
      });
      worker.proc.on('error', (err) => fail(err.message));
      worker.proc.send({
        type: 'separate',
        requestId,
        method,
        modelPath,
        ortDir,
        inputWav,
        outputWav
      });
    }

    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    logger?.info(
      'InstrumentalAiSeparator',
      `AI separate start method=${method} model=${modelPath} timeoutMs=${hardTimeoutMs} durationSec=${options.durationSec ?? 'n/a'}`
    );

    armIdleWatchdog();
    hardTimer = setTimeout(() => {
      fail(
        `Instrumental AI separation timed out after ${Math.round(hardTimeoutMs / 60000)} min (track ~${Math.round(
          options.durationSec || 240
        )}s). CPU WASM can be slow; retry or use an algorithmic instrumental method.`
      );
    }, hardTimeoutMs);
  });
}
