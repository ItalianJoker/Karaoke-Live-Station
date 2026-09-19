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
