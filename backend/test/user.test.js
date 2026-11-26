import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');

const authUserId = 'auth-user-id';
const adminUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const targetUserId = '1cdd115e-0279-48b4-a795-1be1d5a50d0b';
const session = {
  user: { id: authUserId },
  session: { id: 'session-id', expiresAt: '2999-01-01T00:00:00.000Z' },
};
const adminUser = {
  user_id: adminUserId,
  auth_user_id: authUserId,
  full_name: 'Test Administrator',
  email: 'admin@example.com',
  email_verified: true,
  status: 'active',
  role_id: 'role-id',
  office_id: '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d',
  role: 'admin',
};
const targetUser = {
  user_id: targetUserId,
  auth_user_id: 'target-auth-user-id',
  full_name: 'Taylor Lawyer',
  email: 'taylor@example.com',
  email_verified: true,
  status: 'active',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  role: 'lawyer',
  lawyer_profile_id: 'profile-id',
  bar_number: 'BAR-001',
  specialty: 'Family law',
  years_experience: 5,
  license_status: 'active',
  password_hash: 'must-not-be-returned',
  token: 'must-not-be-returned',
};

let server;
let baseUrl;

before(async () => {
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
  await pool.end();
});

function setupRequest(t, role = 'admin', databaseHandler = async () => ({ rowCount: 0, rows: [] }), options = {}) {
  t.mock.method(console, 'error', () => {});
  t.mock.method(auth.api, 'getSession', async () => options.session ?? session);
  const calls = [];
  t.mock.method(pool, 'query', async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    if (sql.includes('WHERE u.auth_user_id = $1')) {
      if (role === 'no-app-user') {
        return { rowCount: 0, rows: [] };
      }
      return {
        rowCount: 1,
        rows: [{ ...adminUser, role, status: options.status ?? 'active' }],
      };
    }
    return databaseHandler(sql, parameters);
  });
  return calls;
}

function mockStatusTransaction(
  t,
  { userExists = true, previousStatus = 'active', failOnSessionClear = false } = {}
) {
  const calls = [];
  const client = {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowCount: null, rows: [] };
      }
      if (sql.includes('FROM office_memberships membership') && sql.includes('FOR UPDATE OF membership')) {
        return userExists
          ? {
              rowCount: 1,
              rows: [{ status: previousStatus, auth_user_id: targetUser.auth_user_id }],
            }
          : { rowCount: 0, rows: [] };
      }
      if (sql.includes('UPDATE office_memberships') && sql.includes('SET status')) {
        return userExists
          ? { rowCount: 1, rows: [{ user_id: targetUserId }] }
          : { rowCount: 0, rows: [] };
      }
      if (sql.includes('UPDATE sessions SET active_office_id = NULL')) {
        if (failOnSessionClear) throw new Error('session update failed');
        return { rowCount: 1, rows: [] };
      }
      assert.fail(`Unexpected transaction query: ${sql}`);
    },
    release() {},
  };
  t.mock.method(pool, 'connect', async () => client);
  return calls;
}

async function request(method, route, body, cookie = 'better-auth.session_token=test-session') {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  const options = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  return fetch(`${baseUrl}${route}`, options);
}

test('administrator can list users with bounded pagination and safe fields', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql, parameters) => {
    assert.doesNotMatch(sql, /password_hash|session_token|auth_users/);
    if (sql.includes('COUNT(*)')) {
      return { rowCount: 1, rows: [{ total: 1 }] };
    }
    return { rowCount: 1, rows: [targetUser] };
  });

  const response = await request('GET', '/api/users?page=2&pageSize=100&search=Taylor&role=lawyer&status=active');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.users.length, 1);
  assert.equal(body.users[0].role, 'lawyer');
  assert.equal(body.users[0].lawyer_profile.specialty, 'Family law');
  assert.equal(Object.hasOwn(body.users[0], 'auth_user_id'), false);
  assert.equal(Object.hasOwn(body.users[0], 'password_hash'), false);
  assert.equal(Object.hasOwn(body.users[0], 'token'), false);
  assert.deepEqual(body.pagination, {
    page: 2,
    pageSize: 50,
    total: 1,
    totalPages: 1,
  });
  assert.deepEqual(calls[0].parameters, [authUserId, session.session.id]);
  assert.match(calls[1].sql, /membership\.office_id = \$1/);
  assert.deepEqual(calls[1].parameters, [officeId, '%Taylor%', 'lawyer', 'active']);
  assert.deepEqual(calls[2].parameters, [officeId, '%Taylor%', 'lawyer', 'active', 50, 50]);
});

