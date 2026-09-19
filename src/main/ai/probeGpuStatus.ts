/**
 * Main-process GPU probe for Instrumental AI Settings badge + EP preference.
 *
 * Uses Electron `app.getGPUFeatureStatus` / `getGPUInfo` for hardware presence,
 * then probes the Hidden BrowserWindow for real `navigator.gpu` + adapter
 * (ORT WebGPU EP). utilityProcess never has WebGPU — do not treat hardware
 * alone as “GPU active” for Instrumental AI.
 */
import { app } from 'electron';
import type { GpuStatus } from '../../shared/gpuStatus';
import { GPU_STATUS_UNSUPPORTED } from '../../shared/gpuStatus';
import { getInstrumentalAiHiddenRenderer } from '../services/InstrumentalAiHiddenRenderer';

function isGpuFeatureEnabled(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  // Electron reports e.g. 'enabled', 'enabled_on', 'disabled', 'disabled_software', …
  return value === 'enabled' || value.startsWith('enabled');
}

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

    // Real AI WebGPU = Hidden Renderer adapter (not utilityProcess, not hardware-only).
    let workerWebGpuAvailable = false;
    let workerOrtNote =
      'Instrumental AI: probing Hidden Renderer WebGPU (utilityProcess has no navigator.gpu)';
    try {
      const hidden = getInstrumentalAiHiddenRenderer();
      const probe = await hidden.probeWebGpu();
      workerWebGpuAvailable = probe.adapterOk === true;
      if (workerWebGpuAvailable) {
        workerOrtNote = 'Instrumental AI Hidden Renderer: WebGPU adapter available';
      } else {
        workerOrtNote =
          probe.reason ||
          'Hidden Renderer has no WebGPU adapter — Instrumental AI uses WASM CPU in utilityProcess';
      }
    } catch (err) {
      workerWebGpuAvailable = false;
      workerOrtNote =
        err instanceof Error
          ? `Hidden Renderer probe failed: ${err.message}`
          : 'Hidden Renderer WebGPU probe failed';
    }

    return {
      isSupported: workerWebGpuAvailable,
      hardwareGpuPresent,
      workerWebGpuAvailable,
      workerOrtBackend: workerWebGpuAvailable ? 'webgpu' : 'wasm',
      workerOrtNote,
      gpuName,
      vendor
    };
  } catch {
    return { ...GPU_STATUS_UNSUPPORTED };
  }
}
