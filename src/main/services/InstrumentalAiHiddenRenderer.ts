/**
 * Hidden BrowserWindow host for Instrumental AI WebGPU inference.
 *
 * Chromium renderer context → real `navigator.gpu` / ORT WebGPU EP.
 * utilityProcess cannot host WebGPU (`backend not found`); keep that path for
 * WASM when GPU is off or no adapter is available.
 *
 * Packaging notes (AppImage / asar):
 * - Never write HTML beside the bundled script (asar is read-only).
 * - Probe via `webContents.executeJavaScript` so Settings/`aiGpuSupported`
 *   does not depend on successfully `require()`-ing the heavy ORT entry.
 * - Load `instrumentalAiGpuRenderer.js` only when starting a separation job.
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Logger } from './Logger';
import {
  AI_GPU_RENDERER_CHANNELS,
  type AiGpuRendererProbeResult
} from '../../shared/aiGpuRendererIpc';
import { WEBGPU_DEVICE_PROBE_TIMEOUT_MS } from '../../shared/aiGpuFallback';
import type {
  InstrumentalAiOutMessage,
  InstrumentalAiSeparateRequest
} from '../workers/instrumentalAiSeparateCore';

const READY_TIMEOUT_MS = 60_000;
/** Outer ceiling for the full probe script (adapter + device + marshalling). */
const PROBE_TIMEOUT_MS = 20_000;

export type HiddenRendererJobHandlers = {
  onMessage: (
    msg: InstrumentalAiOutMessage | (AiGpuRendererProbeResult & { type: 'probe-result' })
  ) => void;
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

/** Writable HTML loader outside asar (userData preferred, tmp fallback). */
function resolveGpuRendererHtmlPath(): string {
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'instrumental-ai-gpu-renderer.html');
  } catch {
    return path.join(os.tmpdir(), `kls-ai-gpu-renderer-${process.pid}.html`);
  }
}

