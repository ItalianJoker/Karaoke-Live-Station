import React, { useEffect, useState, useCallback } from 'react';
import {
  subscribeToasts,
  dismissToast,
  registerConfirmHandler,
  type ToastMessage
} from '../utils/toast';

/**
 * Host for non-blocking toast notifications and async confirm dialogs.
 * Mount once in ControlWindow so alerts never call window.alert/confirm
 * (which can stall the renderer and glitch Web Audio playback).
 */
export const ToastHost: React.FC = () => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [confirmState, setConfirmState] = useState<{
    message: string;
    resolve: (value: boolean) => void;
  } | null>(null);

  useEffect(() => subscribeToasts(setToasts), []);

  useEffect(() => {
    registerConfirmHandler(
      (message: string) =>
        new Promise<boolean>((resolve) => {
          setConfirmState({ message, resolve });
        })
    );
    return () => registerConfirmHandler(null);
  }, []);

  const answerConfirm = useCallback(
    (value: boolean) => {
      if (!confirmState) return;
      confirmState.resolve(value);
      setConfirmState(null);
    },
    [confirmState]
  );

  return (
    <>
      <div
        className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm pointer-events-none"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-lg px-4 py-3 text-sm shadow-lg border backdrop-blur-sm ${
              toast.kind === 'error'
                ? 'bg-rose-950/95 border-rose-700 text-rose-100'
                : toast.kind === 'success'
                  ? 'bg-emerald-950/95 border-emerald-700 text-emerald-100'
                  : toast.kind === 'warning'
                    ? 'bg-amber-950/95 border-amber-700 text-amber-100'
                    : 'bg-slate-900/95 border-slate-600 text-slate-100'
            }`}
          >
            <div className="flex items-start gap-3">
              <span className="flex-1 whitespace-pre-wrap">{toast.text}</span>
              <button
                type="button"
                className="opacity-70 hover:opacity-100"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      {confirmState && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-md w-full p-5 space-y-4">
            <p className="text-slate-100 text-sm whitespace-pre-wrap">{confirmState.message}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700"
                onClick={() => answerConfirm(false)}
              >
                Annulla
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500"
                onClick={() => answerConfirm(true)}
              >
                Conferma
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
