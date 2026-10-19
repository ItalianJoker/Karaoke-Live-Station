/**
 * GPU probe result for Settings badge + ORT provider selection.
 * Populated by main-process IPC `system:get-gpu-status`.
 *
 * Honesty contract (Instrumental AI):
 * - `isSupported` means the **AI engine** can host ORT WebGPU — via the Hidden
 *   BrowserWindow renderer (`navigator.gpu` + adapter), not merely that
 *   Chromium/main sees a GPU. utilityProcess never has WebGPU.
 * - `hardwareGpuPresent` / `gpuName` still describe the machine GPU for operators.
 * - `adapters[]` lists inventory (WebGPU effective + getGPUInfo devices);
 *   badge must show the **effective** WebGPU adapter, never assume discrete
 *   just because preference is on.
 */

export type GpuAdapterClass = 'high-performance' | 'low-power' | 'unknown';

export type GpuAdapterInfo = {
  /** Stable key for Settings (hash of vendor+device+description). */
  id: string;
  /** Operator label e.g. "NVIDIA GeForce …" / "Intel Iris …" / "Apple M2". */
  label: string;
  vendor?: string;
  device?: string;
  architecture?: string;
  class: GpuAdapterClass;
  source: 'webgpu' | 'gpuInfo';
  /** Currently effective for AI WebGPU (Hidden Renderer). */
  selected?: boolean;
};

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
  /** Human-readable adapter / device name when available (effective WebGPU preferred). */
  gpuName?: string;
  /** Vendor string when available (e.g. from GPUInfo). */
  vendor?: string;
  /** Inventory of probed adapters (WebGPU + getGPUInfo). */
  adapters?: GpuAdapterInfo[];
  /** Effective WebGPU adapter for AI when probe succeeded. */
  effectiveAdapter?: GpuAdapterInfo;
  /** Persisted preference echoed for Settings honesty / mismatch warning. */
  preference?: 'high-performance' | 'low-power' | 'system';
};

export const GPU_STATUS_UNSUPPORTED: GpuStatus = {
  isSupported: false,
  hardwareGpuPresent: false,
  workerWebGpuAvailable: false,
  workerOrtBackend: 'wasm',
  workerOrtNote:
    'Instrumental AI: no WebGPU adapter in Hidden Renderer — utilityProcess WASM fallback',
  adapters: []
};

/** Stable id from label parts (no crypto dependency in renderer/shared). */
export function gpuAdapterId(parts: {
  vendor?: string;
  device?: string;
  label?: string;
  source: string;
}): string {
  const raw = [parts.source, parts.vendor || '', parts.device || '', parts.label || '']
    .join('|')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) | 0;
  }
  return `gpu_${(hash >>> 0).toString(16)}`;
}
