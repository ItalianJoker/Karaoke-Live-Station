/**
 * Hidden BrowserWindow host for Instrumental AI WebGPU inference.
 *
 * Chromium renderer context → real `navigator.gpu` / ORT WebGPU EP.
 * utilityProcess cannot host WebGPU (`backend not found`); keep that path for
 * WASM when GPU is off or no adapter is available.
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { Logger } from './Logger';
import {
  AI_GPU_RENDERER_CHANNELS,
  type AiGpuRendererProbeResult
} from '../../shared/aiGpuRendererIpc';
import type {
  InstrumentalAiOutMessage,
  InstrumentalAiSeparateRequest
} from '../workers/instrumentalAiSeparateCore';

const READY_TIMEOUT_MS = 60_000;
const PROBE_TIMEOUT_MS = 20_000;

export type HiddenRendererJobHandlers = {
  onMessage: (msg: InstrumentalAiOutMessage | (AiGpuRendererProbeResult & { type: 'probe-result' })) => void;
};

function resolveGpuRendererScript(): string {
  const candidates = [
    path.join(__dirname, 'instrumentalAiGpuRenderer.js'),
    path.join(__dirname, 'workers', 'instrumentalAiGpuRenderer.js'),
    path.join(app.getAppPath(), 'dist-electron', 'main', 'instrumentalAiGpuRenderer.js'),
    path.join(process.cwd(), 'dist-electron', 'main', 'instrumentalAiGpuRenderer.js')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    `Instrumental AI GPU renderer script not found. Looked in: ${candidates.join(', ')}`
  );
}

function resolveGpuRendererHtml(scriptPath: string): string {
  const beside = path.join(path.dirname(scriptPath), 'instrumentalAiGpuRenderer.html');
  // Always rewrite — Vite rebuilds move the absolute script path.
  // Use require() — the Vite electron entry is CommonJS, not a classic browser script.
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><title>KLS AI GPU Renderer</title></head>
<body>
<script>
  try {
    require(${JSON.stringify(scriptPath)});
  } catch (err) {
    console.error('[KLS AI GPU Renderer] failed to load', err);
  }
</script>
</body>
</html>`;
  fs.writeFileSync(beside, html, 'utf8');
  return beside;
}

/**
 * Singleton Hidden Renderer lifecycle for Settings probe + separation jobs.
 */
export class InstrumentalAiHiddenRenderer {
  private win: BrowserWindow | null = null;
  private ready = false;
  private readyWaiters: Array<() => void> = [];
  private lastProbe: AiGpuRendererProbeResult | null = null;
  private probeWaiters: Array<(r: AiGpuRendererProbeResult) => void> = [];
  private jobHandler: HiddenRendererJobHandlers | null = null;
  private ipcBound = false;
  private logger?: Logger;

  constructor(logger?: Logger) {
    this.logger = logger;
  }

  /** Last cached probe (may be null before first window boot). */
  getCachedProbe(): AiGpuRendererProbeResult | null {
    return this.lastProbe;
  }

  private ensureIpc(): void {
    if (this.ipcBound) return;
    this.ipcBound = true;
    ipcMain.on(AI_GPU_RENDERER_CHANNELS.message, (_event, raw: unknown) => {
      const msg = raw as
        | InstrumentalAiOutMessage
        | (AiGpuRendererProbeResult & { type: 'probe-result' })
        | null;
      if (!msg || typeof msg !== 'object' || !('type' in msg)) return;

      if (msg.type === 'probe-result') {
        const probe: AiGpuRendererProbeResult = {
          available: msg.available === true,
          adapterOk: msg.adapterOk === true,
          reason: msg.reason,
          navigatorType: msg.navigatorType || 'object'
        };
        this.lastProbe = probe;
        const waiters = this.probeWaiters.splice(0);
        for (const w of waiters) w(probe);
        this.jobHandler?.onMessage({ type: 'probe-result', ...probe });
        return;
      }

      if (msg.type === 'progress' && msg.requestId === 0) {
        this.ready = true;
        const waiters = this.readyWaiters.splice(0);
        for (const w of waiters) w();
      }

      this.jobHandler?.onMessage(msg as InstrumentalAiOutMessage);
    });
  }

