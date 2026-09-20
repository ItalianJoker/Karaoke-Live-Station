/**
 * Signals that Hidden Renderer WebGPU failed and main must re-route the job
 * to utilityProcess WASM — never run multithreaded ORT WASM inside the
 * BrowserWindow (file:// lacks crossOriginIsolated / SharedArrayBuffer).
 */

/** Max wait for ORT InferenceSession.create(WebGPU) before WASM re-route. */
export const WEBGPU_SESSION_TIMEOUT_MS = 15_000;

/** Max wait for adapter.requestDevice() during Hidden Renderer capability probe. */
export const WEBGPU_DEVICE_PROBE_TIMEOUT_MS = 5_000;

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

/**
 * Race a promise against a wall-clock timeout. Rejects with a clear label so
 * callers can map hangs (e.g. JSEP deadlock) onto GpuFallbackRequestedError.
 */
export async function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
