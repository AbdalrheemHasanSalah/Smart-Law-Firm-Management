import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_LANGUAGE, INTL_LOCALE, directionOf, isLanguage, type Language } from '@/lib/i18n'

export const useLanguage = () => {
  const { i18n } = useTranslation()
  const language: Language = isLanguage(i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : DEFAULT_LANGUAGE

  const setLanguage = useCallback((next: Language) => void i18n.changeLanguage(next), [i18n])
  const toggleLanguage = useCallback(
    () => void i18n.changeLanguage(language === 'ar' ? 'en' : 'ar'),
    [i18n, language],
  )

  return {
    language,
    direction: directionOf(language),
    intlLocale: INTL_LOCALE[language],
    setLanguage,
    toggleLanguage,
  }
}
