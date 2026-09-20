/**
 * Localized copy for the single-instance lock dialog (main process).
 *
 * Pure strings only — safe before `app.whenReady()`. Matches `locales/*.json`
 * `errors.alreadyRunning*` keys so renderer/docs stay in sync.
 */

export type SecondInstanceCopy = {
  title: string;
  message: string;
};

const COPY: Record<'it' | 'en' | 'es' | 'fr', SecondInstanceCopy> = {
  it: {
    title: 'Karaoke Live Station',
    message: 'Software già in esecuzione'
  },
  en: {
    title: 'Karaoke Live Station',
    message: 'Software already running'
  },
  es: {
    title: 'Karaoke Live Station',
    message: 'Software ya en ejecución'
  },
  fr: {
    title: 'Karaoke Live Station',
    message: 'Logiciel déjà en cours d’exécution'
  }
};

/**
 * Map an OS / Electron locale tag to a supported app language.
 * Falls back to English when the tag is unknown (not Italian default —
 * second-instance UX is often first seen on EN desktops).
 */
export function resolveUiLangFromLocale(locale: string | null | undefined): keyof typeof COPY {
  const tag = String(locale || '')
    .toLowerCase()
    .split(/[-_]/)[0];
  if (tag === 'it' || tag === 'es' || tag === 'fr' || tag === 'en') return tag;
  return 'en';
}

/**
 * Title + body for the blocked second-instance dialog.
 * @param locale — typically `app.getLocale()` (settings may not be loaded yet).
 */
export function resolveSecondInstanceCopy(
  locale: string | null | undefined
): SecondInstanceCopy {
  return COPY[resolveUiLangFromLocale(locale)];
}
