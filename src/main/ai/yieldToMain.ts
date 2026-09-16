/**
 * Yields to the browser/Electron event loop so UI input and paint can run.
 * Used between heavy MDX/ORT chunks so enabling AI vocal remover never freezes the Control UI.
 */
export function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MessageChannel !== 'undefined') {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(null);
      return;
    }
    setTimeout(resolve, 0);
  });
}
