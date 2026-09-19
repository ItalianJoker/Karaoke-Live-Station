/**
 * GPU probe result for Settings badge + ORT provider selection.
 * Populated by main-process IPC `system:get-gpu-status`.
 */
export type GpuStatus = {
  /** True when Electron GPU feature status / adapter looks usable for WebGPU EP. */
  isSupported: boolean;
  /** Human-readable adapter / device name when available. */
  gpuName?: string;
  /** Vendor string when available (e.g. from GPUInfo). */
  vendor?: string;
};

export const GPU_STATUS_UNSUPPORTED: GpuStatus = { isSupported: false };
