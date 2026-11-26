import { useSearchParams } from 'react-router'

/**
 * One query-string parameter used as page state (an open tab, a filter, a selected item).
 * Keeping it in the address means the browser's Back button undoes the last change, a refresh
 * keeps the view, and a side-bar link to the bare page returns to its default view.
 * Setting `null` removes the parameter; other parameters are kept.
 */
export const useParam = (key: string) => {
  const [params, setParams] = useSearchParams()
  const set = (next: string | null) =>
    setParams((current) => {
      const updated = new URLSearchParams(current)
      if (next === null || next === '') updated.delete(key)
      else updated.set(key, next)
      return updated
    })
  return [params.get(key), set] as const
}

/** `value` when it is one of `allowed`, otherwise `fallback` (an unknown or missing parameter). */
export const oneOf = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(value ?? '') ? (value as T) : fallback
