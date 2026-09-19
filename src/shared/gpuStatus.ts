/**
 * GPU probe result for Settings badge + ORT provider selection.
 * Populated by main-process IPC `system:get-gpu-status`.
 *
 * Honesty contract (Instrumental AI):
 * - `isSupported` means the **AI engine** can host ORT WebGPU — via the Hidden
 *   BrowserWindow renderer (`navigator.gpu` + adapter), not merely that
 *   Chromium/main sees a GPU. utilityProcess never has WebGPU.
 * - `hardwareGpuPresent` / `gpuName` still describe the machine GPU for operators.
 */
export type GpuStatus = {
  /**
   * True only when Instrumental AI ORT can use the WebGPU execution provider
   * (Hidden Renderer adapter OK). False → WASM CPU path.
   */
  isSupported: boolean;
  /** True when main-process Chromium reports a usable GPU (WebGPU/WebGL/compositing). */
  hardwareGpuPresent?: boolean;
  /**
   * Explicit: Hidden Renderer WebGPU EP availability for Instrumental AI.
   * False when no adapter / GPU off → utilityProcess WASM.
   */
  workerWebGpuAvailable?: boolean;
  /** Actual ORT backend Instrumental AI will prefer given current architecture. */
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
  workerOrtNote:
    'Instrumental AI: no WebGPU adapter in Hidden Renderer — utilityProcess WASM fallback'
};
