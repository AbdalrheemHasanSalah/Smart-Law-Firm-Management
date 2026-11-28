import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Each audience signs in through its own page (owner, staff or client). The page sends the
 * `X-Qadiyati-Portal` header; after the password has been checked, and before any session is
 * created, the account must hold a role that belongs to that page. Without the header nothing
 * is checked (sign-up, password reset and existing API clients keep working).
 */
export const PORTALS = ['owner', 'staff', 'client'];
export const PORTAL_HEADER = 'x-qadiyati-portal';

export const portalContext = new AsyncLocalStorage();

/** Express middleware for the sign-in route: carries the requested portal to the auth adapter. */
export function withRequestedPortal(request, response, next) {
  const portal = request.get(PORTAL_HEADER);
  if (portal === undefined) return next();
  if (!PORTALS.includes(portal)) {
    return response.status(400).json({ code: 'VALIDATION', error: 'Unknown sign-in portal.' });
  }
  return portalContext.run({ portal }, next);
}

/**
 * The portals an account may use, from its memberships (one row per membership; a single row
 * with a null role when it has none). An account without an office yet uses the owner page,
 * where it can register an office; the platform owner signs in there too.
 */
export function portalsFor(rows) {
  const memberships = rows.filter((row) => row.role);
  const isPlatformAdmin = rows.some((row) => row.is_platform_admin === true);
  const allowed = [];
  if (isPlatformAdmin || memberships.length === 0 || memberships.some((row) => row.is_owner)) {
    allowed.push('owner');
  }
  if (memberships.some((row) => ['lawyer', 'assistant', 'accountant', 'data_entry', 'print_only'].includes(row.role)
    || (row.role === 'admin' && !row.is_owner))) {
    allowed.push('staff');
  }
  if (memberships.some((row) => row.role === 'client')) allowed.push('client');
  return allowed;
}
