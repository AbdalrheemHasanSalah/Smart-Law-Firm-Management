import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import i18n from '@/lib/i18n'
import { STORAGE_KEYS, storage } from '@/lib/storage'
import { ApiError } from '@/services/api/api-error'
import { registerUnauthorizedHandler } from '@/services/api/http-client'
import { queryKeys } from '@/services/api/query-keys'
import { authService } from './api'
import { AuthContext, type AuthContextValue, type AuthStatus } from './auth-context'
import type { AuthSession } from './types'

/**
 * Exposes the server-side session to the UI. The session cookie is httpOnly, so the only source
 * of truth is `GET /api/me`; nothing about the session is kept in browser storage.
 * This controls what the interface shows — every permission is still enforced by the backend.
 */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient()
  const [sessionExpired, setSessionExpired] = useState(false)
  const sessionQuery = useQuery({
    queryKey: queryKeys.auth.session(),
    queryFn: () => authService.getSession(),
    staleTime: 60_000,
  })

  useEffect(() => {
    // Earlier builds stored a bearer token in Web Storage; make sure none is left behind.
    storage.remove(STORAGE_KEYS.legacySession, 'local')
    storage.remove(STORAGE_KEYS.legacySession, 'session')
  }, [])

  useEffect(
    () =>
      registerUnauthorizedHandler(() => {
        if (queryClient.getQueryData(queryKeys.auth.session())) setSessionExpired(true)
        queryClient.setQueryData(queryKeys.auth.session(), null)
      }),
    [queryClient],
  )

  const refresh = useCallback(async () => {
    const session = await queryClient.fetchQuery({
      queryKey: queryKeys.auth.session(),
      queryFn: () => authService.getSession(),
      staleTime: 0,
    })
    if (session) setSessionExpired(false)
    return session
  }, [queryClient])

  /**
   * The session cookie is httpOnly, so only the server can end it. If that fails for any reason
   * other than the session already being gone, the UI stays signed in and says so — showing
   * "signed out" while the cookie still works would mislead someone on a shared device.
   */
  const signOut = useCallback(async () => {
    try {
      await authService.logout()
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'UNAUTHORIZED')) {
        toast.error(i18n.t('common:actions.signOutFailed'))
        return false
      }
    }
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== queryKeys.auth.all[0],
    })
    queryClient.setQueryData<AuthSession | null>(queryKeys.auth.session(), null)
    setSessionExpired(false)
    return true
  }, [queryClient])

  const session = sessionQuery.data ?? null
  const status: AuthStatus = sessionQuery.isPending
    ? 'loading'
    : session
      ? 'authenticated'
      : 'anonymous'

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      isAuthenticated: status === 'authenticated',
      sessionExpired,
      refresh,
      signOut,
    }),
    [status, session, sessionExpired, refresh, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
