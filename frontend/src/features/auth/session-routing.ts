import { ROUTES } from '@/app/router/routes'
import type { AuthSession, Membership } from './types'

/** A membership the user can actually work in right now. */
export const isUsableMembership = (membership: Membership) =>
  membership.office_status === 'active' && membership.membership_status === 'active'

/**
 * Where a signed-in user belongs, derived only from the server's session:
 * an active office → dashboard; several usable offices → picker; otherwise onboarding,
 * which explains a pending, rejected or suspended office or offers to register one.
 */
export const destinationFor = (session: AuthSession | null): string => {
  if (!session) return ROUTES.login
  if (session.active_office) return ROUTES.dashboard
  if (session.memberships.some(isUsableMembership)) return ROUTES.selectOffice
  return ROUTES.onboarding
}

/** Accepts only in-app paths, so a crafted `from` value can never redirect off-site. */
export const safeRedirectPath = (value: unknown): string | null =>
  typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : null

/**
 * After sign-in: back to the page that required it (router `state.from`), but only once an
 * office is active — an invitation link is the exception, since it is how an office is joined.
 */
export const postLoginPath = (locationState: unknown, session: AuthSession | null): string => {
  const from = safeRedirectPath((locationState as { from?: unknown } | null)?.from)
  if (from && (session?.active_office || from.startsWith('/invite/'))) return from
  return destinationFor(session)
}
