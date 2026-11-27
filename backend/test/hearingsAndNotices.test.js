import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';
const storageDirectory = await mkdtemp(path.join(os.tmpdir(), 'smart-law-notices-test-'));
process.env.DOCUMENT_STORAGE_DIR = storageDirectory;

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');

const appUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const caseId = 'e4663540-663f-4d4d-b8f2-bfbc6a414d64';
const lawyerId = 'd5a39bb4-f7b6-43a0-bfca-2b16678cc514';
const hearingId = 'a1111111-1111-4111-8111-111111111111';
const nextHearingId = 'b2222222-2222-4222-8222-222222222222';
const noticeId = 'c3333333-3333-4333-8333-333333333333';
const session = { user: { id: 'auth-user-id' }, session: { id: 'session-id', expiresAt: '2999-01-01T00:00:00.000Z' } };
const mappedUser = {
  user_id: appUserId, auth_user_id: 'auth-user-id', full_name: 'Owner', email: 'owner@example.com',
  email_verified: true, status: 'active', role_id: 'role-id', office_id: officeId, role: 'admin',
};
const HEARING = { hearing_id: hearingId, hearing_at: '2026-11-10T09:00:00.000Z', case_id: caseId, status: 'scheduled', next_hearing_id: null, attendee_ok: true };
const NOTICE = {
  notice_id: noticeId, notice_type: 'summons', recipient: 'Opponent', bailiff_office: 'Nablus', sent_on: '2026-11-01',
  delivery_status: 'pending', delivered_on: null, notes: null, has_attachment: false, created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z', case_id: caseId, case_number: '2026/1', case_title: 'T', created_by_name: 'Owner',
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

/* ───────────── hearings ───────────── */

test('clients have no session log and cannot record hearing outcomes', async (t) => {
  const calls = setup(t, 'client');
  assert.equal((await request('GET', `/api/hearings?caseId=${caseId}`)).status, 403);
  assert.equal((await request('POST', `/api/hearings/${hearingId}/outcome`, { status: 'completed' })).status, 403);
  assert.equal(calls.length, 0);
});

test("a lawyer reads the session log of their own cases only", async (t) => {
  const calls = setup(t, 'lawyer', async (sql) => (sql.includes('FROM hearings h') ? { rowCount: 1, rows: [{ hearing_id: hearingId }] } : { rowCount: 0, rows: [] }));
  const response = await request('GET', `/api/hearings?caseId=${caseId}`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).hearings.length, 1);
  assertOfficeScoped(calls);
  assert.match(calls[0].sql, /mine\.case_id = h\.case_id AND mine\.user_id = \$3/);
  assert.equal(calls[0].parameters[2], appUserId);
});

test("another office's case has no session log", async (t) => {
  const calls = setup(t, 'admin');
  assert.equal((await request('GET', `/api/hearings?caseId=${caseId}`)).status, 404);
  assertOfficeScoped(calls);
  assert.equal((await request('GET', `/api/hearings?caseId=${caseId}&office=x`)).status, 400);
});

