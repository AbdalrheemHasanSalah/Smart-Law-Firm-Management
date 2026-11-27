import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');

const appUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const documentId = 'a1111111-1111-4111-8111-111111111111';
const clientId = 'b2222222-2222-4222-8222-222222222222';
const caseId = 'e4663540-663f-4d4d-b8f2-bfbc6a414d64';
const session = { user: { id: 'auth-user-id' }, session: { id: 'session-id', expiresAt: '2999-01-01T00:00:00.000Z' } };
const mappedUser = {
  user_id: appUserId, auth_user_id: 'auth-user-id', full_name: 'Owner', email: 'owner@example.com',
  email_verified: true, status: 'active', role_id: 'role-id', office_id: officeId, role: 'admin',
};

let server;
let baseUrl;
before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

function setup(t, role, handler = async () => ({ rowCount: 0, rows: [] })) {
  t.mock.method(console, 'error', () => {});
  t.mock.method(auth.api, 'getSession', async () => session);
  const calls = [];
  t.mock.method(pool, 'query', async (sql, parameters = []) => {
    if (sql.includes('u.auth_user_id')) return { rowCount: 1, rows: [{ ...mappedUser, role }] };
    calls.push({ sql, parameters });
    return handler(sql, parameters);
  });
  return calls;
}

const request = (method, route, body) =>
  fetch(`${baseUrl}${route}`, {
    method,
    headers: { cookie: 'better-auth.session_token=test', origin: 'http://localhost:5173', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

/** Every statement filters on the office and is sent exactly the values it uses. */
function assertOfficeScoped(calls) {
  assert.ok(calls.length > 0);
  for (const { sql, parameters } of calls) {
    assert.ok(parameters.includes(officeId), `office is a parameter of: ${sql.slice(0, 80)}`);
    assert.match(sql, /office_id = \$\d+/);
    const highest = Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])));
    assert.equal(parameters.length, highest, 'each query is sent exactly the values it uses');
  }
}

/* ───────────── sharing a document ───────────── */

test('a client cannot change who sees a document', async (t) => {
  const calls = setup(t, 'client');
  assert.equal((await request('POST', `/api/documents/${documentId}/sharing`, { shared: true, client_id: clientId })).status, 403);
  assert.equal(calls.length, 0);
});

test('sharing names a client; stopping names none', async (t) => {
  const calls = setup(t, 'admin');
  for (const body of [{ shared: true }, { shared: 'yes', client_id: clientId }, { shared: false, client_id: clientId }, { shared: true, client_id: clientId, access_level: 'restricted' }]) {
    assert.equal((await request('POST', `/api/documents/${documentId}/sharing`, body)).status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
});

test("a document is shared only with a party to its own case, within the office", async (t) => {
  const calls = setup(t, 'admin');
  assert.equal((await request('POST', `/api/documents/${documentId}/sharing`, { shared: true, client_id: clientId })).status, 400);
  assertOfficeScoped(calls);
  assert.match(calls[0].sql, /access_level = 'authorized_users', client_id = \$2::uuid/);
  assert.match(calls[0].sql, /party\.case_id = d\.case_id AND party\.office_id = d\.office_id AND party\.client_id = \$2::uuid/);
});

test('a lawyer shares only documents of their cases that they can already see', async (t) => {
  const calls = setup(t, 'lawyer', async () => ({ rowCount: 1, rows: [{ document_id: documentId, case_id: caseId, client_id: clientId, access_level: 'authorized_users' }] }));
  const response = await request('POST', `/api/documents/${documentId}/sharing`, { shared: true, client_id: clientId });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).document.access_level, 'authorized_users');
  assert.match(calls[0].sql, /d\.access_level IN \('case_team', 'authorized_users'\) OR d\.user_id = \$4/);
  assert.match(calls[0].sql, /mine\.case_id = d\.case_id AND mine\.user_id = \$4/);
  assertOfficeScoped(calls);
});

test('stopping returns a shared document to the case team and clears its client', async (t) => {
  const calls = setup(t, 'assistant', async () => ({ rowCount: 1, rows: [{ document_id: documentId, case_id: caseId, client_id: null, access_level: 'case_team' }] }));
  const response = await request('POST', `/api/documents/${documentId}/sharing`, { shared: false });
  assert.equal(response.status, 200);
  assert.match(calls[0].sql, /access_level = 'case_team', client_id = NULL/);
  assert.match(calls[0].sql, /d\.access_level = 'authorized_users'/);
  assertOfficeScoped(calls);
});

test('stopping a document that is not shared is not found', async (t) => {
  setup(t, 'admin');
  assert.equal((await request('POST', `/api/documents/${documentId}/sharing`, { shared: false })).status, 404);
});

/* ───────────── a client's upcoming hearings ───────────── */

test('only a client has the portal list of upcoming hearings', async (t) => {
  for (const role of ['admin', 'lawyer', 'assistant']) {
    await t.test(role, async (subtest) => {
      const calls = setup(subtest, role);
      assert.equal((await request('GET', '/api/hearings/mine')).status, 403);
      assert.equal(calls.length, 0);
    });
  }
});

test("a client sees only upcoming hearings of their own cases, without outcomes or notes", async (t) => {
  const calls = setup(t, 'client', async () => ({ rowCount: 1, rows: [{ hearing_id: 'h1' }] }));
  const response = await request('GET', '/api/hearings/mine');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).hearings.length, 1);
  const [{ sql, parameters }] = calls;
  assert.match(sql, /own\.user_id = \$1/);
  assert.match(sql, /h\.status = 'scheduled' AND h\.hearing_at >= NOW\(\)/);
  assert.doesNotMatch(sql, /h\.outcome|h\.notes|postponement_reason/);
  assert.deepEqual(parameters, [appUserId, officeId]);
  assertOfficeScoped(calls);
});
