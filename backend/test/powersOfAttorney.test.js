import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';
const storageDirectory = await mkdtemp(path.join(os.tmpdir(), 'smart-law-poa-test-'));
process.env.DOCUMENT_STORAGE_DIR = storageDirectory;

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');

const appUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const clientId = '1cdd115e-0279-48b4-a795-1be1d5a50d0b';
const caseId = 'e4663540-663f-4d4d-b8f2-bfbc6a414d64';
const lawyerId = 'd5a39bb4-f7b6-43a0-bfca-2b16678cc514';
const poaId = 'a1111111-1111-4111-8111-111111111111';
const session = { user: { id: 'auth-user-id' }, session: { id: 'session-id', expiresAt: '2999-01-01T00:00:00.000Z' } };
const mappedUser = {
  user_id: appUserId, auth_user_id: 'auth-user-id', full_name: 'Owner', email: 'owner@example.com',
  email_verified: true, status: 'active', role_id: 'role-id', office_id: officeId, role: 'admin',
};
const POWER_ROW = {
  poa_id: poaId, poa_number: 'POA-1', poa_type: 'litigation', issuing_authority: 'كاتب العدل',
  issued_on: '2026-01-01', expires_on: '2026-12-10', scope: null, status: 'active', revoked_at: null,
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  client_id: clientId, client_name: 'Client', has_scan: false, state: 'active', days_left: 13,
  lawyers: [{ user_id: lawyerId, full_name: 'Lawyer' }], cases: [{ case_id: caseId, case_number: '2026/1', title: 'T' }],
};
const VALID = {
  client_id: clientId, poa_number: 'POA-1', poa_type: 'litigation', issued_on: '2026-01-01',
  expires_on: '2026-12-10', lawyer_ids: [lawyerId], case_ids: [caseId],
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
  await rm(storageDirectory, { recursive: true, force: true });
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

const request = (method, route, body, headers = {}) =>
  fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      cookie: 'better-auth.session_token=test',
      ...(body && !(body instanceof Uint8Array) ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(body ? { body: body instanceof Uint8Array ? body : JSON.stringify(body) } : {}),
  });

/** Every statement filters on the actor's office and is sent exactly the values it uses. */
function assertOfficeScoped(calls) {
  assert.ok(calls.length > 0);
  for (const { sql, parameters } of calls) {
    assert.ok(parameters.includes(officeId), `office is a parameter of: ${sql.slice(0, 80)}`);
    assert.match(sql, /\.office_id = \$\d+/);
    const highest = Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])));
    assert.equal(parameters.length, highest, 'each query is sent exactly the values it uses');
  }
}

test('a client reads their own powers of attorney but cannot record, change or upload one', async (t) => {
  const calls = setup(t, 'client');
  assert.equal((await request('POST', '/api/powers-of-attorney', VALID)).status, 403);
  assert.equal((await request('PATCH', `/api/powers-of-attorney/${poaId}`, { status: 'revoked' })).status, 403);
  assert.equal((await request('PUT', `/api/powers-of-attorney/${poaId}/scan`, new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), { 'content-type': 'application/pdf' })).status, 403);
  assert.equal(calls.length, 0);

  const response = await request('GET', '/api/powers-of-attorney');
  assert.equal(response.status, 200);
  assertOfficeScoped(calls);
  for (const { sql, parameters } of calls) {
    assert.match(sql, /own\.user_id = \$\d+/);
    assert.ok(parameters.includes(appUserId));
  }
});

test("a lawyer or assistant lists only those naming them or their cases' clients, within the office", async (t) => {
  for (const role of ['lawyer', 'assistant']) {
    await t.test(role, async (subtest) => {
      const calls = setup(subtest, role, async (sql) => (sql.includes('COUNT(*)') ? { rowCount: 1, rows: [{ total: 1 }] } : { rowCount: 1, rows: [POWER_ROW] }));
      const response = await request('GET', `/api/powers-of-attorney?clientId=${clientId}&state=expiring`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.powers_of_attorney[0].expiring, true);
      assert.equal(body.pagination.total, 1);
      assertOfficeScoped(calls);
      for (const { sql, parameters } of calls) {
        assert.match(sql, /named\.user_id = \$\d+/);
        assert.match(sql, /mine\.user_id = \$\d+/);
        assert.ok(parameters.includes(appUserId));
        assert.match(sql, /p\.expires_on <= CURRENT_DATE \+ 30/);
      }
    });
  }
});

