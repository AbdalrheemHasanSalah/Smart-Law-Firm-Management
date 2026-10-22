import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';

const { toPublicSession } = await import('../src/controllers/sessionController.js');
const { isSessionExpired, requireRole } = await import('../src/middleware/auth.js');
const { auth } = await import('../src/config/auth.js');
let app;
let pool;
let server;
let baseUrl;

before(async () => {
  ({ default: app } = await import('../src/app.js'));
  ({ pool } = await import('../src/config/db.js'));

  server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  await pool?.end();
});

test('public session omits the session token and network metadata', () => {
  const result = toPublicSession({
    user: {
      id: 'user-id',
      name: 'Test User',
      email: 'test@example.com',
      emailVerified: true,
      image: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      extra: 'not exposed',
    },
    session: {
      id: 'session-id',
      userId: 'user-id',
      token: 'must-not-be-exposed',
      expiresAt: '2026-01-08T00:00:00.000Z',
      ipAddress: '192.0.2.1',
      userAgent: 'test-agent',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  });

  assert.deepEqual(result.session, {
    id: 'session-id',
    userId: 'user-id',
    expiresAt: '2026-01-08T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(JSON.stringify(result).includes('must-not-be-exposed'), false);
  assert.equal(JSON.stringify(result).includes('192.0.2.1'), false);
  assert.equal(JSON.stringify(result).includes('not exposed'), false);
});

test('expired sessions are rejected while active sessions remain valid', () => {
  assert.equal(isSessionExpired({
    session: { expiresAt: '2000-01-01T00:00:00.000Z' },
  }), true);
  assert.equal(isSessionExpired({
    session: { expiresAt: '2999-01-01T00:00:00.000Z' },
  }), false);
  assert.equal(isSessionExpired(null), true);
  assert.equal(isSessionExpired({ session: {} }), true);
  assert.equal(isSessionExpired({
    session: { expiresAt: 'not-a-date' },
  }), true);
});

test('role middleware permits allowed roles and rejects other roles', () => {
  let nextCalls = 0;
  let responseStatus;
  let responseBody;
  const response = {
    status(status) {
      responseStatus = status;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
  };

  requireRole(['admin', 'lawyer'])(
    { user: { role: 'lawyer' } },
    response,
    () => { nextCalls += 1; }
  );
  assert.equal(nextCalls, 1);

  requireRole(['admin', 'lawyer'])(
    { user: { role: 'client' } },
    response,
    () => { nextCalls += 1; }
  );
  assert.equal(nextCalls, 1);
  assert.equal(responseStatus, 403);
  assert.equal(responseBody.error, 'You do not have permission to access this resource.');
});

test('health endpoint remains available', async () => {
  const response = await fetch(`${baseUrl}/api/health`);

  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
});

test('root endpoint identifies the API and points to its health check', async () => {
  const response = await fetch(`${baseUrl}/`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'ok',
    service: 'smart-law-firm-backend',
    health: '/api/health',
  });
});

test('Better Auth endpoints remain mounted', async () => {
  const response = await fetch(`${baseUrl}/api/auth/get-session`);

  assert.equal(response.status, 200);
});

test('protected endpoints reject requests without a Better Auth session', async () => {
  const routes = [
    ['GET', '/api/me'],
    ['GET', '/api/session'],
    ['GET', '/api/law'],
    ['GET', '/api/admin/law'],
    ['GET', '/api/staff/law'],
    ['GET', '/api/client/law'],
    ['POST', '/api/logout'],
    ['POST', '/api/sign-out'],
    ['POST', '/api/session/refresh'],
    ['GET', '/api/clients'],
    ['POST', '/api/clients'],
    ['GET', '/api/cases'],
    ['POST', '/api/cases'],
    ['GET', '/api/documents'],
    ['GET', '/api/contracts'],
    ['GET', '/api/tasks'],
    ['POST', '/api/tasks'],
    ['GET', '/api/users'],
    ['PATCH', '/api/notes/not-a-uuid'],
  ];

  for (const [method, path] of routes) {
    const response = await fetch(`${baseUrl}${path}`, { method });
    assert.equal(response.status, 401, `${method} ${path} should reject unauthenticated requests`);
  }
});

const activeSession = {
  user: {
    id: 'auth-user-id',
    name: 'Test User',
    email: 'test@example.com',
    emailVerified: true,
    image: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  session: {
    id: 'session-id',
    userId: 'auth-user-id',
    token: 'must-not-be-exposed',
    expiresAt: '2999-01-08T00:00:00.000Z',
    ipAddress: '192.0.2.1',
    userAgent: 'test-agent',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
};

const activeUser = {
  user_id: 'app-user-id',
  auth_user_id: 'auth-user-id',
  full_name: 'Test User',
  email: 'test@example.com',
  email_verified: true,
  status: 'active',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  role_id: 'role-id',
  role: 'client',
};

function mockUserLookup(t, user = activeUser) {
  return t.mock.method(pool, 'query', async (sql, params) => {
    assert.match(sql, /JOIN sessions s/);
    assert.equal(sql.includes('password_hash'), false);
    assert.deepEqual(params, ['auth-user-id', 'session-id']);
    return { rowCount: 1, rows: [{ ...user, password_hash: 'stored-hash' }] };
  });
}

test('Better Auth session authenticates the current-user endpoint without exposing password hashes', async (t) => {
  mockUserLookup(t);
  t.mock.method(auth.api, 'getSession', async () => activeSession);

  const response = await fetch(`${baseUrl}/api/me`, {
    headers: { cookie: 'better-auth.session_token=test-token' },
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.user.email, 'test@example.com');
  assert.equal(body.role, 'client');
  assert.equal(Object.hasOwn(body.user, 'password_hash'), false);
  assert.equal(JSON.stringify(body).includes('must-not-be-exposed'), false);
});

test('Better Auth rejects expired sessions before loading the application user', async (t) => {
  const userLookup = t.mock.method(pool, 'query', async () => {
    assert.fail('Expired sessions must not query the application user.');
  });
  t.mock.method(auth.api, 'getSession', async () => ({
    ...activeSession,
    session: { ...activeSession.session, expiresAt: '2000-01-01T00:00:00.000Z' },
  }));

  const response = await fetch(`${baseUrl}/api/me`, {
    headers: { cookie: 'better-auth.session_token=expired-token' },
  });

  assert.equal(response.status, 401);
  assert.equal(userLookup.mock.callCount(), 0);
});

test('a session without a database session identifier fails closed', async (t) => {
  const userLookup = t.mock.method(pool, 'query', async () => {
    assert.fail('Sessions without an ID must not query the application user.');
  });
  t.mock.method(auth.api, 'getSession', async () => ({
    ...activeSession,
    session: { expiresAt: activeSession.session.expiresAt },
  }));

  const response = await fetch(`${baseUrl}/api/me`, {
    headers: { cookie: 'better-auth.session_token=invalid-session' },
  });

  assert.equal(response.status, 401);
  assert.equal(userLookup.mock.callCount(), 0);
});

test('a cached Better Auth session is rejected when its database session was revoked', async (t) => {
  const userLookup = t.mock.method(pool, 'query', async (sql, parameters) => {
    assert.match(sql, /JOIN sessions s/);
    assert.deepEqual(parameters, ['auth-user-id', 'session-id']);
    return { rowCount: 0, rows: [] };
  });
  t.mock.method(auth.api, 'getSession', async () => activeSession);

  const response = await fetch(`${baseUrl}/api/me`, {
    headers: { cookie: 'better-auth.session_token=revoked-token' },
  });

  assert.equal(response.status, 401);
  assert.equal(userLookup.mock.callCount(), 1);
});

test('inactive users cannot refresh their Better Auth sessions', async (t) => {
  mockUserLookup(t, { ...activeUser, status: 'suspended' });
  const getSession = t.mock.method(auth.api, 'getSession', async () => activeSession);

  const response = await fetch(`${baseUrl}/api/session/refresh`, {
    method: 'POST',
    headers: { cookie: 'better-auth.session_token=test-token' },
  });

  assert.equal(response.status, 403);
  assert.equal(getSession.mock.callCount(), 1);
});

test('active users can refresh Better Auth sessions without exposing the token', async (t) => {
  mockUserLookup(t);
  t.mock.method(auth.api, 'getSession', async (options) => {
    if (!options.asResponse) {
      return activeSession;
    }

    return new Response(JSON.stringify(activeSession), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'better-auth.session_token=renewed-token; HttpOnly',
      },
    });
  });

  const response = await fetch(`${baseUrl}/api/session/refresh`, {
    method: 'POST',
    headers: { cookie: 'better-auth.session_token=test-token' },
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.refreshed, true);
  assert.equal(JSON.stringify(body).includes('must-not-be-exposed'), false);
  assert.deepEqual(response.headers.getSetCookie(), [
    'better-auth.session_token=renewed-token; HttpOnly',
  ]);
});

test('active users can sign out through Better Auth and receive the cleared session cookie', async (t) => {
  mockUserLookup(t);
  t.mock.method(auth.api, 'getSession', async () => activeSession);
  t.mock.method(auth.api, 'signOut', async () => new Response(
    JSON.stringify({ success: true }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'better-auth.session_token=; Max-Age=0; HttpOnly',
      },
    }
  ));

  const response = await fetch(`${baseUrl}/api/logout`, {
    method: 'POST',
    headers: { cookie: 'better-auth.session_token=test-token' },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.deepEqual(response.headers.getSetCookie(), [
    'better-auth.session_token=; Max-Age=0; HttpOnly',
  ]);
});

test('role-restricted endpoints deny authenticated clients without leaking user data', async (t) => {
  mockUserLookup(t);
  t.mock.method(auth.api, 'getSession', async () => activeSession);

  const response = await fetch(`${baseUrl}/api/admin/law`, {
    headers: { cookie: 'better-auth.session_token=test-token' },
  });

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'You do not have permission to access this resource.');
});
