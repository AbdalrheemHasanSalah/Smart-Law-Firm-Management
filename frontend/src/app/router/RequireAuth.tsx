import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { PageLoader } from '@/components/layout/PageLoader'
import { useAuth } from '@/features/auth/auth-context'
import { destinationFor, postLoginPath } from '@/features/auth/session-routing'
import { ROUTES } from './routes'

/**
 * UI-level guards only: they decide which screen to show. The backend independently verifies
 * the session, the office membership and the role on every request.
 */
export const RequireAuth = ({ children }: { children: ReactNode }) => {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <PageLoader />
  if (status === 'anonymous')
    return <Navigate to={ROUTES.login} replace state={{ from: location.pathname }} />
  return children
}

/** Requires an active office on the server-side session (dashboard and office features). */
export const RequireOffice = ({ children }: { children: ReactNode }) => {
  const { status, session } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <PageLoader />
  if (!session) return <Navigate to={ROUTES.login} replace state={{ from: location.pathname }} />
  if (!session.active_office) return <Navigate to={destinationFor(session)} replace />
  return children
}

/** Sends a signed-in visitor of a public auth page (sign-in, …) to where they belong. */
export const RedirectIfAuthenticated = ({ children }: { children: ReactNode }) => {
  const { status, session } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <PageLoader />
  if (session) return <Navigate to={postLoginPath(location.state, session)} replace />
  return children
}
