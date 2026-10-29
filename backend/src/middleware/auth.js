import { auth } from '../config/auth.js';
import { query } from '../config/db.js';

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
        office.office_id
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
    return next();
  } catch (error) {
    return next(error);
  }
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

export function requireRole(allowedRoles) {
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
