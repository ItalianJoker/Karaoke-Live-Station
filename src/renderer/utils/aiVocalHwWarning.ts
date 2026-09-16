/**
 * First-use hardware warning for offline AI vocal remover methods.
 * Themed modal via ToastHost — never window.alert (keeps Web Audio unblocked).
 * "Don't show again" persists in localStorage (lightweight; fits existing client patterns).
 */
import { confirmDetailed } from '../utils/toast';
import { isAiVocalRemoverMethod } from '../../shared/vocalRemover';

const STORAGE_KEY = 'kls.hideAiVocalHwWarning';

export function shouldShowAiVocalHwWarning(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '1';
  } catch {
    return true;
  }
}

export function dismissAiVocalHwWarningPermanently(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* private mode */
  }
}

export function resetAiVocalHwWarning(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Shows the AI hardware warning when switching to / enabling an AI method.
 * Returns false if the user cancels (caller should revert selection / skip enable).
 * Algorithmic methods never trigger this warning.
 */
export async function warnAiVocalRemoverIfNeeded(
  method: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any
): Promise<boolean> {
  const tr = (key: string, fallback: string): string => {
    try {
      const value = t(key, fallback);
      return typeof value === 'string' && value.length > 0 ? value : fallback;
    } catch {
      return fallback;
    }
  };
  if (!isAiVocalRemoverMethod(method)) return true;
  if (!shouldShowAiVocalHwWarning()) return true;

  const title = tr(
    'settings.aiVocalHwWarningTitle',
    'Offline AI vocal remover — hardware note'
  );
  const body = tr(
    'settings.aiVocalHwWarningBody',
    'AI methods run on-device (no cloud). A modern CPU is recommended; GPU/ONNX helps when available. BS-Roformer is heavier and may use significant RAM/CPU. First use downloads models (~50–300 MB depending on choice). This feature is Experimental.'
  );

  const result = await confirmDetailed(`${title}\n\n${body}`, {
    dontShowAgainLabel: tr('settings.aiVocalHwWarningDontShow', "Don't show again"),
    confirmLabel: tr('common.confirm', 'Confirm'),
    cancelLabel: tr('common.cancel', 'Cancel')
  });

  if (result.confirmed && result.dontShowAgain) {
    dismissAiVocalHwWarningPermanently();
  }
  return result.confirmed;
}