test('an outcome is completed, postponed or cancelled, and postponement details apply to a postponement only', async (t) => {
  const calls = setup(t, 'admin');
  for (const body of [
    { status: 'scheduled' },
    { status: 'won' },
    { status: 'completed', postponed_to: '2026-12-01T09:00:00Z' },
    { status: 'cancelled', postponement_reason: 'x' },
    { status: 'postponed', postponed_to: 'next week' },
    { status: 'completed', attended_by_user_id: 'me' },
    { status: 'completed', office_id: officeId },
  ]) {
    assert.equal((await request('POST', `/api/hearings/${hearingId}/outcome`, body)).status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
});

test("a lawyer records outcomes only for hearings of their cases, within the office", async (t) => {
  const calls = setup(t, 'lawyer');
  assert.equal((await request('POST', `/api/hearings/${hearingId}/outcome`, { status: 'completed' })).status, 404);
  assertOfficeScoped(calls);
  assert.match(calls[0].sql, /mine\.user_id = \$4/);
  assert.equal(calls[0].parameters[3], appUserId);
});

test('the attending lawyer must be an active member of the office', async (t) => {
  setup(t, 'admin', async () => ({ rowCount: 1, rows: [{ ...HEARING, attendee_ok: false }] }));
  assert.equal((await request('POST', `/api/hearings/${hearingId}/outcome`, { status: 'completed', attended_by_user_id: lawyerId })).status, 400);
});

test('the next session must come after the postponed one', async (t) => {
  setup(t, 'admin', async () => ({ rowCount: 1, rows: [HEARING] }));
  assert.equal((await request('POST', `/api/hearings/${hearingId}/outcome`, { status: 'postponed', postponed_to: '2026-11-09T09:00:00Z' })).status, 400);
});

test('postponing creates the next hearing of the case and links it, in one statement', async (t) => {
  const calls = setup(t, 'lawyer', async (sql) => {
    if (sql.includes('WITH target AS')) return { rowCount: 1, rows: [{ hearing_id: hearingId, case_id: caseId, status: 'postponed', next_hearing_id: nextHearingId }] };
    return { rowCount: 1, rows: [HEARING] };
  });
  const response = await request('POST', `/api/hearings/${hearingId}/outcome`, {
    status: 'postponed', postponed_to: '2026-12-01T09:00:00Z', postponement_reason: 'غياب الخصم', attended_by_user_id: lawyerId,
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).hearing.next_hearing_id, nextHearingId);
  const write = calls.find(({ sql }) => sql.includes('WITH target AS'));
  assert.match(write.sql, /INSERT INTO hearings/);
  assert.match(write.sql, /FOR UPDATE/);
  assert.deepEqual(write.parameters.slice(0, 2), [hearingId, 'postponed']);
  assert.equal(write.parameters[5], '2026-12-01T09:00:00Z');
  assert.equal(write.parameters[7], appUserId);
  assertOfficeScoped(calls);
});

test('a hearing already postponed to a next session cannot be postponed again or change its outcome', async (t) => {
  setup(t, 'admin', async () => ({ rowCount: 1, rows: [{ ...HEARING, status: 'postponed', next_hearing_id: nextHearingId }] }));
  for (const body of [{ status: 'postponed', postponed_to: '2026-12-01T09:00:00Z' }, { status: 'completed' }]) {
    const response = await request('POST', `/api/hearings/${hearingId}/outcome`, body);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'HEARING_ALREADY_POSTPONED');
  }
});

/* ───────────── court notices ───────────── */

test('clients have no access to court notices', async (t) => {
  const calls = setup(t, 'client');
  assert.equal((await request('GET', '/api/court-notices')).status, 403);
  assert.equal((await request('POST', '/api/court-notices', { case_id: caseId, notice_type: 'summons', sent_on: '2026-11-01' })).status, 403);
  assert.equal(calls.length, 0);
});

test("a lawyer or assistant lists the notices of their cases only, within the office", async (t) => {
  for (const role of ['lawyer', 'assistant']) {
    await t.test(role, async (subtest) => {
      const calls = setup(subtest, role, async (sql) => (sql.includes('COUNT(*)') ? { rowCount: 1, rows: [{ total: 1 }] } : { rowCount: 1, rows: [NOTICE] }));
      const response = await request('GET', `/api/court-notices?caseId=${caseId}&status=pending`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).court_notices[0].notice_id, noticeId);
      assertOfficeScoped(calls);
      for (const { sql, parameters } of calls) {
        assert.match(sql, /mine\.case_id = n\.case_id AND mine\.user_id = \$2/);
        assert.equal(parameters[1], appUserId);
      }
    });
  }
});