test("another office's power of attorney is not found", async (t) => {
  const calls = setup(t, 'admin');
  const response = await request('GET', `/api/powers-of-attorney/${poaId}`);
  assert.equal(response.status, 404);
  assert.equal((await request('PATCH', `/api/powers-of-attorney/${poaId}`, { scope: 'x' })).status, 404);
  assert.equal((await request('GET', `/api/powers-of-attorney/${poaId}/scan`)).status, 404);
  assertOfficeScoped(calls);
  for (const { sql } of calls) assert.match(sql, /p\.poa_id = \$1/);
});

test('a power of attorney needs a number, a known type, an issue date and at least one lawyer', async (t) => {
  const calls = setup(t, 'admin');
  const without = (field) => Object.fromEntries(Object.entries(VALID).filter(([key]) => key !== field));
  for (const body of [
    without('poa_number'),
    without('issued_on'),
    without('lawyer_ids'),
    { ...VALID, lawyer_ids: [] },
    { ...VALID, poa_type: 'forever' },
    { ...VALID, issued_on: '2026-02-30' },
    { ...VALID, expires_on: '2025-12-31' },
    { ...VALID, case_ids: ['not-a-uuid'] },
    { ...VALID, office_id: officeId },
  ]) {
    assert.equal((await request('POST', '/api/powers-of-attorney', body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await request('GET', '/api/powers-of-attorney?office=x')).status, 400);
  assert.equal(calls.length, 0);
});

test('the lawyers must be active lawyers of the office and the cases the client\'s own', async (t) => {
  const calls = setup(t, 'admin', async () => ({ rowCount: 1, rows: [{ client_id: clientId, lawyers: 0, cases: 1 }] }));
  assert.equal((await request('POST', '/api/powers-of-attorney', VALID)).status, 400);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /m\.status = 'active'/);
  assert.match(calls[0].sql, /r\.role_name IN \('admin', 'lawyer'\)/);
  assert.match(calls[0].sql, /party\.client_id = c\.client_id/);
  assertOfficeScoped(calls);
});

test('a client of another office is not found when recording a power of attorney', async (t) => {
  const calls = setup(t, 'admin');
  assert.equal((await request('POST', '/api/powers-of-attorney', VALID)).status, 404);
  assert.equal(calls.length, 1);
  assertOfficeScoped(calls);
});

test('a lawyer records a power of attorney only for a client of a case assigned to them', async (t) => {
  const calls = setup(t, 'lawyer');
  assert.equal((await request('POST', '/api/powers-of-attorney', VALID)).status, 404);
  assert.match(calls[0].sql, /mine\.user_id = \$5/);
  assert.equal(calls[0].parameters[4], appUserId);
});

test('recording a power of attorney writes it with its lawyers and cases in one statement', async (t) => {
  const calls = setup(t, 'admin', async (sql) => {
    if (sql.includes('FROM office_memberships m')) return { rowCount: 1, rows: [{ client_id: clientId, lawyers: 1, cases: 1 }] };
    if (sql.includes('WITH created AS')) return { rowCount: 1, rows: [{ poa_id: poaId }] };
    return { rowCount: 1, rows: [POWER_ROW] };
  });
  const response = await request('POST', '/api/powers-of-attorney', VALID);
  assert.equal(response.status, 201);
  const { power_of_attorney: power } = await response.json();
  assert.equal(power.poa_id, poaId);
  assert.deepEqual(power.lawyers.map((entry) => entry.user_id), [lawyerId]);
  const insert = calls.find(({ sql }) => sql.includes('WITH created AS'));
  assert.match(insert.sql, /INSERT INTO power_of_attorney_lawyers/);
  assert.match(insert.sql, /INSERT INTO power_of_attorney_cases/);
  assert.deepEqual(insert.parameters.slice(8, 10), [[lawyerId], [caseId]]);
  assertOfficeScoped(calls);
});

test('a number already used in the office is refused with a clear code', async (t) => {
  setup(t, 'admin', async (sql) => {
    if (sql.includes('FROM office_memberships m')) return { rowCount: 1, rows: [{ client_id: clientId, lawyers: 1, cases: 1 }] };
    const error = new Error('duplicate');
    error.code = '23505';
    throw error;
  });
  const response = await request('POST', '/api/powers-of-attorney', VALID);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'POA_NUMBER_TAKEN');
});

