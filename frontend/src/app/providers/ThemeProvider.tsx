import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { STORAGE_KEYS, storage } from '@/lib/storage'
import { ThemeContext, type Theme, type ThemeContextValue } from './theme-context'

const DARK_QUERY = '(prefers-color-scheme: dark)'
const TRANSITION_MS = 400

const readSaved = (): Theme | null => {
  const saved = storage.get(STORAGE_KEYS.theme)
  return saved === 'light' || saved === 'dark' ? saved : null
}

const systemTheme = (): Theme => (window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light')

const applyTheme = (theme: Theme, animate: boolean) => {
  const root = document.documentElement
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (animate && !reduceMotion) {
    root.classList.add('theme-transition')
    window.setTimeout(() => root.classList.remove('theme-transition'), TRANSITION_MS)
  }
  root.classList.toggle('dark', theme === 'dark')
}

/**
 * Single source of truth for light/dark mode. The class on <html> is set before React
 * mounts by the inline script in index.html (prevents a flash), and this provider keeps
 * it in sync afterwards. Toggling never remounts the tree, so form/page state survives.
 */
export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [saved, setSaved] = useState<Theme | null>(readSaved)
  const [system, setSystem] = useState<Theme>(systemTheme)
  const theme = saved ?? system

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY)
    const onChange = () => setSystem(media.matches ? 'dark' : 'light')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    applyTheme(theme, document.documentElement.classList.contains('dark') !== (theme === 'dark'))
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    storage.set(STORAGE_KEYS.theme, next)
    setSaved(next)
  }, [])

  const toggleTheme = useCallback(
    () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    [setTheme, theme],
  )

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, isSystem: saved === null, setTheme, toggleTheme }),
    [theme, saved, setTheme, toggleTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
