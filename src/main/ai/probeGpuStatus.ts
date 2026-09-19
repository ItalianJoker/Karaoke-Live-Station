/**
 * Main-process GPU probe for Instrumental AI (WebGPU EP eligibility + badge label).
 *
 * Uses Electron `app.getGPUFeatureStatus` / `getGPUInfo` when available.
 * Does not require a renderer WebGPU adapter — utilityProcess EP availability
 * still falls back to WASM on session.create failure.
 */
import { app } from 'electron';
import type { GpuStatus } from '../../shared/gpuStatus';
import { GPU_STATUS_UNSUPPORTED } from '../../shared/gpuStatus';

function isGpuFeatureEnabled(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  // Electron reports e.g. 'enabled', 'enabled_on', 'disabled', 'disabled_software', …
  return value === 'enabled' || value.startsWith('enabled');
}

/**
 * Probe GPU support for ORT WebGPU preference + Settings live badge.
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
      /* GPUInfo optional — feature status is enough for isSupported */
    }

    const isSupported = webgpuOk || webglOk || compositingOk;
    if (!isSupported) {
      return { ...GPU_STATUS_UNSUPPORTED, gpuName, vendor };
    }
    return { isSupported: true, gpuName, vendor };
  } catch {
    return { ...GPU_STATUS_UNSUPPORTED };
  }
}
