import { auth } from '../config/auth.js';
import { query } from '../config/db.js';

export function isSessionExpired(session) {
  if (!session?.session?.expiresAt) {
    return true;
  }

  const expiresAt = new Date(session.session.expiresAt).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
}

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
        u.created_at,
        u.updated_at,
        u.role_id,
        r.role_name AS role
      FROM app_users u
      JOIN roles r ON r.role_id = u.role_id
      JOIN sessions s
        ON s.user_id = u.auth_user_id
        AND s.id = $2
        AND s.expires_at > NOW()
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
        error: 'Authentication required or session expired. Please sign in again.',
      });
    }

    request.session = session;

    const user = await getCurrentUserFromRequest(request, session);

    if (!user) {
      return response.status(401).json({ error: 'User account not found.' });
    }

    if (user.status !== 'active') {
      return response.status(403).json({
        error: 'Account is inactive or suspended.',
      });
    }

    request.user = user;
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

    if (!user || !normalizedAllowedRoles.includes(user.role)) {
      return response.status(403).json({
        error: 'You do not have permission to access this resource.',
      });
    }

    return next();
  };
}

export function requireAnyRole(allowedRoles) {
  return requireRole(allowedRoles);
}
