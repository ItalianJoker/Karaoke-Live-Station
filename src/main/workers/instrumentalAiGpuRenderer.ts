/**
 * Hidden BrowserWindow entry for Download Instrumental AI with real WebGPU.
 *
 * Loaded inside a Chromium renderer (`show: false`, `backgroundThrottling: false`,
 * nodeIntegration) so `navigator.gpu` exists — unlike utilityProcess where ORT
 * strips the WebGPU EP (`backend not found`).
 *
 * Main ↔ renderer protocol (IPC):
 *   main → renderer: `ai-gpu-renderer:separate` | `ai-gpu-renderer:probe`
 *   renderer → main: `ai-gpu-renderer:message` (progress/done/error/probe-result)
 */
import { ipcRenderer } from 'electron';
import {
  runInstrumentalAiSeparate,
  type InstrumentalAiOutMessage,
  type InstrumentalAiSeparateRequest
} from './instrumentalAiSeparateCore';
import { probeWorkerWebGpu } from '../../shared/aiWorkerWebGpu';
import {
  AI_GPU_RENDERER_CHANNELS,
  type AiGpuRendererProbeResult
} from '../../shared/aiGpuRendererIpc';

function post(msg: InstrumentalAiOutMessage): void {
  ipcRenderer.send(AI_GPU_RENDERER_CHANNELS.message, msg);
}

async function probeAdapter(): Promise<AiGpuRendererProbeResult> {
  const sync = probeWorkerWebGpu();
  if (!sync.available) {
    return {
      available: false,
      adapterOk: false,
      reason: sync.reason || 'navigator.gpu missing in Hidden Renderer',
      navigatorType: sync.navigatorType
    };
  }
  try {
    const gpu = (
      globalThis as { navigator?: { gpu?: { requestAdapter?: () => Promise<unknown> } } }
    ).navigator?.gpu;
    const adapter = gpu?.requestAdapter ? await gpu.requestAdapter() : null;
    if (!adapter) {
      return {
        available: true,
        adapterOk: false,
        reason: 'navigator.gpu.requestAdapter() returned null',
        navigatorType: sync.navigatorType
      };
    }
    return {
      available: true,
      adapterOk: true,
      navigatorType: sync.navigatorType
    };
  } catch (err) {
    return {
      available: true,
      adapterOk: false,
      reason: err instanceof Error ? err.message : String(err),
      navigatorType: sync.navigatorType
    };
  }
}

ipcRenderer.on(AI_GPU_RENDERER_CHANNELS.probe, () => {
  void probeAdapter().then((result) => {
    ipcRenderer.send(AI_GPU_RENDERER_CHANNELS.message, {
      type: 'probe-result',
      ...result
    });
  });
});

ipcRenderer.on(AI_GPU_RENDERER_CHANNELS.separate, (_event, raw: unknown) => {
  const data = raw as InstrumentalAiSeparateRequest | null;
  if (!data || data.type !== 'separate') return;
  void runInstrumentalAiSeparate(data, post).catch((err) => {
    post({
      type: 'error',
      requestId: data.requestId,
      message: err instanceof Error ? err.message : String(err)
    });
  });
});

// Ready ping (requestId 0) — mirrors utilityProcess worker boot protocol.
post({
  type: 'progress',
  requestId: 0,
  phase: 'ready',
  progress: 0,
  message: 'Instrumental AI Hidden Renderer ready'
});

// Eager probe so main can cache WebGPU capability without an extra round-trip.
void probeAdapter().then((result) => {
  ipcRenderer.send(AI_GPU_RENDERER_CHANNELS.message, {
    type: 'probe-result',
    ...result
  });
});