  private async ensureWindow(): Promise<BrowserWindow> {
    this.ensureIpc();
    if (this.win && !this.win.isDestroyed()) {
      if (!this.ready) {
        await this.waitReady();
      }
      return this.win;
    }

    this.ready = false;
    const script = resolveGpuRendererScript();
    const htmlPath = resolveGpuRendererHtml(script);

    this.win = new BrowserWindow({
      show: false,
      width: 64,
      height: 64,
      title: 'KLS AI GPU Renderer',
      webPreferences: {
        // Node + Chromium: reuse fs/ORT paths and expose navigator.gpu.
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
        backgroundThrottling: false,
        webgl: true,
        offscreen: false
      }
    });

    this.win.on('closed', () => {
      this.win = null;
      this.ready = false;
    });

    this.logger?.info('InstrumentalAiHiddenRenderer', 'Loading Hidden Renderer', {
      htmlPath,
      script
    });

    await this.win.loadFile(htmlPath);
    await this.waitReady();
    return this.win;
  }

  private waitReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Hidden AI GPU renderer did not become ready within ${READY_TIMEOUT_MS}ms`));
      }, READY_TIMEOUT_MS);
      this.readyWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Probe WebGPU in the Hidden Renderer (navigator.gpu + requestAdapter).
   * Creates the window on first call.
   */
  async probeWebGpu(): Promise<AiGpuRendererProbeResult> {
    try {
      const win = await this.ensureWindow();
      if (this.lastProbe) {
        // Refresh in background but return cache for Settings snappiness.
        win.webContents.send(AI_GPU_RENDERER_CHANNELS.probe);
        return this.lastProbe;
      }
      return await new Promise<AiGpuRendererProbeResult>((resolve) => {
        const timer = setTimeout(() => {
          resolve({
            available: false,
            adapterOk: false,
            reason: 'Hidden Renderer WebGPU probe timed out',
            navigatorType: 'object'
          });
        }, PROBE_TIMEOUT_MS);
        this.probeWaiters.push((r) => {
          clearTimeout(timer);
          resolve(r);
        });
        win.webContents.send(AI_GPU_RENDERER_CHANNELS.probe);
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger?.warn('InstrumentalAiHiddenRenderer', `WebGPU probe failed: ${reason}`);
      return {
        available: false,
        adapterOk: false,
        reason,
        navigatorType: 'undefined'
      };
    }
  }

  /**
   * True when Hidden Renderer can attempt ORT WebGPU (adapter present).
   */
  async isWebGpuReady(): Promise<boolean> {
    const probe = await this.probeWebGpu();
    return probe.adapterOk === true;
  }

  /**
   * Send a separate job to the Hidden Renderer. Caller owns timeouts/abort.
   */
  async startSeparate(
    payload: InstrumentalAiSeparateRequest,
    handlers: HiddenRendererJobHandlers
  ): Promise<void> {
    const win = await this.ensureWindow();
    this.jobHandler = handlers;
    win.webContents.send(AI_GPU_RENDERER_CHANNELS.separate, payload);
  }

  clearJobHandler(): void {
    this.jobHandler = null;
  }

  /** Destroy the hidden window (e.g. on app quit). */
  dispose(): void {
    this.jobHandler = null;
    this.readyWaiters = [];
    this.probeWaiters = [];
    if (this.win && !this.win.isDestroyed()) {
      try {
        this.win.destroy();
      } catch {
        /* ignore */
      }
    }
    this.win = null;
    this.ready = false;
  }
}

/** Process-wide singleton (lazy). */
let singleton: InstrumentalAiHiddenRenderer | null = null;

export function getInstrumentalAiHiddenRenderer(logger?: Logger): InstrumentalAiHiddenRenderer {
  if (!singleton) {
    singleton = new InstrumentalAiHiddenRenderer(logger);
  } else if (logger) {
    // Allow late logger attach without recreating the window.
    (singleton as unknown as { logger?: Logger }).logger = logger;
  }
  return singleton;
}
