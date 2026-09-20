/**
 * Utility-process / Node worker entry for Download Instrumental AI separation.
 * Runs ORT + MDX/HTDemucs off the Electron main process so Control UI stays responsive.
 *
 * Protocol (parent ↔ child via Electron utilityProcess parentPort, or process IPC):
 *   in:  { type:'separate', requestId, method, modelPath, ortDir, inputWav, outputWav, … }
 *   out: { type:'progress' | 'done' | 'error', … }
 *
 * Note: Electron parentPort delivers MessageEvent { data, ports } — unwrap via
 * {@link unwrapAiWorkerInboundMessage}. Fork IPC delivers the bare payload.
 *
 * GPU path: when Settings enables AI GPU and the Hidden Renderer reports a WebGPU
 * adapter, main routes jobs to `instrumentalAiGpuRenderer` instead of this worker.
 */
import fs from 'fs';
import { fileURLToPath } from 'url';

// Fix Node.js / utilityProcess environment for onnxruntime-web:
// 1. Set location.origin = 'null' so ORT detects file:// as same-origin and skips cross-origin blob fetch.
if (typeof globalThis.location === 'undefined') {
  (globalThis as unknown as { location: URL }).location = new URL('file:///');
}
// 2. Polyfill fetch for file:// protocol in case ORT or child dependencies call fetch on file URLs.
if (typeof globalThis.fetch === 'function') {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async function (resource: RequestInfo | URL, init?: RequestInit) {
    const urlStr =
      typeof resource === 'string'
        ? resource
        : resource instanceof URL
          ? resource.href
          : (resource as Request)?.url || '';
    if (urlStr.startsWith('file://')) {
      const filePath = fileURLToPath(urlStr);
      const data = await fs.promises.readFile(filePath);
      return new Response(data);
    }
    return origFetch(resource, init);
  };
}

import {
  runInstrumentalAiSeparate,
  type InstrumentalAiOutMessage,
  type InstrumentalAiSeparateRequest
} from './instrumentalAiSeparateCore';
import { unwrapAiWorkerInboundMessage } from './aiWorkerMessage';

function post(msg: InstrumentalAiOutMessage): void {
  const port = (process as NodeJS.Process & { parentPort?: { postMessage: (m: unknown) => void } })
    .parentPort;
  if (port?.postMessage) {
    port.postMessage(msg);
    return;
  }
  if (typeof process.send === 'function') {
    process.send(msg);
  }
}

function onMessage(raw: unknown): void {
  const data = unwrapAiWorkerInboundMessage(raw) as InstrumentalAiSeparateRequest | null;
  if (!data || data.type !== 'separate') return;
  void runInstrumentalAiSeparate(data, post).catch((err) => {
    post({
      type: 'error',
      requestId: data.requestId,
      message: err instanceof Error ? err.message : String(err)
    });
  });
}

const parentPort = (
  process as NodeJS.Process & {
    parentPort?: { on: (e: string, cb: (m: unknown) => void) => void };
  }
).parentPort;
if (parentPort?.on) {
  parentPort.on('message', onMessage);
} else {
  process.on('message', onMessage);
}

post({
  type: 'progress',
  requestId: 0,
  phase: 'ready',
  progress: 0,
  message: 'Instrumental AI worker ready'
});
