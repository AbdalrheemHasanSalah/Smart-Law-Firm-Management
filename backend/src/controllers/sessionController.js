import { auth } from '../config/auth.js';
import { listMemberships } from '../services/officeService.js';

function selectFields(value, fields) {
  return Object.fromEntries(fields.map((field) => [field, value?.[field]]));
}

function toPublicApplicationUser(user) {
  return selectFields(user, [
    'user_id',
    'full_name',
    'email',
    'email_verified',
    'status',
    'is_platform_admin',
    'created_at',
    'updated_at',
  ]);
}

/**
 * The frontend decides where to send the user from this single payload: the active office
 * (verified server-side) or, without one, the list of memberships to choose from.
 */
async function sessionContext(request) {
  const memberships = await listMemberships(request.user);
  const activeOffice = memberships.find(
    (membership) => membership.office_id === request.user.office_id
  ) ?? null;
  return {
    user: toPublicApplicationUser(request.user),
    role: request.user.role ?? null,
    active_office: activeOffice,
    memberships,
  };
}

function appendSetCookies(response, authResponse) {
  for (const cookie of authResponse.headers.getSetCookie?.() ?? []) {
    response.append('Set-Cookie', cookie);
  }
}

export function toPublicSession(authSession) {
  if (!authSession) {
    return null;
  }

  return {
    user: selectFields(authSession.user, [
      'id',
      'name',
      'email',
      'emailVerified',
      'image',
      'createdAt',
      'updatedAt',
    ]),
    session: selectFields(authSession.session, [
      'id',
      'userId',
      'expiresAt',
      'createdAt',
      'updatedAt',
    ]),
  };
}

export async function getMe(request, response, next) {
  try {
    response.status(200).json({
      ...(await sessionContext(request)),
      session: toPublicSession(request.session),
    });
  } catch (error) {
    next(error);
  }
}

export async function getCurrentSession(request, response, next) {
  try {
    response.status(200).json({
      ...(await sessionContext(request)),
      session: toPublicSession(request.session),
      expiresAt: request.session?.session?.expiresAt ?? null,
      expired: request.session
        ? new Date(request.session.session.expiresAt).getTime() <= Date.now()
        : false,
    });
  } catch (error) {
    next(error);
  }
}

export async function refreshSession(request, response, next) {
  try {
    const authResponse = await auth.api.getSession({
      headers: new Headers(request.headers),
      asResponse: true,
    });

    appendSetCookies(response, authResponse);

    if (!authResponse.ok) {
      const error = new Error('Better Auth session refresh failed.');
      error.status = authResponse.status;
      return next(error);
    }

    const nextSession = await authResponse.json();

    if (!nextSession?.user || !nextSession?.session) {
      return response.status(401).json({ error: 'Authentication required or session expired.' });
    }

    return response.status(200).json({
      refreshed: true,
      session: toPublicSession(nextSession),
      expiresAt: nextSession.session?.expiresAt ?? null,
    });
  } catch (error) {
    return next(error);
  }
}

export async function signOut(request, response, next) {
  try {
    const authResponse = await auth.api.signOut({
      headers: new Headers(request.headers),
      asResponse: true,
    });

    appendSetCookies(response, authResponse);

    const body = await authResponse.text();
    const payload = body ? JSON.parse(body) : { success: true };

    return response.status(authResponse.status).json(payload);
  } catch (error) {
    return next(error);
  }
}
