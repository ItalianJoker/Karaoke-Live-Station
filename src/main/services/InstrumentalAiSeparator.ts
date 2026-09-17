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
};

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

  const kill = () => {
    try {
      if (worker.kind === 'utility') worker.proc.kill();
      else worker.proc.kill();
    } catch {
      /* ignore */
    }
  };

  return new Promise<void>((resolve, reject) => {
    const fail = (message: string, asAbort = false) => {
      if (settled) return;
      settled = true;
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
      signal?.removeEventListener('abort', onAbort);
      kill();
      resolve();
    };

    const onAbort = () => fail('Aborted', true);

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
      `AI separate start method=${method} model=${modelPath}`
    );

    // Hard timeout (long tracks + large models)
    setTimeout(
      () => fail('Instrumental AI separation timed out'),
      45 * 60 * 1000
    );
  });
}
