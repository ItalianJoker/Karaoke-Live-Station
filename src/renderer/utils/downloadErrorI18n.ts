/**
 * Map Main-process download error tokens to localized UI strings.
 * Stable keys (errors.*) are preferred over raw English for operator-facing text.
 */

/** Loose i18n `t` adapter — avoids fighting i18next's overloaded TFunction. */
export type DownloadErrorTranslate = (key: string, options?: unknown) => string;

/**
 * @param errorMessage - Payload errorMessage from DownloadProgressPayload
 * @param t - i18next `t` (or compatible)
 */
export function localizeDownloadErrorMessage(
  errorMessage: string | undefined,
  t: DownloadErrorTranslate
): string | undefined {
  if (!errorMessage) return undefined;
  if (errorMessage === 'errors.youtubeLoginCancelled') {
    return t('errors.youtubeLoginCancelled');
  }
  if (errorMessage === 'errors.youtubeLoginRequiredAfterAuth') {
    return t('errors.youtubeLoginRequiredAfterAuth');
  }
  if (errorMessage === 'errors.youtubeLoginFailed') {
    return t('errors.youtubeLoginFailed', { error: '' });
  }
  if (errorMessage.startsWith('errors.youtubeLoginFailed:')) {
    const detail = errorMessage.slice('errors.youtubeLoginFailed:'.length).trim();
    const suffix = detail ? `: ${detail}` : '';
    return t('errors.youtubeLoginFailed', { error: suffix });
  }
  return errorMessage;
}
