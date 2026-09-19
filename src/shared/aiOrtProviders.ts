/**
 * ORT execution-provider selection for Download Instrumental AI (MDX / HTDemucs).
 *
 * GPU-First: when the user enables AI GPU and the main-process probe reports
 * support, prefer WebGPU then WASM. Otherwise WASM-only (CPU multithread via
 * `aiCpuThreads` / `ort.env.wasm.numThreads`).
 */

export type AiOrtExecutionProvider = 'webgpu' | 'wasm';

/**
 * Resolve ORT `executionProviders` for a separation session.
 *
 * @param aiEnableGpu - Persisted Settings toggle (default true)
 * @param gpuSupported - Result of `system:get-gpu-status` / main probe
 */
export function resolveAiOrtExecutionProviders(
  aiEnableGpu: boolean | undefined | null,
  gpuSupported: boolean | undefined | null
): AiOrtExecutionProvider[] {
  const enable = coerceAiEnableGpu(aiEnableGpu);
  const supported = gpuSupported === true;
  if (enable && supported) return ['webgpu', 'wasm'];
  return ['wasm'];
}

/** Coerce unknown persist/UI values to boolean; default true (GPU-First). */
export function coerceAiEnableGpu(value: unknown): boolean {
  if (value === false || value === 0 || value === '0' || value === 'false' || value === 'off') {
    return false;
  }
  if (value === true || value === 1 || value === '1' || value === 'true' || value === 'on') {
    return true;
  }
  // Missing / corrupt → GPU-First default
  return true;
}
