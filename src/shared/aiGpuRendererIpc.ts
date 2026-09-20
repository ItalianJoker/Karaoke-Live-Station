/**
 * IPC channel names + probe payload for the Instrumental AI Hidden Renderer
 * (BrowserWindow hosting onnxruntime-web WebGPU).
 *
 * Keep names stable (Safety-First) — main, preload-free nodeIntegration window,
 * and verify scripts all share this module.
 */

export const AI_GPU_RENDERER_CHANNELS = {
  /** Main → renderer: run separation job (same payload as utilityProcess). */
  separate: 'ai-gpu-renderer:separate',
  /** Main → renderer: request navigator.gpu + requestAdapter probe. */
  probe: 'ai-gpu-renderer:probe',
  /** Renderer → main: progress | done | error | probe-result. */
  message: 'ai-gpu-renderer:message'
} as const;

export type AiGpuRendererProbeResult = {
  available: boolean;
  /**
   * True only when requestAdapter() and requestDevice() both succeed
   * (device probe is raced at 5s). Adapter alone is a false positive for
   * ORT WebGPU readiness.
   */
  adapterOk: boolean;
  reason?: string;
  navigatorType: string;
};
