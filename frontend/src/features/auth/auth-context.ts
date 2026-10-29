import { createContext, useContext } from 'react'
import type { AuthSession } from './types'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

export type AuthContextValue = {
  status: AuthStatus
  session: AuthSession | null
  isAuthenticated: boolean
  /** True after the server rejected a request because the session had expired. */
  sessionExpired: boolean
  /** Re-reads the session from the server (after sign-in, office selection, …). */
  refresh: () => Promise<AuthSession | null>
  /** Resolves to false (and stays signed in) when the server could not end the session. */
  signOut: () => Promise<boolean>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')
  return context
}
