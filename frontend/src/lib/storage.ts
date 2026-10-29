/**
 * Namespaced, exception-safe wrappers around Web Storage.
 * Storage can throw (private mode, blocked cookies), so every access is guarded.
 *
 * Authentication tokens are never stored here: the real session is an httpOnly cookie.
 */
const PREFIX = 'qadiyati.'

export const STORAGE_KEYS = {
  theme: `${PREFIX}theme`,
  language: `${PREFIX}lang`,
  /** Written by earlier builds that kept a bearer token; removed on start-up. */
  legacySession: `${PREFIX}session`,
  /** Mock mode only: which demo account is signed in (no secret). */
  mockSession: `${PREFIX}mock-session`,
  /** Mock mode only: demo accounts and offices created during this tab's session. */
  mockState: `${PREFIX}mock-state`,
} as const

type StorageKind = 'local' | 'session'

const getStore = (kind: StorageKind): Storage | null => {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

export const storage = {
  get(key: string, kind: StorageKind = 'local'): string | null {
    try {
      return getStore(kind)?.getItem(key) ?? null
    } catch {
      return null
    }
  },
  set(key: string, value: string, kind: StorageKind = 'local') {
    try {
      getStore(kind)?.setItem(key, value)
    } catch {
      /* storage unavailable — preference simply won't persist */
    }
  },
  remove(key: string, kind: StorageKind = 'local') {
    try {
      getStore(kind)?.removeItem(key)
    } catch {
      /* ignore */
    }
  },
}
