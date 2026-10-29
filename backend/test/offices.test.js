import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');

// These mocked tests prove the SQL is scoped and the checks run in order; they do not prove
// PostgreSQL behaviour. The composite foreign keys in schema.sql are the database-level backstop.
const officeA = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const officeB = '0c2d4e6f-8a1b-4c3d-9e5f-7a9b1c3d5e7f';
const appUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const caseId = '1cdd115e-0279-48b4-a795-1be1d5a50d0b';
const clientId = 'e4663540-663f-4d4d-b8f2-bfbc6a414d64';
const session = {
  user: { id: 'auth-user-id' },
  session: { id: 'session-id', expiresAt: '2999-01-01T00:00:00.000Z' },
};
const account = {
  user_id: appUserId,
  auth_user_id: 'auth-user-id',
  full_name: 'Office Owner',
  email: 'owner@office.ps',
  email_verified: false,
  status: 'active',
  is_platform_admin: false,
  role_id: null,
  role: null,
  office_id: null,
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

function setup(t, user = {}, handler = async () => ({ rowCount: 0, rows: [] })) {
  t.mock.method(console, 'error', () => {});
  t.mock.method(auth.api, 'getSession', async () => session);
  const calls = [];
  t.mock.method(pool, 'query', async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    if (sql.includes('JOIN sessions s')) {
      return { rowCount: 1, rows: [{ ...account, ...user }] };
    }
    return handler(sql, parameters);
  });
  return calls;
}

function mockTransaction(t, handler) {
  const calls = [];
  const release = { count: 0 };
  t.mock.method(pool, 'connect', async () => ({
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: null, rows: [] };
      const result = await handler(sql, parameters);
      if (result === undefined) assert.fail(`Unexpected transaction query: ${sql}`);
      return result;
    },
    release() {
      release.count += 1;
    },
  }));
  return { calls, release };
}

async function request(method, path, body) {
  const headers = { cookie: 'better-auth.session_token=test' };
  const options = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  return fetch(`${baseUrl}${path}`, options);
}

const validRegistration = {
  office: { name: ' Haddad & Partners ', phone: '+970 59 123 4567', city: 'Nablus', email: 'info@haddad.ps' },
  lawyer: { bar_number: 'PBA-12345', specialty: 'Commercial law', years_experience: 8 },
};

test('business routes refuse a session without a verified active office', async (t) => {
  const calls = setup(t, { role: null, office_id: null });
  const response = await request('GET', '/api/cases');
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'NO_ACTIVE_OFFICE');
  assert.equal(calls.length, 1, 'No business data may be queried without an office.');
});

test('the role is resolved only from an active membership in an active office', async (t) => {
  const calls = setup(t);
  await request('GET', '/api/me');
  const lookup = calls[0].sql;
  assert.match(lookup, /membership\.office_id = s\.active_office_id/);
  assert.match(lookup, /membership\.status = 'active'/);
  assert.match(lookup, /office\.status = 'active'/);
  assert.match(lookup, /CASE WHEN office\.office_id IS NOT NULL THEN r\.role_name END AS role/);
});

test('an office admin reads cases only inside their own office', async (t) => {
  const calls = setup(t, { role: 'admin', office_id: officeA }, async (sql, parameters) => {
    assert.match(sql, /lc\.office_id = \$2/);
    assert.deepEqual(parameters, [caseId, officeA]);
    return { rowCount: 0, rows: [] };
  });
  // A case that exists in office B is indistinguishable from a missing one.
  assert.equal((await request('GET', `/api/cases/${caseId}`)).status, 404);
  assert.equal(calls.length, 2);
});

test('a client in office A cannot reach office B data through a client ID', async (t) => {
  setup(t, { role: 'client', office_id: officeA }, async (sql, parameters) => {
    assert.ok(parameters.includes(officeA));
    assert.equal(parameters.includes(officeB), false);
    return sql.includes('COUNT(*)') ? { rowCount: 1, rows: [{ total: 0 }] } : { rowCount: 0, rows: [] };
  });
  assert.equal((await request('GET', `/api/clients/${clientId}/cases`)).status, 404);
});

