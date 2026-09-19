/**
 * WebGPU capability probe for the Instrumental AI worker process.
 *
 * ORT WebGPU EP (onnxruntime-web) needs `navigator.gpu`. Electron
 * `utilityProcess.fork` (and Node `fork` with ELECTRON_RUN_AS_NODE) do not
 * expose a WebGPU adapter — unlike BrowserWindow / renderer. Main-process
 * `app.getGPUFeatureStatus` can still report hardware GPU as enabled, which
 * is why Settings may show GPU while separation runs WASM on CPU.
 */

export type AiOrtBackend = 'webgpu' | 'wasm';

export type WorkerWebGpuProbe = {
  /** True only when `navigator.gpu` exists in this process. */
  available: boolean;
  /** Short machine-readable reason when unavailable. */
  reason?: string;
  /** `typeof navigator` in this process (often `"undefined"` in utilityProcess). */
  navigatorType: string;
};

/**
 * Probe whether this process can attempt ORT WebGPU.
 * Safe to call from utilityProcess, Node fork, or renderer.
 */
export function probeWorkerWebGpu(): WorkerWebGpuProbe {
  const nav =
    typeof globalThis !== 'undefined'
      ? (globalThis as { navigator?: unknown }).navigator
      : undefined;
  const navigatorType = typeof nav;
  if (navigatorType === 'undefined' || nav == null) {
    return {
      available: false,
      reason: 'navigator undefined (utilityProcess/Node — no WebGPU)',
      navigatorType
    };
  }
  const gpu = (nav as { gpu?: unknown }).gpu;
  if (gpu == null) {
    return {
      available: false,
      reason: 'navigator.gpu missing (WebGPU API not exposed in this process)',
      navigatorType
    };
  }
  return { available: true, navigatorType };
}

/**
 * Resolve providers after combining Settings GPU toggle, main GPU probe, and
 * in-process WebGPU API availability. Never requests webgpu when `navigator.gpu`
 * is absent — avoids a doomed session.create + silent WASM fallback.
 */
export function resolveWorkerOrtProviders(opts: {
  aiEnableGpu?: boolean | null;
  aiGpuSupported?: boolean | null;
  /** Pre-computed probe; when omitted, probes this process. */
  workerWebGpu?: WorkerWebGpuProbe;
  resolveProviders: (
    aiEnableGpu: boolean | null | undefined,
    gpuSupported: boolean | null | undefined
  ) => AiOrtBackend[];
}): {
  providers: AiOrtBackend[];
  preferWebGpu: boolean;
  workerWebGpu: WorkerWebGpuProbe;
  /** Why we will not attempt WebGPU (even if Settings toggle is on). */
  skipWebGpuReason?: string;
} {
  const workerWebGpu = opts.workerWebGpu ?? probeWorkerWebGpu();
  const providers = opts.resolveProviders(opts.aiEnableGpu, opts.aiGpuSupported);
  const wantWebGpu = providers[0] === 'webgpu';
  if (!wantWebGpu) {
    return { providers: ['wasm'], preferWebGpu: false, workerWebGpu };
  }
  if (!workerWebGpu.available) {
    return {
      providers: ['wasm'],
      preferWebGpu: false,
      workerWebGpu,
      skipWebGpuReason:
        workerWebGpu.reason || 'WebGPU unavailable in Instrumental AI worker process'
    };
  }
  return { providers, preferWebGpu: true, workerWebGpu };
}

/** Format an unknown thrown value for logs (never empty). */
export function formatOrtInitError(err: unknown): string {
  if (err instanceof Error) {
    const msg = (err.message || err.name || 'Error').trim();
    return msg || 'unknown Error';
  }
  const s = String(err ?? '').trim();
  return s || 'unknown non-Error throw';
}
