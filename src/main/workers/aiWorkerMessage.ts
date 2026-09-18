/**
 * Electron utilityProcess IPC is asymmetric:
 * - Parent: UtilityProcess.on('message', data) receives the bare payload.
 * - Child: process.parentPort.on('message', event) receives MessageEvent { data, ports }.
 *
 * Node child_process fork IPC delivers the bare payload on both sides.
 * Unwrap parentPort MessageEvent so handlers see `{ type: 'separate', ... }`.
 *
 * **Critical invariant (Safety-First):** always unwrap `raw.data` for parentPort
 * MessageEvents before checking `type === 'separate'`. Skipping unwrap stalls
 * Download Instrumental AI (ready-ping never reaches `handleSeparate`).
 *
 * @see scripts/verify-ai-worker-ipc-unwrap.js
 * @see scripts/verify-critical-invariants.js
 */

/** Shape of `process.parentPort` message events in Electron utilityProcess. */
export type ParentPortMessageEvent = {
  data: unknown;
  ports?: unknown[];
};

/**
 * Return the protocol payload whether `raw` is an Electron parentPort MessageEvent
 * or a bare fork/IPC object.
 *
 * Why prefer bare `type` first: a protocol message may itself contain a `data`
 * field; treating those as MessageEvents would incorrectly unwrap them.
 *
 * @param raw - Value from `parentPort.on('message')` or fork IPC
 * @returns Protocol object (e.g. `{ type: 'separate', ... }`) or the original value
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