test('a notice needs a case, a known type and a sent date; delivery needs a date not before it', async (t) => {
  const calls = setup(t, 'admin');
  const valid = { case_id: caseId, notice_type: 'summons', sent_on: '2026-11-01' };
  for (const body of [
    { ...valid, case_id: undefined },
    { ...valid, notice_type: 'letter' },
    { ...valid, sent_on: '2026-02-30' },
    { ...valid, delivery_status: 'delivered' },
    { ...valid, delivery_status: 'delivered', delivered_on: '2026-10-30' },
    { ...valid, delivery_status: 'pending', delivered_on: '2026-11-02' },
    { ...valid, delivery_status: 'lost', delivered_on: '2026-11-02' },
    { ...valid, office_id: officeId },
  ]) {
    assert.equal((await request('POST', '/api/court-notices', body)).status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
});

test('a notice is recorded only on a case the actor works on, within the office', async (t) => {
  const calls = setup(t, 'assistant');
  assert.equal((await request('POST', '/api/court-notices', { case_id: caseId, notice_type: 'summons', sent_on: '2026-11-01' })).status, 404);
  assertOfficeScoped(calls);
  assert.match(calls[0].sql, /lc\.case_id = \$1/);
  assert.match(calls[0].sql, /mine\.case_id = lc\.case_id AND mine\.user_id = \$11/);
});

test('recording a notice returns it with its case', async (t) => {
  const calls = setup(t, 'admin', async (sql) => (sql.includes('INSERT INTO court_notices') ? { rowCount: 1, rows: [{ notice_id: noticeId }] } : { rowCount: 1, rows: [NOTICE] }));
  const response = await request('POST', '/api/court-notices', { case_id: caseId, notice_type: 'summons', sent_on: '2026-11-01', recipient: 'Opponent' });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).court_notice.case_number, '2026/1');
  assertOfficeScoped(calls);
});

test('marking a notice delivered checks the date against the stored sent date', async (t) => {
  const calls = setup(t, 'lawyer', async () => ({ rowCount: 1, rows: [NOTICE] }));
  assert.equal((await request('PATCH', `/api/court-notices/${noticeId}`, { delivery_status: 'delivered' })).status, 400);
  assert.equal((await request('PATCH', `/api/court-notices/${noticeId}`, { delivery_status: 'delivered', delivered_on: '2026-10-01' })).status, 400);
  const response = await request('PATCH', `/api/court-notices/${noticeId}`, { delivery_status: 'delivered', delivered_on: '2026-11-03' });
  assert.equal(response.status, 200);
  const update = calls.find(({ sql }) => sql.startsWith('UPDATE court_notices'));
  assert.match(update.sql, /n\.notice_id = \$3 AND n\.office_id = \$4/);
  assertOfficeScoped(calls);
});

test("another office's notice is not found, nor its attachment", async (t) => {
  const calls = setup(t, 'admin');
  assert.equal((await request('PATCH', `/api/court-notices/${noticeId}`, { notes: 'x' })).status, 404);
  assert.equal((await request('GET', `/api/court-notices/${noticeId}/attachment`)).status, 404);
  assertOfficeScoped(calls);
});

test('a notice attachment must really be a PDF, PNG or JPG, and is stored privately', async (t) => {
  const calls = setup(t, 'admin', async (sql) => (sql.includes('SET attachment_key') ? { rowCount: 1, rows: [{ previous_key: null }] } : { rowCount: 1, rows: [NOTICE] }));
  const text = new TextEncoder().encode('not a pdf');
  assert.equal((await request('PUT', `/api/court-notices/${noticeId}/attachment`, text, { 'content-type': 'text/plain' })).status, 415);
  assert.equal(calls.length, 0);
  assert.equal((await request('PUT', `/api/court-notices/${noticeId}/attachment`, text, { 'content-type': 'application/pdf' })).status, 415);
  const pdf = new TextEncoder().encode('%PDF-1.4 test');
  const response = await request('PUT', `/api/court-notices/${noticeId}/attachment`, pdf, { 'content-type': 'application/pdf' });
  assert.equal(response.status, 200);
  const update = calls.find(({ sql }) => sql.includes('SET attachment_key'));
  assert.match(update.parameters[0], /^[0-9a-f-]{36}\.pdf$/);
  assertOfficeScoped(calls);
});
