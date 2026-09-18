/**
 * Electron utilityProcess IPC is asymmetric:
 * - Parent: UtilityProcess.on('message', data) receives the bare payload.
 * - Child: process.parentPort.on('message', event) receives MessageEvent { data, ports }.
 *
 * Node child_process fork IPC delivers the bare payload on both sides.
 * Unwrap parentPort MessageEvent so handlers see { type: 'separate', ... }.
 */

export type ParentPortMessageEvent = {
  data: unknown;
  ports?: unknown[];
};

/**
 * Return the protocol payload whether `raw` is an Electron parentPort MessageEvent
 * or a bare fork/IPC object.
 */
export function unwrapAiWorkerInboundMessage(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  // Bare protocol messages always carry `type` at the top level.
  if (typeof obj.type === 'string') return raw;
  // Electron parentPort MessageEvent: { data, ports }
  if ('data' in obj) return obj.data;
  return raw;
}