test('selecting an office ignores offices the account does not belong to', async (t) => {
  const calls = setup(t, {}, async (sql) => {
    if (sql.includes('FROM office_memberships membership')) return { rowCount: 0, rows: [] };
    assert.fail('Sessions must not be updated for a non-member.');
  });
  const response = await request('POST', '/api/session/office', { office_id: officeB });
  assert.equal(response.status, 404);
  assert.equal(calls.some(({ sql }) => sql.includes('UPDATE sessions')), false);
});

test('a pending or suspended office cannot become the active office', async (t) => {
  for (const [officeStatus, membershipStatus, code] of [
    ['pending', 'active', 'OFFICE_PENDING'],
    ['suspended', 'active', 'OFFICE_INACTIVE'],
    ['active', 'suspended', 'MEMBERSHIP_SUSPENDED'],
  ]) {
    await t.test(code, async (subtest) => {
      setup(subtest, {}, async (sql) => {
        if (sql.includes('FROM office_memberships membership')) {
          return { rowCount: 1, rows: [{ office_status: officeStatus, membership_status: membershipStatus }] };
        }
        assert.fail('Sessions must not be updated.');
      });
      const response = await request('POST', '/api/session/office', { office_id: officeA });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, code);
    });
  }
});

test('selecting an active office stores it on this session only', async (t) => {
  const calls = setup(t, {}, async (sql) => {
    if (sql.includes('FROM office_memberships membership')) {
      return { rowCount: 1, rows: [{ office_status: 'active', membership_status: 'active' }] };
    }
    return { rowCount: 1, rows: [] };
  });
  const response = await request('POST', '/api/session/office', { office_id: officeA });
  assert.equal(response.status, 200);
  const update = calls.find(({ sql }) => sql.includes('UPDATE sessions'));
  assert.deepEqual(update.parameters, [officeA, 'session-id', 'auth-user-id']);
});

test('office registration validates required office and lawyer fields before any write', async (t) => {
  setup(t);
  const transaction = mockTransaction(t, async () => assert.fail('Invalid input must not reach the database.'));
  for (const body of [
    {},
    { office: validRegistration.office },
    { office: { ...validRegistration.office, name: ' ' }, lawyer: validRegistration.lawyer },
    { office: validRegistration.office, lawyer: { ...validRegistration.lawyer, bar_number: '' } },
    { office: validRegistration.office, lawyer: { ...validRegistration.lawyer, years_experience: -1 } },
    { office: { ...validRegistration.office, status: 'active' }, lawyer: validRegistration.lawyer },
    { ...validRegistration, role: 'admin' },
  ]) {
    assert.equal((await request('POST', '/api/offices', body)).status, 400);
  }
  assert.equal(transaction.calls.length, 0);
});

test('office registration creates a pending office owned by the caller in one transaction', async (t) => {
  setup(t);
  const transaction = mockTransaction(t, async (sql) => {
    if (sql.includes('FROM law_offices')) return { rowCount: 1, rows: [{ total: 0 }] };
    if (sql.includes('FROM lawyer_profiles')) return { rowCount: 0, rows: [] };
    if (sql.includes('INSERT INTO lawyer_profiles')) return { rowCount: 1, rows: [] };
    if (sql.includes('INSERT INTO law_offices')) {
      // The status is never supplied, so the column default 'pending' always applies.
      assert.doesNotMatch(sql.split('VALUES')[0], /status/);
      return { rowCount: 1, rows: [{ office_id: officeA, name: 'Haddad & Partners', status: 'pending', created_at: '2026-01-01T00:00:00.000Z' }] };
    }
    if (sql.includes('INSERT INTO office_memberships')) {
      assert.match(sql, /role_name = 'admin'/);
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes('INSERT INTO audit_logs')) return { rowCount: 1, rows: [] };
    return undefined;
  });
  const response = await request('POST', '/api/offices', validRegistration);
  assert.equal(response.status, 201);
  assert.equal((await response.json()).office.status, 'pending');
  const officeInsert = transaction.calls.find(({ sql }) => sql.includes('INSERT INTO law_offices'));
  assert.equal(officeInsert.parameters[0], 'Haddad & Partners');
  assert.equal(officeInsert.parameters.at(-1), appUserId);
  assert.equal(transaction.calls.at(-1).sql, 'COMMIT');
  assert.equal(transaction.release.count, 1);
});

