/**
 * Signals that Hidden Renderer WebGPU failed and main must re-route the job
 * to utilityProcess WASM — never run multithreaded ORT WASM inside the
 * BrowserWindow (file:// lacks crossOriginIsolated / SharedArrayBuffer).
 */

export class GpuFallbackRequestedError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    const msg = (reason || 'WebGPU unavailable').trim() || 'WebGPU unavailable';
    super(msg);
    this.name = 'GpuFallbackRequestedError';
    this.reason = msg;
  }
}

export function isGpuFallbackRequestedError(err: unknown): err is GpuFallbackRequestedError {
  return (
    err instanceof GpuFallbackRequestedError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { name?: string }).name === 'GpuFallbackRequestedError')
  );
}
