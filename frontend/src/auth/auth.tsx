import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { api, setUnauthorizedHandler } from '@/lib/api'
import type { OfficeRole, Portal, Session } from '@/lib/types'

type AuthState = {
  status: 'loading' | 'ready'
  session: Session | null
  /** Signs in, then loads the session the server built for this account. */
  login(input: { email: string; password: string; remember: boolean; portal: Portal }): Promise<Session | null>
  logout(): Promise<void>
  refresh(): Promise<Session | null>
}

const AuthContext = createContext<AuthState | null>(null)

export const useAuth = () => {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [session, setSession] = useState<Session | null>(null)

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get<Session>('/me')
      setSession(data)
      return data
    } catch {
      setSession(null)
      return null
    } finally {
      setStatus('ready')
    }
  }, [])

  useEffect(() => {
    void refresh()
    setUnauthorizedHandler(() => setSession(null))
  }, [refresh])

  const value = useMemo<AuthState>(
    () => ({
      status,
      session,
      refresh,
      async login({ email, password, remember, portal }) {
        await api.post(
          '/auth/sign-in/email',
          { email, password, rememberMe: remember },
          { headers: { 'X-Qadiyati-Portal': portal } },
        )
        return refresh()
      },
      async logout() {
        await api.post('/logout').catch(() => undefined)
        setSession(null)
      },
    }),
    [status, session, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/* ───────────── where each account belongs ───────────── */

export const PATHS = {
  home: '/',
  login: '/login',
  loginOf: (portal: Portal) => `/login/${portal}`,
  register: '/register',
  forgot: '/forgot-password',
  onboarding: '/onboarding',
  office: '/office',
  client: '/portal',
  platform: '/platform',
} as const

/** The four kinds of account, as the interface shows them. */
export type Persona = 'platform' | 'owner' | 'lawyer' | 'client'

export const personaOf = (session: Session | null): Persona | null => {
  if (!session) return null
  const office = session.active_office
  if (!office) return session.user.is_platform_admin ? 'platform' : null
  if (office.role === 'client') return 'client'
  return office.role === 'admin' ? 'owner' : 'lawyer'
}

export const homeOf = (session: Session | null): string => {
  const persona = personaOf(session)
  if (!session) return PATHS.login
  if (persona === 'platform') return PATHS.platform
  if (persona === 'client') return PATHS.client
  if (persona) return PATHS.office
  return PATHS.onboarding
}

const Loading = () => (
  <div className="desk grid min-h-dvh place-items-center">
    <p className="font-doc text-xl text-paper/80">يُفتح الملف…</p>
  </div>
)

/** Screen guard. The backend re-checks the session and the role on every request. */
export const Require = ({
  children,
  roles,
  platform = false,
}: {
  children: ReactNode
  roles?: readonly OfficeRole[]
  platform?: boolean
}) => {
  const { status, session } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <Loading />
  if (!session) return <Navigate to={PATHS.login} replace state={{ from: location.pathname }} />
  if (platform && !session.user.is_platform_admin) return <Navigate to={homeOf(session)} replace />
  if (roles && (!session.role || !roles.includes(session.role))) return <Navigate to={homeOf(session)} replace />
  return children
}

/** Sign-in pages send an already signed-in visitor to their own area. */
export const GuestOnly = ({ children }: { children: ReactNode }) => {
  const { status, session } = useAuth()
  if (status === 'loading') return <Loading />
  if (session) return <Navigate to={homeOf(session)} replace />
  return children
}