test('a second registration while one is pending is refused and rolled back', async (t) => {
  setup(t);
  const transaction = mockTransaction(t, async (sql) => (
    sql.includes('FROM law_offices') ? { rowCount: 1, rows: [{ total: 1 }] } : undefined
  ));
  const response = await request('POST', '/api/offices', validRegistration);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'REGISTRATION_PENDING');
  assert.equal(transaction.calls.at(-1).sql, 'ROLLBACK');
});

test('only an office admin can create invitations, and only for allowed roles', async (t) => {
  for (const role of ['lawyer', 'assistant', 'client']) {
    await t.test(role, async (subtest) => {
      setup(subtest, { role, office_id: officeA });
      assert.equal((await request('POST', '/api/offices/current/invitations', {
        email: 'new@office.ps', role: 'lawyer',
      })).status, 403);
    });
  }
  setup(t, { role: 'admin', office_id: officeA });
  assert.equal((await request('POST', '/api/offices/current/invitations', {
    email: 'new@office.ps', role: 'admin',
  })).status, 400);
});

test('invitations store only a token hash and return a single-use link', async (t) => {
  let storedHash;
  setup(t, { role: 'admin', office_id: officeA }, async (sql, parameters) => {
    if (sql.includes('FROM office_memberships membership')) return { rowCount: 0, rows: [] };
    if (sql.includes('UPDATE office_invitations')) return { rowCount: 0, rows: [] };
    if (sql.includes('INSERT INTO office_invitations')) {
      assert.equal(parameters[0], officeA);
      storedHash = parameters[3];
      return { rowCount: 1, rows: [{ invitation_id: caseId, email: 'new@office.ps', client_id: null, expires_at: '2999-01-01T00:00:00.000Z', created_at: '2026-01-01T00:00:00.000Z', accepted_at: null, revoked_at: null }] };
    }
    return { rowCount: 0, rows: [] };
  });
  const response = await request('POST', '/api/offices/current/invitations', {
    email: ' New@Office.ps ', role: 'lawyer',
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  const token = body.invite_url.split('/invite/')[1];
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(storedHash, createHash('sha256').update(token).digest('hex'));
  assert.equal(JSON.stringify(body.invitation).includes(token), false);
});

test('a client invitation can only target an unlinked client record of the same office', async (t) => {
  setup(t, { role: 'admin', office_id: officeA }, async (sql, parameters) => {
    if (sql.includes('FROM clients WHERE client_id')) {
      assert.deepEqual(parameters, [clientId, officeA]);
      return { rowCount: 0, rows: [] };
    }
    assert.fail('No invitation may be written for a client of another office.');
  });
  const response = await request('POST', '/api/offices/current/invitations', {
    email: 'client@example.com', role: 'client', client_id: clientId,
  });
  assert.equal(response.status, 404);
});

test('the public invitation preview reveals no more than office, role, and a masked email', async (t) => {
  setup(t, {}, async () => ({
    rowCount: 1,
    rows: [{ email: 'samira@example.com', expires_at: '2999-01-01T00:00:00.000Z', accepted_at: null, revoked_at: null, role: 'client', office_name: 'Haddad & Partners', office_status: 'active' }],
  }));
  const response = await fetch(`${baseUrl}/api/invitations/${'a'.repeat(43)}`);
  assert.equal(response.status, 200);
  const { invitation } = await response.json();
  assert.deepEqual(Object.keys(invitation).sort(), ['email_hint', 'expires_at', 'office_active', 'office_name', 'role', 'state']);
  assert.equal(invitation.email_hint.startsWith('sa'), true);
  assert.equal(invitation.email_hint.includes('samira'), false);
  assert.equal((await fetch(`${baseUrl}/api/invitations/short`)).status, 404);
});

function invitationRow(overrides = {}) {
  return {
    invitation_id: caseId,
    office_id: officeA,
    email: 'owner@office.ps',
    client_id: clientId,
    role_id: 'role-id',
    expires_at: '2999-01-01T00:00:00.000Z',
    accepted_at: null,
    revoked_at: null,
    role: 'client',
    office_status: 'active',
    ...overrides,
  };
}

test('an invitation cannot be redeemed by an account with a different email', async (t) => {
  setup(t);
  const transaction = mockTransaction(t, async (sql) => (
    sql.includes('FROM office_invitations invitation')
      ? { rowCount: 1, rows: [invitationRow({ email: 'someone-else@office.ps' })] }
      : undefined
  ));
  const response = await request('POST', `/api/invitations/${'a'.repeat(43)}/accept`, {});
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'INVITATION_EMAIL_MISMATCH');
  assert.equal(transaction.calls.some(({ sql }) => sql.includes('INSERT INTO office_memberships')), false);
  assert.equal(transaction.calls.at(-1).sql, 'ROLLBACK');
});

test('used, revoked, or expired invitations are refused', async (t) => {
  for (const overrides of [
    { accepted_at: '2026-01-01T00:00:00.000Z' },
    { revoked_at: '2026-01-01T00:00:00.000Z' },
    { expires_at: '2000-01-01T00:00:00.000Z' },
  ]) {
    await t.test(Object.keys(overrides)[0], async (subtest) => {
      setup(subtest);
      mockTransaction(subtest, async (sql) => (
        sql.includes('FROM office_invitations invitation')
          ? { rowCount: 1, rows: [invitationRow(overrides)] }
          : undefined
      ));
      const response = await request('POST', `/api/invitations/${'a'.repeat(43)}/accept`, {});
      assert.equal(response.status, 410);
    });
  }
});

test('accepting a client invitation links exactly the invited client record in its office', async (t) => {
  setup(t);
  const transaction = mockTransaction(t, async (sql, parameters) => {
    if (sql.includes('FROM office_invitations invitation')) return { rowCount: 1, rows: [invitationRow()] };
    if (sql.includes('SELECT 1 FROM office_memberships')) return { rowCount: 0, rows: [] };
    if (sql.includes('INSERT INTO office_memberships')) {
      assert.deepEqual(parameters, [officeA, appUserId, 'role-id']);
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes('UPDATE clients')) {
      assert.match(sql, /user_id IS NULL/);
      assert.deepEqual(parameters, [appUserId, clientId, officeA]);
      return { rowCount: 1, rows: [{ client_id: clientId }] };
    }
    if (sql.includes('UPDATE office_invitations') || sql.includes('INSERT INTO audit_logs')) return { rowCount: 1, rows: [] };
    if (sql.includes('UPDATE sessions')) {
      assert.deepEqual(parameters, [officeA, 'session-id', 'auth-user-id']);
      return { rowCount: 1, rows: [] };
    }
    return undefined;
  });
  const response = await request('POST', `/api/invitations/${'a'.repeat(43)}/accept`, {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { office_id: officeA, role: 'client' });
  assert.equal(transaction.calls.at(-1).sql, 'COMMIT');
});

test('platform office review is limited to platform administrators', async (t) => {
  setup(t, { role: 'admin', office_id: officeA, is_platform_admin: false });
  assert.equal((await request('GET', '/api/platform/offices')).status, 403);
  assert.equal((await request('PATCH', `/api/platform/offices/${officeA}`, { status: 'active' })).status, 403);
});

test('approving an office verifies the owner licence; suspending clears open sessions', async (t) => {
  for (const status of ['active', 'suspended']) {
    await t.test(status, async (subtest) => {
      setup(subtest, { is_platform_admin: true });
      const transaction = mockTransaction(subtest, async (sql) => {
        if (sql.includes('UPDATE law_offices')) {
          return { rowCount: 1, rows: [{ office_id: officeA, name: 'Office', status, review_note: null, reviewed_at: '2026-01-01T00:00:00.000Z', created_by_user_id: appUserId }] };
        }
        if (sql.includes('UPDATE lawyer_profiles') || sql.includes('UPDATE sessions') || sql.includes('INSERT INTO audit_logs')) {
          return { rowCount: 1, rows: [] };
        }
        return undefined;
      });
      const response = await request('PATCH', `/api/platform/offices/${officeA}`, { status });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.office.status, status);
      assert.equal(Object.hasOwn(body.office, 'created_by_user_id'), false);
      const statements = transaction.calls.map(({ sql }) => sql);
      assert.equal(statements.some((sql) => sql.includes('UPDATE lawyer_profiles')), status === 'active');
      assert.equal(statements.some((sql) => sql.includes('UPDATE sessions')), status !== 'active');
    });
  }
});

test('a suspended account can still sign out, so its session does not linger', async (t) => {
  t.mock.method(auth.api, 'getSession', async () => session);
  const lookups = t.mock.method(pool, 'query', async () => ({
    rowCount: 1,
    rows: [{ ...account, status: 'suspended' }],
  }));
  const signOut = t.mock.method(auth.api, 'signOut', async () => new Response(
    JSON.stringify({ success: true }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  ));
  const response = await request('POST', '/api/logout');
  assert.equal(response.status, 200);
  assert.equal(signOut.mock.callCount(), 1);
  assert.equal(lookups.mock.callCount(), 0, 'Sign-out must not depend on the account status.');
});

test('platform account status changes are limited to platform administrators', async (t) => {
  setup(t, { role: 'admin', office_id: officeA, is_platform_admin: false });
  const response = await request('PATCH', `/api/platform/users/${clientId}/status`, { status: 'suspended' });
  assert.equal(response.status, 403);
});

test('suspending or reactivating an account deletes every session of it', async (t) => {
  for (const [previousStatus, status] of [['active', 'suspended'], ['suspended', 'active']]) {
    await t.test(`${previousStatus} -> ${status}`, async (subtest) => {
      setup(subtest, { is_platform_admin: true });
      const transaction = mockTransaction(subtest, async (sql) => {
        if (sql.includes('SELECT status, auth_user_id FROM app_users')) {
          return { rowCount: 1, rows: [{ status: previousStatus, auth_user_id: 'target-auth-id' }] };
        }
        if (sql.includes('UPDATE app_users')) {
          return { rowCount: 1, rows: [{ user_id: clientId, full_name: 'T', email: 't@x.ps', status }] };
        }
        if (sql.includes('DELETE FROM sessions') || sql.includes('INSERT INTO audit_logs')) {
          return { rowCount: 1, rows: [] };
        }
        return undefined;
      });
      const response = await request('PATCH', `/api/platform/users/${clientId}/status`, { status });
      assert.equal(response.status, 200);
      const deletion = transaction.calls.find(({ sql }) => sql.includes('DELETE FROM sessions'));
      assert.deepEqual(deletion?.parameters, ['target-auth-id']);
      assert.equal(transaction.calls.at(-1).sql, 'COMMIT');
    });
  }
});

test('a platform administrator cannot suspend their own account', async (t) => {
  setup(t, { is_platform_admin: true });
  const response = await request('PATCH', `/api/platform/users/${appUserId}/status`, { status: 'suspended' });
  assert.equal(response.status, 400);
});
