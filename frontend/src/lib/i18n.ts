import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import arAuth from '@/locales/ar/auth.json'
import arCommon from '@/locales/ar/common.json'
import arValidation from '@/locales/ar/validation.json'
import enAuth from '@/locales/en/auth.json'
import enCommon from '@/locales/en/common.json'
import enValidation from '@/locales/en/validation.json'
import { STORAGE_KEYS, storage } from './storage'

export const SUPPORTED_LANGUAGES = ['ar', 'en'] as const
export type Language = (typeof SUPPORTED_LANGUAGES)[number]
export const DEFAULT_LANGUAGE: Language = 'ar'

export const isLanguage = (value: unknown): value is Language =>
  typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value)

/** BCP-47 locales for Intl formatting. Latin digits are used in both, as is common in Palestinian offices. */
export const INTL_LOCALE: Record<Language, string> = {
  ar: 'ar-PS-u-nu-latn',
  en: 'en-GB',
}

export type Direction = 'rtl' | 'ltr'
export const directionOf = (language: Language): Direction => (language === 'ar' ? 'rtl' : 'ltr')

const applyDocumentLanguage = (language: Language) => {
  const root = document.documentElement
  root.lang = language
  root.dir = directionOf(language)
}

const initialLanguage = (): Language => {
  const saved = storage.get(STORAGE_KEYS.language)
  return isLanguage(saved) ? saved : DEFAULT_LANGUAGE
}

export const resources = {
  ar: { common: arCommon, auth: arAuth, validation: arValidation },
  en: { common: enCommon, auth: enAuth, validation: enValidation },
} as const

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: [...SUPPORTED_LANGUAGES],
  ns: ['common', 'auth', 'validation'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  returnNull: false,
})

applyDocumentLanguage(i18n.language as Language)

i18n.on('languageChanged', (language) => {
  if (!isLanguage(language)) return
  applyDocumentLanguage(language)
  storage.set(STORAGE_KEYS.language, language)
})

export default i18n
