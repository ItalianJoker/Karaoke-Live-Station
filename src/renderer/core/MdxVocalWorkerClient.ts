/**
 * Client for the MDX vocal-separation Web Worker.
 * Falls back to in-process MdxNetSeparator (with yields) if Worker creation fails.
 */
import { MdxNetSeparator, type MdxProgress } from './MdxNetSeparator';
import type { MdxWorkerInMessage, MdxWorkerOutMessage } from '../workers/mdxVocalWorker';

type ProgressListener = (info: MdxProgress) => void;

export class MdxVocalWorkerClient {
  private worker: Worker | null = null;
  private fallback: MdxNetSeparator | null = null;
  private useFallback = false;
  private nextRequestId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (err: Error) => void;
      kind: 'load' | 'separate';
    }
  >();
  private readonly listeners = new Set<ProgressListener>();
  private modelLoaded = false;
  private wasmPaths: string | { wasm: string; mjs: string } | null = null;

  public onProgress(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(info: MdxProgress): void {
    for (const listener of this.listeners) {
      try {
        listener(info);
      } catch {
        /* ignore */
      }
    }
  }

  private ensureWorker(): void {
    if (this.useFallback || this.worker) return;
    try {
      this.worker = new Worker(new URL('../workers/mdxVocalWorker.ts', import.meta.url), {
        type: 'module'
      });
      this.worker.onmessage = (event: MessageEvent<MdxWorkerOutMessage>) => {
        this.handleWorkerMessage(event.data);
      };
      this.worker.onerror = (err) => {
        console.warn('[MdxVocalWorkerClient] Worker error — falling back to main thread', err);
        this.migrateToFallback(new Error(err.message || 'MDX worker failed'));
      };
    } catch (err) {
      console.warn('[MdxVocalWorkerClient] Worker unavailable — using main-thread MDX', err);
      this.useFallback = true;
      this.fallback = new MdxNetSeparator();
      this.fallback.onProgress((info) => this.emit(info));
    }
  }

  private migrateToFallback(reason: Error): void {
    this.useFallback = true;
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        /* ignore */
      }
      this.worker = null;
    }
    for (const [id, pending] of this.pending) {
      pending.reject(reason);
      this.pending.delete(id);
    }
    if (!this.fallback) {
      this.fallback = new MdxNetSeparator();
      this.fallback.onProgress((info) => this.emit(info));
    }
    this.modelLoaded = false;
  }

  private handleWorkerMessage(data: MdxWorkerOutMessage): void {
    if (data.type === 'progress') {
      this.emit({
        phase: data.phase,
        progress: data.progress,
        message: data.message
      });
      return;
    }
    if (data.type === 'modelReady') {
      const pending = this.pending.get(data.requestId);
      if (!pending) return;
      this.pending.delete(data.requestId);
      this.modelLoaded = true;
      pending.resolve(undefined);
      return;
    }
    if (data.type === 'result') {
      const pending = this.pending.get(data.requestId);
      if (!pending) return;
      this.pending.delete(data.requestId);
      pending.resolve({ left: data.left, right: data.right });
      return;
    }
    if (data.type === 'error') {
      const pending = this.pending.get(data.requestId);
      if (!pending) return;
      this.pending.delete(data.requestId);
      pending.reject(new Error(data.message));
    }
  }

  public async loadModel(
    modelBuffer: ArrayBuffer,
    wasmPaths: string | { wasm: string; mjs: string }
  ): Promise<void> {
    this.wasmPaths = wasmPaths;
    this.ensureWorker();

    if (this.useFallback) {
      if (!this.fallback) {
        this.fallback = new MdxNetSeparator();
        this.fallback.onProgress((info) => this.emit(info));
      }
      await this.fallback.loadModel(modelBuffer, wasmPaths);
      this.modelLoaded = true;
      return;
    }

    if (this.modelLoaded) return;

    const requestId = this.nextRequestId++;
    const bufferCopy = modelBuffer.slice(0);
    await new Promise<void>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: () => resolve(),
        reject,
        kind: 'load'
      });
      const msg: MdxWorkerInMessage = {
        type: 'loadModel',
        requestId,
        modelBuffer: bufferCopy,
        wasmPaths
      };
      this.worker!.postMessage(msg, [bufferCopy]);
    });
  }

  public async separateInstrumental(
    left: Float32Array,
    right: Float32Array
  ): Promise<{ left: Float32Array; right: Float32Array }> {
    this.ensureWorker();

    if (this.useFallback) {
      if (!this.fallback || !this.modelLoaded) {
        throw new Error('MDX model not loaded');
      }
      return this.fallback.separateInstrumental(left, right);
    }

    if (!this.modelLoaded) throw new Error('MDX model not loaded');

    const requestId = this.nextRequestId++;
    // Copy so we can transfer without detaching caller-owned channel data.
    const leftCopy = left.slice();
    const rightCopy = right.slice();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as { left: Float32Array; right: Float32Array }),
        reject,
        kind: 'separate'
      });
      const msg: MdxWorkerInMessage = {
        type: 'separate',
        requestId,
        left: leftCopy,
        right: rightCopy
      };
      this.worker!.postMessage(msg, [leftCopy.buffer, rightCopy.buffer]);
    });
  }

  public dispose(): void {
    for (const [, pending] of this.pending) {
      pending.reject(new Error('MDX worker disposed'));
    }
    this.pending.clear();
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        /* ignore */
      }
      this.worker = null;
    }
    this.fallback = null;
    this.modelLoaded = false;
  }
}