test('an assistant cannot revoke or reactivate a power of attorney', async (t) => {
  const calls = setup(t, 'assistant');
  assert.equal((await request('PATCH', `/api/powers-of-attorney/${poaId}`, { status: 'revoked' })).status, 403);
  assert.equal((await request('PATCH', `/api/powers-of-attorney/${poaId}`, { status: 'expired' })).status, 400);
  assert.equal(calls.length, 0);
});

test('revoking stamps the time, and the update stays inside the office', async (t) => {
  const calls = setup(t, 'admin', async (sql) => {
    if (sql.includes('WITH updated AS')) return { rowCount: 1, rows: [{ poa_id: poaId }] };
    return { rowCount: 1, rows: [POWER_ROW] };
  });
  const response = await request('PATCH', `/api/powers-of-attorney/${poaId}`, { status: 'revoked' });
  assert.equal(response.status, 200);
  const update = calls.find(({ sql }) => sql.includes('WITH updated AS'));
  assert.match(update.sql, /revoked_at = CASE WHEN \$1 = 'revoked'/);
  assert.match(update.sql, /p\.poa_id = \$2 AND p\.office_id = \$3/);
  assertOfficeScoped(calls);
});

test('the scan must really be a PDF, PNG or JPG', async (t) => {
  const calls = setup(t, 'admin', async () => ({ rowCount: 1, rows: [POWER_ROW] }));
  const text = new TextEncoder().encode('not a pdf');
  assert.equal((await request('PUT', `/api/powers-of-attorney/${poaId}/scan`, text, { 'content-type': 'text/plain' })).status, 415);
  assert.equal(calls.length, 0);
  assert.equal((await request('PUT', `/api/powers-of-attorney/${poaId}/scan`, text, { 'content-type': 'application/pdf' })).status, 415);
});

test('a valid scan is stored privately and linked to the power of attorney', async (t) => {
  const calls = setup(t, 'admin', async (sql) => (sql.includes('SET scan_key') ? { rowCount: 1, rows: [{ previous_key: null }] } : { rowCount: 1, rows: [POWER_ROW] }));
  const pdf = new TextEncoder().encode('%PDF-1.4 test');
  const response = await request('PUT', `/api/powers-of-attorney/${poaId}/scan`, pdf, { 'content-type': 'application/pdf' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { poa_id: poaId, has_scan: true });
  const update = calls.find(({ sql }) => sql.includes('SET scan_key'));
  assert.match(update.parameters[0], /^[0-9a-f-]{36}\.pdf$/);
  assertOfficeScoped(calls);
});

test('staff can list the lawyers a power of attorney may name, only from their office; clients cannot', async (t) => {
  const calls = setup(t, 'assistant', async () => ({ rowCount: 1, rows: [{ user_id: lawyerId, full_name: 'Lawyer', role: 'lawyer', email: 'hidden@example.com' }] }));
  const response = await request('GET', '/api/powers-of-attorney/lawyers');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { lawyers: [{ user_id: lawyerId, full_name: 'Lawyer', role: 'lawyer' }] });
  assertOfficeScoped(calls);
  assert.match(calls[0].sql, /m\.status = 'active'/);
});

test('a client cannot list the office lawyers', async (t) => {
  const calls = setup(t, 'client');
  assert.equal((await request('GET', '/api/powers-of-attorney/lawyers')).status, 403);
  assert.equal(calls.length, 0);
});
