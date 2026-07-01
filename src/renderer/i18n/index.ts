import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import zh from './locales/zh.json'

export type AppLanguage = 'zh' | 'en'

export function detectLocale(): AppLanguage {
  const lang = (navigator.language || 'en').toLowerCase()
  return lang.startsWith('zh') ? 'zh' : 'en'
}

export function initI18n(language?: AppLanguage): void {
  const lng = language ?? detectLocale()
  void i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      zh: { translation: zh }
    },
    lng,
    fallbackLng: 'en',
    interpolation: { escapeValue: false }
  })
  if (import.meta.env.DEV) {
    window.__i18n = i18n
  }
}

export function changeLanguage(lang: AppLanguage): Promise<void> {
  return i18n.changeLanguage(lang).then(() => undefined)
}

export default i18n
