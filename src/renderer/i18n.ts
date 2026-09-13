import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import itTranslation from '../../locales/it.json';
import enTranslation from '../../locales/en.json';
import esTranslation from '../../locales/es.json';
import frTranslation from '../../locales/fr.json';

const resources = {
  it: { translation: itTranslation },
  en: { translation: enTranslation },
  es: { translation: esTranslation },
  fr: { translation: frTranslation }
};

export function resolveAppLanguage(setting: string): string {
  if (setting !== 'autodetect') {
    return setting;
  }
  const browserLang = navigator.language.split('-')[0].toLowerCase();
  if (['it', 'en', 'es', 'fr'].includes(browserLang)) {
    return browserLang;
  }
  return 'it';
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'it',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
