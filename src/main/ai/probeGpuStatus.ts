/**
 * Main-process GPU probe for Instrumental AI Settings badge + EP preference.
 *
 * Uses Electron `app.getGPUFeatureStatus` / `getGPUInfo` for hardware inventory,
 * then probes the Hidden BrowserWindow for real `navigator.gpu` + adapter
 * (ORT WebGPU EP). utilityProcess never has WebGPU — do not treat hardware
 * alone as “GPU active” for Instrumental AI.
 *
 * Honesty: list **all** `gpuDevice[]` entries (not only `[0]`); badge uses the
 * **effective** WebGPU adapter from the Hidden Renderer probe.
 */
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import type { GpuAdapterInfo, GpuStatus } from '../../shared/gpuStatus';
import { GPU_STATUS_UNSUPPORTED, gpuAdapterId } from '../../shared/gpuStatus';
import {
  aiGpuPreferenceToPowerPreference,
  classifyGpuAdapterLabel,
  coerceAiGpuPreference,
  type AiGpuPreference
} from '../../shared/aiGpuPreference';
import { getInstrumentalAiHiddenRenderer } from '../services/InstrumentalAiHiddenRenderer';

function isGpuFeatureEnabled(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  // Electron reports e.g. 'enabled', 'enabled_on', 'disabled', 'disabled_software', …
  return value === 'enabled' || value.startsWith('enabled');
}

function readLaunchGpuPreference(): AiGpuPreference {
  try {
    const prefsPath = path.join(app.getPath('userData'), 'launch-prefs.json');
    if (!fs.existsSync(prefsPath)) return coerceAiGpuPreference(undefined);
    const parsed = JSON.parse(fs.readFileSync(prefsPath, 'utf8')) as {
      aiGpuPreference?: unknown;
    };
    return coerceAiGpuPreference(parsed.aiGpuPreference);
  } catch {
    return coerceAiGpuPreference(undefined);
  }
}

/**
 * Probe GPU support for Settings badge + whether AI should prefer WebGPU EP.
 */
export async function probeGpuStatus(): Promise<GpuStatus> {
  try {
    const preference = readLaunchGpuPreference();
    const powerPreference = aiGpuPreferenceToPowerPreference(preference);

    const featureStatus = (
      typeof app.getGPUFeatureStatus === 'function' ? app.getGPUFeatureStatus() : {}
    ) as Record<string, string>;

    const webglOk = isGpuFeatureEnabled(featureStatus.webgl);
    const compositingOk = isGpuFeatureEnabled(featureStatus.gpu_compositing);
    const webgpuOk = isGpuFeatureEnabled(featureStatus.webgpu);

    const adapters: GpuAdapterInfo[] = [];
    let gpuName: string | undefined;
    let vendor: string | undefined;

    try {
      if (typeof app.getGPUInfo === 'function') {
        const info = (await app.getGPUInfo('basic')) as {
          gpuDevice?: Array<{
            deviceString?: string;
            vendorId?: number;
            deviceId?: number;
            active?: boolean;
          }>;
          auxAttributes?: { glRenderer?: string; glVendor?: string };
        };
        const devices = Array.isArray(info?.gpuDevice) ? info.gpuDevice : [];
        for (const device of devices) {
          const label =
            device?.deviceString && String(device.deviceString).trim()
              ? String(device.deviceString).trim()
              : '';
          if (!label) continue;
          adapters.push({
            id: gpuAdapterId({
              label,
              vendor: device.vendorId != null ? String(device.vendorId) : undefined,
              device: device.deviceId != null ? String(device.deviceId) : undefined,
              source: 'gpuInfo'
            }),
            label,
            vendor: device.vendorId != null ? `vendorId=${device.vendorId}` : undefined,
            device: device.deviceId != null ? String(device.deviceId) : undefined,
            class: classifyGpuAdapterLabel(label),
            source: 'gpuInfo'
          });
        }
        // Prefer first device only as fallback name when WebGPU probe has no label.
        if (adapters.length > 0) {
          gpuName = adapters[0].label;
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

    // Real AI WebGPU = Hidden Renderer adapter+device (not utilityProcess, not hardware-only).
    let workerWebGpuAvailable = false;
    let workerOrtNote =
      'Instrumental AI: probing Hidden Renderer WebGPU (utilityProcess has no navigator.gpu)';
    let effectiveAdapter: GpuAdapterInfo | undefined;
    try {
      const hidden = getInstrumentalAiHiddenRenderer();
      const probe = await hidden.probeWebGpu({
        forceRefresh: true,
        powerPreference
      });
      workerWebGpuAvailable = probe.adapterOk === true;
      if (workerWebGpuAvailable) {
        const label =
          (probe.adapterLabel && probe.adapterLabel.trim()) ||
          [probe.adapterVendor, probe.adapterDevice].filter(Boolean).join(' ').trim() ||
          gpuName ||
          'WebGPU adapter';
        const cls =
          probe.adapterClass ||
          classifyGpuAdapterLabel(label) ||
          (powerPreference === 'low-power' ? 'low-power' : 'high-performance');
        effectiveAdapter = {
          id: gpuAdapterId({
            label,
            vendor: probe.adapterVendor,
            device: probe.adapterDevice,
            source: 'webgpu'
          }),
          label,
          vendor: probe.adapterVendor,
          device: probe.adapterDevice,
          architecture: probe.adapterArchitecture,
          class: cls,
          source: 'webgpu',
          selected: true
        };
        // Prefer effective WebGPU name on the badge (honest capability).
        gpuName = label;
        if (probe.adapterVendor) vendor = probe.adapterVendor;
        // Dedupe: if gpuInfo already listed the same label, mark selected there too.
        let matched = false;
        for (const a of adapters) {
          if (a.label.toLowerCase() === label.toLowerCase()) {
            a.selected = true;
            matched = true;
          }
        }
        if (!matched) {
          adapters.unshift(effectiveAdapter);
        }
        workerOrtNote = `Instrumental AI Hidden Renderer: WebGPU ready (${label})`;
      } else {
        workerOrtNote =
          probe.reason ||
          'Hidden Renderer has no WebGPU device — Instrumental AI uses WASM CPU in utilityProcess';
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
      vendor,
      adapters,
      effectiveAdapter,
      preference
    };
  } catch {
    return { ...GPU_STATUS_UNSUPPORTED };
  }
}