test('clients, assistants, and lawyers cannot list users or change roles', async (t) => {
  for (const role of ['client', 'assistant', 'lawyer']) {
    const calls = setupRequest(t, role);
    assert.equal((await request('GET', '/api/users')).status, 403);
    assert.equal((await request('PATCH', `/api/users/${targetUserId}/role`, {
      role: 'admin',
    })).status, 403);
    assert.equal(calls.length, 2, 'Only the authenticated application-user mapping may be queried.');
  }
});

test('missing sessions and missing app-user mappings fail closed', async (t) => {
  const unauthenticatedCalls = [];
  t.mock.method(auth.api, 'getSession', async () => null);
  t.mock.method(pool, 'query', async (...args) => {
    unauthenticatedCalls.push(args);
    return { rowCount: 0, rows: [] };
  });
  assert.equal((await request('GET', '/api/users', undefined, null)).status, 401);
  assert.equal(unauthenticatedCalls.length, 0);

  const calls = setupRequest(t, 'no-app-user');
  assert.equal((await request('GET', '/api/users')).status, 401);
  assert.equal(calls.length, 1);
});

test('suspended administrators cannot access user-management routes', async (t) => {
  const calls = setupRequest(t, 'admin', undefined, { status: 'suspended' });
  assert.equal((await request('GET', '/api/users')).status, 403);
  assert.equal(calls.length, 1);
});

test('invalid identifiers, list filters, and mass-assignment fields are rejected before target queries', async (t) => {
  const calls = setupRequest(t);
  assert.equal((await request('GET', '/api/users/not-a-uuid')).status, 400);
  assert.equal((await request('GET', '/api/users?role=superuser')).status, 400);
  assert.equal((await request('PATCH', `/api/users/${targetUserId}/role`, {
    role: 'lawyer',
    status: 'suspended',
  })).status, 400);
  assert.equal((await request('PATCH', `/api/users/${targetUserId}/status`, {
    status: 'suspended',
    role: 'admin',
  })).status, 400);
  assert.equal(calls.length, 4, 'Invalid target input must not query user-management data.');
});

test('administrator can change another user role using an allowlisted role', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql, parameters) => {
    if (sql.includes('UPDATE office_memberships AS membership')) {
      assert.match(sql, /membership\.office_id = \$3/);
      assert.deepEqual(parameters, [targetUserId, 'assistant', officeId]);
      return { rowCount: 1, rows: [{ user_id: targetUserId }] };
    }
    if (sql.includes('JOIN app_users u') && sql.includes('WHERE u.user_id = $1')) {
      return { rowCount: 1, rows: [{ ...targetUser, role: 'assistant' }] };
    }
    return { rowCount: 0, rows: [] };
  });

  const response = await request('PATCH', `/api/users/${targetUserId}/role`, {
    role: 'assistant',
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.role, 'assistant');
  assert.deepEqual(calls[1].parameters, [targetUserId, 'assistant', officeId]);
});

test('administrator cannot change their own role or suspend themselves', async (t) => {
  const calls = setupRequest(t);
  assert.equal((await request('PATCH', `/api/users/${adminUserId}/role`, {
    role: 'client',
  })).status, 400);
  assert.equal((await request('PATCH', `/api/users/${adminUserId}/status`, {
    status: 'suspended',
  })).status, 400);
  assert.equal(calls.length, 2);
});

