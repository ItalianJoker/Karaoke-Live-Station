/**
 * GPU probe result for Settings badge + ORT provider selection.
 * Populated by main-process IPC `system:get-gpu-status`.
 *
 * Honesty contract (Instrumental AI):
 * - `isSupported` means the **AI worker** can host ORT WebGPU — not merely that
 *   Chromium/main sees a GPU. Today AI runs in `utilityProcess` without
 *   `navigator.gpu`, so this is false and providers resolve to WASM.
 * - `hardwareGpuPresent` / `gpuName` still describe the machine GPU for operators.
 */
export type GpuStatus = {
  /**
   * True only when Instrumental AI ORT can use the WebGPU execution provider.
   * False → WASM CPU path (Settings must not imply “GPU active”).
   */
  isSupported: boolean;
  /** True when main-process Chromium reports a usable GPU (WebGPU/WebGL/compositing). */
  hardwareGpuPresent?: boolean;
  /**
   * Explicit: utilityProcess WebGPU EP availability for Instrumental AI.
   * Always false while separation runs in utilityProcess / Node fork.
   */
  workerWebGpuAvailable?: boolean;
  /** Actual ORT backend Instrumental AI will use given current architecture. */
  workerOrtBackend?: 'webgpu' | 'wasm';
  /** Short operator-facing reason when worker cannot use WebGPU. */
  workerOrtNote?: string;
  /** Human-readable adapter / device name when available. */
  gpuName?: string;
  /** Vendor string when available (e.g. from GPUInfo). */
  vendor?: string;
};

export const GPU_STATUS_UNSUPPORTED: GpuStatus = {
  isSupported: false,
  hardwareGpuPresent: false,
  workerWebGpuAvailable: false,
  workerOrtBackend: 'wasm',
  workerOrtNote: 'Instrumental AI runs in utilityProcess without navigator.gpu (ORT WebGPU unavailable)'
};
