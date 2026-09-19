/**
 * Main-process GPU probe for Instrumental AI Settings badge + EP preference.
 *
 * Uses Electron `app.getGPUFeatureStatus` / `getGPUInfo` when available.
 *
 * Honesty: Chromium/main may report a GPU while Instrumental AI still runs in
 * `utilityProcess.fork`, where ORT WebGPU is unavailable (`backend not found`).
 * `isSupported` therefore reflects **worker ORT WebGPU capability** (currently
 * always false), not hardware presence. Hardware is surfaced via
 * `hardwareGpuPresent` / `gpuName` so the UI can say “CPU WASM fallback” without
 * pretending GPU inference is active.
 */
import { app } from 'electron';
import type { GpuStatus } from '../../shared/gpuStatus';
import { GPU_STATUS_UNSUPPORTED } from '../../shared/gpuStatus';

function isGpuFeatureEnabled(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  // Electron reports e.g. 'enabled', 'enabled_on', 'disabled', 'disabled_software', …
  return value === 'enabled' || value.startsWith('enabled');
}

const WORKER_ORT_NOTE =
  'Instrumental AI utilityProcess has no navigator.gpu — ORT uses WASM CPU (WebGPU EP backend not found)';

/**
 * Probe GPU support for Settings badge + whether AI should prefer WebGPU EP.
 */
export async function probeGpuStatus(): Promise<GpuStatus> {
  try {
    const featureStatus = (
      typeof app.getGPUFeatureStatus === 'function' ? app.getGPUFeatureStatus() : {}
    ) as Record<string, string>;

    const webglOk = isGpuFeatureEnabled(featureStatus.webgl);
    const compositingOk = isGpuFeatureEnabled(featureStatus.gpu_compositing);
    const webgpuOk = isGpuFeatureEnabled(featureStatus.webgpu);

    let gpuName: string | undefined;
    let vendor: string | undefined;

    try {
      if (typeof app.getGPUInfo === 'function') {
        const info = (await app.getGPUInfo('basic')) as {
          gpuDevice?: Array<{ deviceString?: string; vendorId?: number; deviceId?: number }>;
          auxAttributes?: { glRenderer?: string; glVendor?: string };
        };
        const device = info?.gpuDevice?.[0];
        if (device?.deviceString && String(device.deviceString).trim()) {
          gpuName = String(device.deviceString).trim();
        }
        const aux = info?.auxAttributes;
        if (!gpuName && aux?.glRenderer) {
          gpuName = String(aux.glRenderer).trim();
        }
        if (aux?.glVendor) {
          vendor = String(aux.glVendor).trim();
        }
      }
    } catch {
      /* GPUInfo optional — feature status is enough for hardwareGpuPresent */
    }

    const hardwareGpuPresent = webgpuOk || webglOk || compositingOk;

    // Instrumental AI separation runs in utilityProcess — ORT WebGPU EP is not
    // available there (production: "backend not found"). Do not set isSupported
    // from hardware alone or Settings/providers will claim a false GPU path.
    return {
      isSupported: false,
      hardwareGpuPresent,
      workerWebGpuAvailable: false,
      workerOrtBackend: 'wasm',
      workerOrtNote: WORKER_ORT_NOTE,
      gpuName,
      vendor
    };
  } catch {
    return { ...GPU_STATUS_UNSUPPORTED };
  }
}
