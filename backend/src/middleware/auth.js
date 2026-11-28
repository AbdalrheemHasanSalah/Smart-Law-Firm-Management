import { auth } from '../config/auth.js';
import { query } from '../config/db.js';
import { isSubscriptionLocked } from '../config/subscription.js';
import { effectivePermissions, NEW_ROLES, permissionFor, ROLE_DEFAULTS, STAFF_ROLES } from '../config/permissions.js';

export function isSessionExpired(session) {
  if (!session?.session?.expiresAt) {
    return true;
  }

  const expiresAt = new Date(session.session.expiresAt).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
}

/**
 * Loads the account and, when the session has an active office, the caller's membership in it.
 * `role` and `office_id` are only populated when both the membership and the office are active,
 * so every role check below is implicitly scoped to one verified office.
 */
export async function getCurrentUserFromRequest(request, session) {
  if (
    !session?.user
    || isSessionExpired(session)
    || typeof session.session?.id !== 'string'
    || !session.session.id
  ) {
    return null;
  }

  const result = await query(
    `
      SELECT
        u.user_id,
        u.auth_user_id,
        u.full_name,
        u.email,
        u.email_verified,
        u.status,
        u.is_platform_admin,
        u.created_at,
        u.updated_at,
        CASE WHEN office.office_id IS NOT NULL THEN membership.role_id END AS role_id,
        CASE WHEN office.office_id IS NOT NULL THEN r.role_name END AS role,
        CASE WHEN office.office_id IS NOT NULL THEN membership.is_owner END AS is_owner,
        CASE WHEN office.office_id IS NOT NULL THEN membership.permissions_granted END AS permissions_granted,
        CASE WHEN office.office_id IS NOT NULL THEN membership.permissions_revoked END AS permissions_revoked,
        office.office_id,
        office.subscription_ends_at
      FROM app_users u
      JOIN sessions s
        ON s.user_id = u.auth_user_id
        AND s.id = $2
        AND s.expires_at > NOW()
      LEFT JOIN office_memberships membership
        ON membership.office_id = s.active_office_id
        AND membership.user_id = u.user_id
        AND membership.status = 'active'
      LEFT JOIN law_offices office
        ON office.office_id = membership.office_id
        AND office.status = 'active'
      LEFT JOIN roles r ON r.role_id = membership.role_id
      WHERE u.auth_user_id = $1
      LIMIT 1
    `,
    [session.user.id, session.session.id]
  );

  if (!result.rowCount) {
    return null;
  }

  return result.rows[0];
}

export async function requireAuth(request, response, next) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user || isSessionExpired(session)) {
      return response.status(401).json({
        code: 'UNAUTHORIZED',
        error: 'Authentication required or session expired. Please sign in again.',
      });
    }

    request.session = session;

    const user = await getCurrentUserFromRequest(request, session);

    if (!user) {
      return response.status(401).json({ code: 'UNAUTHORIZED', error: 'User account not found.' });
    }

    if (user.status !== 'active') {
      return response.status(403).json({
        code: 'ACCOUNT_INACTIVE',
        error: 'Account is inactive or suspended.',
      });
    }

    request.user = user;
    const denied = applyPermissionGate(request);
    if (denied) return response.status(403).json(denied);
    return next();
  } catch (error) {
    return next(error);
  }
}

/**
 * Applies the office permission map (config/permissions.js) to a staff member's request. Records
 * the real role and the permissions on `request.user`, and returns an error body when the request
 * is refused. New roles act as the office admin on the routes their permissions open, and as an
 * assistant on their own things; built-in roles keep their behaviour unless the owner revoked or
 * granted the route's permission.
 */
export function applyPermissionGate(request) {
  const user = request.user;
  if (!user?.office_id || !STAFF_ROLES.has(user.role) || user.office_role) return null;
  const role = user.role;
  const permissions = effectivePermissions(user);
  user.office_role = role;
  user.permissions = [...permissions];
  const required = permissionFor(request.method, request.originalUrl ?? request.url ?? '');
  if (required === 'session') return null;
  const refused = { code: 'PERMISSION_DENIED', error: 'Your role in this office does not allow this action.' };
  if (NEW_ROLES.has(role)) {
    if (required === 'open') {
      user.role = 'assistant';
      return null;
    }
    if (required && required !== 'client' && permissions.has(required)) {
      user.role = 'admin';
      return null;
    }
    return refused;
  }
  if (!required || required === 'open' || required === 'client') return null;
  const byDefault = (ROLE_DEFAULTS[role] ?? []).includes(required);
  if (byDefault && !permissions.has(required)) return refused;
  if (!byDefault && permissions.has(required)) user.role = 'admin';
  return null;
}

/**
 * For pages open to everyone (the support chat): sets `request.user` when a signed-in, active
 * account sent the request, and otherwise lets it through anonymously. Never rejects.
 */
export async function optionalAuth(request, _response, next) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (session?.user && !isSessionExpired(session)) {
      const user = await getCurrentUserFromRequest(request, session);
      if (user?.status === 'active') request.user = user;
    }
  } catch {
    // An unreadable session is treated as no session on a public route.
  }
  return next();
}

/**
 * Accepts any valid session regardless of account status. Used only for sign-out, so that a
 * suspended account can still end its session instead of leaving it behind in the database.
 */
export async function requireSession(request, response, next) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user || isSessionExpired(session)) {
      return response.status(401).json({
        code: 'UNAUTHORIZED',
        error: 'Authentication required or session expired. Please sign in again.',
      });
    }
    request.session = session;
    return next();
  } catch (error) {
    return next(error);
  }
}

/**
 * Allows the listed office roles. An office whose subscription and grace period have both ended
 * is locked for everyone (SUBSCRIPTION_EXPIRED) except on routes that opt out with
 * `allowLockedSubscription`, such as the owner's subscription page.
 */
export function requireRole(allowedRoles, { allowLockedSubscription = false } = {}) {
  return (request, response, next) => {
    const user = request.user;
    const normalizedAllowedRoles = Array.isArray(allowedRoles)
      ? allowedRoles
      : [allowedRoles];

    if (user && !user.office_id) {
      return response.status(403).json({
        code: 'NO_ACTIVE_OFFICE',
        error: 'Select an office you belong to before accessing this resource.',
      });
    }

    if (!user || !normalizedAllowedRoles.includes(user.role)) {
      return response.status(403).json({
        code: 'FORBIDDEN',
        error: 'You do not have permission to access this resource.',
      });
    }

    if (!allowLockedSubscription && isSubscriptionLocked(user.subscription_ends_at)) {
      return response.status(403).json({
        code: 'SUBSCRIPTION_EXPIRED',
        error: 'The office subscription has expired.',
      });
    }

    return next();
  };
}

export function requireAnyRole(allowedRoles) {
  return requireRole(allowedRoles);
}

export function requirePlatformAdmin(request, response, next) {
  if (request.user?.is_platform_admin !== true) {
    return response.status(403).json({
      code: 'FORBIDDEN',
      error: 'You do not have permission to access this resource.',
    });
  }
  return next();
}