test('missing users return 404 and status changes update only the requested account', async (t) => {
  const transactionCalls = mockStatusTransaction(t);
  const calls = setupRequest(t, 'admin', async (sql, parameters) => {
    if (sql.includes('JOIN app_users u') && sql.includes('WHERE u.user_id = $1')) {
      assert.match(sql, /membership\.office_id = \$2/);
      if (parameters[0] === adminUserId) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [{ ...targetUser, status: 'suspended' }] };
    }
    if (sql.includes('JOIN app_users u') && sql.includes('WHERE u.user_id')) {
      return { rowCount: 0, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  });

  const missing = await request('GET', `/api/users/${adminUserId}`);
  assert.equal(missing.status, 404);
  const updated = await request('PATCH', `/api/users/${targetUserId}/status`, {
    status: 'suspended',
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).user.status, 'suspended');
  assert.equal(calls.length, 4);
  assert.deepEqual(transactionCalls.map(({ sql }) => sql.trim().split(/\s+/)[0]), [
    'BEGIN',
    'SELECT',
    'UPDATE',
    'UPDATE',
    'COMMIT',
  ]);
  assert.deepEqual(transactionCalls[1].parameters, [targetUserId, officeId]);
  assert.deepEqual(transactionCalls[2].parameters, [targetUserId, 'suspended', officeId]);
  // Only this office is removed from the member's sessions; the account and other offices are untouched.
  assert.deepEqual(transactionCalls[3].parameters, [targetUser.auth_user_id, officeId]);
  assert.deepEqual(calls[3].parameters, [targetUserId, officeId]);
});

test('session-update failure rolls back the membership status change', async (t) => {
  const transactionCalls = mockStatusTransaction(t, { failOnSessionClear: true });
  const calls = setupRequest(t);

  const response = await request('PATCH', `/api/users/${targetUserId}/status`, {
    status: 'suspended',
  });

  assert.equal(response.status, 500);
  assert.deepEqual(transactionCalls.map(({ sql }) => sql.trim().split(/\s+/)[0]), [
    'BEGIN',
    'SELECT',
    'UPDATE',
    'UPDATE',
    'ROLLBACK',
  ]);
  assert.equal(calls.length, 1, 'The user response must not be queried after the transaction fails.');
});

test('a missing status target rolls back without attempting session revocation', async (t) => {
  const transactionCalls = mockStatusTransaction(t, { userExists: false });
  const calls = setupRequest(t);

  const response = await request('PATCH', `/api/users/${targetUserId}/status`, {
    status: 'suspended',
  });

  assert.equal(response.status, 404);
  assert.deepEqual(transactionCalls.map(({ sql }) => sql.trim().split(/\s+/)[0]), [
    'BEGIN',
    'SELECT',
    'ROLLBACK',
  ]);
  assert.equal(calls.length, 1);
});

// A suspended membership can never be selected as a session's active office, so reactivating it
// has no sessions to revoke.
test('reactivation restores the membership without touching sessions', async (t) => {
  const transactionCalls = mockStatusTransaction(t, { previousStatus: 'suspended' });
  setupRequest(t, 'admin', async (sql) => {
    if (sql.includes('JOIN app_users u') && sql.includes('WHERE u.user_id = $1')) {
      return { rowCount: 1, rows: [{ ...targetUser, status: 'active' }] };
    }
    return { rowCount: 0, rows: [] };
  });

  const response = await request('PATCH', `/api/users/${targetUserId}/status`, {
    status: 'active',
  });

  assert.equal(response.status, 200);
  assert.deepEqual(transactionCalls.map(({ sql }) => sql.trim().split(/\s+/)[0]), [
    'BEGIN',
    'SELECT',
    'UPDATE',
    'COMMIT',
  ]);
  assert.deepEqual(transactionCalls[2].parameters, [targetUserId, 'active', officeId]);
});
