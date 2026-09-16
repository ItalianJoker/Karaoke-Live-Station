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

export type ConfirmOptions = {
  /** Optional checkbox label — when present, result includes `dontShowAgain`. */
  dontShowAgainLabel?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

export type ConfirmResult = {
  confirmed: boolean;
  dontShowAgain: boolean;
};

type ToastListener = (toasts: ToastMessage[]) => void;

type ConfirmRequest = {
  message: string;
  options?: ConfirmOptions;
  resolve: (result: ConfirmResult) => void;
};

type ConfirmHandler = (request: Omit<ConfirmRequest, 'resolve'>) => Promise<ConfirmResult>;

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
 * Non-blocking confirm. Resolves without pausing audio.
 * Prefer wiring ToastHost in the control window.
 */
let confirmHandler: ConfirmHandler | null = null;

export function registerConfirmHandler(handler: ConfirmHandler | null): void {
  confirmHandler = handler;
}

export async function confirmAsync(
  message: string,
  options?: ConfirmOptions
): Promise<boolean> {
  const result = await confirmDetailed(message, options);
  return result.confirmed;
}

export async function confirmDetailed(
  message: string,
  options?: ConfirmOptions
): Promise<ConfirmResult> {
  if (confirmHandler) {
    return confirmHandler({ message, options });
  }
  const confirmed = window.confirm(message);
  return { confirmed, dontShowAgain: false };
}
