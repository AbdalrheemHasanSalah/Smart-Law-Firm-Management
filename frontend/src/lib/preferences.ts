import { useSyncExternalStore } from 'react'

/**
 * The viewer's display preferences: light or dark theme, Arabic or English. Kept in this browser
 * only (localStorage); index.html applies them before the first paint.
 */
export type Theme = 'light' | 'dark'
export type Lang = 'ar' | 'en'

const THEME_KEY = 'qadiyati.theme'
const LANG_KEY = 'qadiyati.lang'

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private windows may refuse storage; the choice then lasts for this page only.
  }
}

/* ───────────────────────── theme ───────────────────────── */

const themeListeners = new Set<() => void>()

export const currentTheme = (): Theme => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')

export const setTheme = (theme: Theme) => {
  document.documentElement.setAttribute('data-theme', theme)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#041424' : '#061d33')
  write(THEME_KEY, theme)
  themeListeners.forEach((listener) => listener())
}

export const useTheme = () =>
  useSyncExternalStore(
    (listener) => {
      themeListeners.add(listener)
      return () => themeListeners.delete(listener)
    },
    currentTheme,
    () => 'light' as Theme,
  )

/* ───────────────────────── language ───────────────────────── */

export const currentLang = (): Lang => (read(LANG_KEY) === 'en' ? 'en' : 'ar')

/** Switching language reloads the page, so every screen, date and number is drawn afresh in it. */
export const setLang = (lang: Lang) => {
  write(LANG_KEY, lang)
  window.location.reload()
}
