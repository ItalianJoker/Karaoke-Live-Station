/**
 * Web Worker entry for UVR-MDX-NET Karaoke 2 separation.
 * Keeps ORT + STFT/iSTFT off the renderer UI thread so Control stays clickable.
 *
 * ORT WASM must be configured with karaoke://ort/… URLs (userData), never Temp.
 */
import { MdxNetSeparator } from '../core/MdxNetSeparator';

export type MdxWorkerInMessage =
  | {
      type: 'loadModel';
      requestId: number;
      modelBuffer: ArrayBuffer;
      wasmPaths: string | { wasm: string; mjs: string };
    }
  | {
      type: 'separate';
      requestId: number;
      left: Float32Array;
      right: Float32Array;
    };

export type MdxWorkerOutMessage =
  | {
      type: 'progress';
      requestId?: number;
      phase: 'model' | 'decode' | 'separate' | 'ready' | 'error';
      progress: number;
      message: string;
    }
  | { type: 'modelReady'; requestId: number }
  | {
      type: 'result';
      requestId: number;
      left: Float32Array;
      right: Float32Array;
    }
  | { type: 'error'; requestId: number; message: string };

const separator = new MdxNetSeparator();
separator.onProgress((info) => {
  const msg: MdxWorkerOutMessage = {
    type: 'progress',
    phase: info.phase,
    progress: info.progress,
    message: info.message
  };
  self.postMessage(msg);
});

self.onmessage = (event: MessageEvent<MdxWorkerInMessage>) => {
  const data = event.data;
  void (async () => {
    try {
      if (data.type === 'loadModel') {
        await separator.loadModel(data.modelBuffer, data.wasmPaths);
        const out: MdxWorkerOutMessage = { type: 'modelReady', requestId: data.requestId };
        self.postMessage(out);
        return;
      }
      if (data.type === 'separate') {
        const { left, right } = await separator.separateInstrumental(data.left, data.right);
        const out: MdxWorkerOutMessage = {
          type: 'result',
          requestId: data.requestId,
          left,
          right
        };
        // Transfer ownership back to the renderer to avoid a second copy.
        self.postMessage(out, { transfer: [left.buffer, right.buffer] });
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const out: MdxWorkerOutMessage = {
        type: 'error',
        requestId: (data as { requestId: number }).requestId,
        message
      };
      self.postMessage(out);
    }
  })();
};