function writeMinimalProbeHtml(htmlPath: string): void {
  // Inline ready ping — no require of ORT bundle (asar-safe, fast Settings probe).
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><title>KLS AI GPU Renderer</title></head>
<body>
<script>
  (function () {
    try {
      var { ipcRenderer } = require('electron');
      ipcRenderer.send(${JSON.stringify(AI_GPU_RENDERER_CHANNELS.message)}, {
        type: 'progress',
        requestId: 0,
        phase: 'ready',
        progress: 0,
        message: 'Instrumental AI Hidden Renderer shell ready'
      });
    } catch (err) {
      console.error('[KLS AI GPU Renderer] shell ready failed', err);
    }
  })();
</script>
</body>
</html>`;
  fs.writeFileSync(htmlPath, html, 'utf8');
}

/**
 * Singleton Hidden Renderer lifecycle for Settings probe + separation jobs.
 */
export class InstrumentalAiHiddenRenderer {
  private win: BrowserWindow | null = null;
  private ready = false;
  private readyWaiters: Array<() => void> = [];
  private lastProbe: AiGpuRendererProbeResult | null = null;
  private jobHandler: HiddenRendererJobHandlers | null = null;
  private ipcBound = false;
  private gpuScriptLoaded = false;
  private logger?: Logger;

  constructor(logger?: Logger) {
    this.logger = logger;
  }

  /** Last cached probe (may be null before first successful probe). */
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
    this.gpuScriptLoaded = false;
    const htmlPath = resolveGpuRendererHtmlPath();
    writeMinimalProbeHtml(htmlPath);

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
      this.gpuScriptLoaded = false;
    });

    this.logger?.info('InstrumentalAiHiddenRenderer', 'Loading Hidden Renderer shell', {
      htmlPath
    });

    await this.win.loadFile(htmlPath);
    await this.waitReady();
    return this.win;
  }

  private waitReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(`Hidden AI GPU renderer did not become ready within ${READY_TIMEOUT_MS}ms`)
        );
      }, READY_TIMEOUT_MS);
      this.readyWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Probe WebGPU via executeJavaScript in the Hidden Renderer.
   * Requires requestAdapter + requestDevice (5s race) — adapter-only probes
   * are false positives for ORT WebGPU session.create.
   * Does not require the ORT worker bundle (fast + asar-safe).
   */
  async probeWebGpu(opts?: { forceRefresh?: boolean }): Promise<AiGpuRendererProbeResult> {
    try {
      const win = await this.ensureWindow();
      if (this.lastProbe && opts?.forceRefresh !== true && this.lastProbe.adapterOk === true) {
        return this.lastProbe;
      }

      const deviceTimeoutMs = WEBGPU_DEVICE_PROBE_TIMEOUT_MS;
      const probePromise = win.webContents.executeJavaScript(
        `(async () => {
          const nav = typeof navigator !== 'undefined' ? navigator : undefined;
          const navigatorType = typeof nav;
          const gpu = nav && nav.gpu ? nav.gpu : null;
          if (!gpu) {
            return {
              available: false,
              adapterOk: false,
              reason: navigatorType === 'undefined'
                ? 'navigator undefined in Hidden Renderer'
                : 'navigator.gpu missing in Hidden Renderer',
              navigatorType
            };
          }
          try {
            const adapter = await gpu.requestAdapter();
            if (!adapter) {
              return {
                available: true,
                adapterOk: false,
                reason: 'navigator.gpu.requestAdapter() returned null',
                navigatorType
              };
            }
            // Adapter alone is insufficient — ORT needs a real GPUDevice.
            const deviceTimeoutMs = ${deviceTimeoutMs};
            let device = null;
            try {
              device = await Promise.race([
                adapter.requestDevice(),
                new Promise((_, reject) =>
                  setTimeout(
                    () => reject(new Error('requestDevice timed out after ' + deviceTimeoutMs + 'ms')),
                    deviceTimeoutMs
                  )
                )
              ]);
            } catch (devErr) {
              return {
                available: true,
                adapterOk: false,
                reason: devErr && devErr.message
                  ? String(devErr.message)
                  : 'adapter.requestDevice() failed',
                navigatorType
              };
            }
            try {
              if (device && typeof device.destroy === 'function') device.destroy();
            } catch (_) { /* ignore */ }
            return { available: true, adapterOk: true, navigatorType };
          } catch (err) {
            return {
              available: true,
              adapterOk: false,
              reason: err && err.message ? String(err.message) : String(err),
              navigatorType
            };
          }
        })()`,
        true
      );

      const result = (await Promise.race([
        probePromise,
        new Promise<AiGpuRendererProbeResult>((resolve) => {
          setTimeout(
            () =>
              resolve({
                available: false,
                adapterOk: false,
                reason: 'Hidden Renderer WebGPU probe timed out',
                navigatorType: 'object'
              }),
            PROBE_TIMEOUT_MS
          );
        })
      ])) as AiGpuRendererProbeResult;

      this.lastProbe = {
        available: result.available === true,
        adapterOk: result.adapterOk === true,
        reason: result.reason,
        navigatorType: result.navigatorType || 'object'
      };
      this.logger?.info('InstrumentalAiHiddenRenderer', 'WebGPU probe result', this.lastProbe);
      return this.lastProbe;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger?.warn('InstrumentalAiHiddenRenderer', `WebGPU probe failed: ${reason}`);
      this.lastProbe = {
        available: false,
        adapterOk: false,
        reason,
        navigatorType: 'undefined'
      };
      return this.lastProbe;
    }
  }

  /** True when Hidden Renderer can attempt ORT WebGPU (adapter+device present). */
  async isWebGpuReady(): Promise<boolean> {
    const probe = await this.probeWebGpu({ forceRefresh: true });
    return probe.adapterOk === true;
  }

  /** Lazily require the ORT GPU renderer entry into the hidden window. */
  private async ensureGpuScriptLoaded(win: BrowserWindow): Promise<void> {
    if (this.gpuScriptLoaded) return;
    const script = resolveGpuRendererScript();
    this.logger?.info('InstrumentalAiHiddenRenderer', 'Loading GPU renderer script', { script });
    await win.webContents.executeJavaScript(
      `require(${JSON.stringify(script)}); true;`,
      true
    );
    this.gpuScriptLoaded = true;
  }

  /**
   * Send a separate job to the Hidden Renderer. Caller owns timeouts/abort.
   */
  async startSeparate(
    payload: InstrumentalAiSeparateRequest,
    handlers: HiddenRendererJobHandlers
  ): Promise<void> {
    const win = await this.ensureWindow();
    await this.ensureGpuScriptLoaded(win);
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
    this.lastProbe = null;
    this.gpuScriptLoaded = false;
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
    (singleton as unknown as { logger?: Logger }).logger = logger;
  }
  return singleton;
}
