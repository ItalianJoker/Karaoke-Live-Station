/**
 * Non-blocking toast notifications.
 * Replaces window.alert / confirm so native modal dialogs never freeze
 * the renderer event loop or interrupt Web Audio playback.
 */

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export type ToastMessage = {
  id: number;
  kind: ToastKind;
  text: string;
  durationMs: number;
};

type ToastListener = (toasts: ToastMessage[]) => void;

let nextId = 1;
let toasts: ToastMessage[] = [];
const listeners = new Set<ToastListener>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit(): void {
  const snapshot = [...toasts];
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch {
      // ignore
    }
  }
}

export function subscribeToasts(listener: ToastListener): () => void {
  listeners.add(listener);
  listener([...toasts]);
  return () => {
    listeners.delete(listener);
  };
}

export function dismissToast(id: number): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function showToast(
  text: string,
  kind: ToastKind = 'info',
  durationMs = 4500
): number {
  const id = nextId++;
  toasts = [...toasts, { id, kind, text, durationMs }];
  emit();
  if (durationMs > 0) {
    timers.set(
      id,
      setTimeout(() => {
        dismissToast(id);
      }, durationMs)
    );
  }
  return id;
}

/**
 * Non-blocking confirm. Resolves true/false without pausing audio.
 * Uses the browser-native dialog only when a custom host is unavailable;
 * prefer wiring ToastConfirmHost in the control window.
 */
let confirmHandler:
  | ((message: string) => Promise<boolean>)
  | null = null;

export function registerConfirmHandler(
  handler: ((message: string) => Promise<boolean>) | null
): void {
  confirmHandler = handler;
}

export async function confirmAsync(message: string): Promise<boolean> {
  if (confirmHandler) {
    return confirmHandler(message);
  }
  // Last-resort fallback — still better than sync confirm for audio isolation
  // when the React confirm host is not mounted yet.
  return Promise.resolve(window.confirm(message));
}
