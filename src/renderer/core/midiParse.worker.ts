/**
 * Web Worker entry: parse SMF/KAR off the Control Room UI thread.
 * Posts structured clone of { song, events }.
 */

import { MidiParser } from './MidiParser';

export type MidiParseWorkerRequest = {
  requestId: number;
  buffer: ArrayBuffer;
};

export type MidiParseWorkerResponse =
  | {
      requestId: number;
      ok: true;
      song: ReturnType<typeof MidiParser.parse>['song'];
      events: ReturnType<typeof MidiParser.parse>['events'];
    }
  | { requestId: number; ok: false; error: string };

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<MidiParseWorkerRequest>) => void) | null;
  postMessage: (message: MidiParseWorkerResponse) => void;
};

workerScope.onmessage = (event: MessageEvent<MidiParseWorkerRequest>) => {
  const msg = event.data;
  if (!msg || typeof msg.requestId !== 'number' || !msg.buffer) return;
  try {
    const { song, events } = MidiParser.parse(msg.buffer);
    const response: MidiParseWorkerResponse = {
      requestId: msg.requestId,
      ok: true,
      song,
      events
    };
    workerScope.postMessage(response);
  } catch (err) {
    const response: MidiParseWorkerResponse = {
      requestId: msg.requestId,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
    workerScope.postMessage(response);
  }
};
