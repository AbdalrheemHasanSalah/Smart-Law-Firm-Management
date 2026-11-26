import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');
const { idsMatch, namesMatch, normalizeName, phonesMatch } = await import('../src/services/conflictService.js');
const { diffValues } = await import('../src/services/auditService.js');

const authUserId = 'auth-user-id';
const appUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const caseId = '1cdd115e-0279-48b4-a795-1be1d5a50d0b';
const clientId = '6f1e8c0a-2b3d-4e5f-8a9b-0c1d2e3f4a5b';
const opponentId = '7a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const session = {
  user: { id: authUserId },
  session: { id: 'session-id', expiresAt: '2999-01-01T00:00:00.000Z' },
};
const caseRecord = {
  case_id: caseId,
  case_number: 'CASE-001',
  title: 'Contract dispute',
  case_type: 'civil',
  status: 'open',
  priority: 'medium',
  opened_at: '2026-01-01T00:00:00.000Z',
  closed_at: null,
  description: null,
  court_id: null,
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
  if (server) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await pool.end();
});

function setupRequest(t, role, databaseHandler = async () => ({ rowCount: 0, rows: [] })) {
  t.mock.method(console, 'error', () => {});
  t.mock.method(auth.api, 'getSession', async () => session);
  const calls = [];
  t.mock.method(pool, 'query', async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    if (sql.includes('u.auth_user_id')) {
      return {
        rowCount: 1,
        rows: [{ user_id: appUserId, auth_user_id: authUserId, full_name: 'Owner', email: 'o@example.com', status: 'active', role_id: 'r', office_id: officeId, role }],
      };
    }
    return databaseHandler(sql, parameters);
  });
  return calls;
}

const request = (method, path, body) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { cookie: 'better-auth.session_token=test-session', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

/* ───────── matching rules ───────── */

test('Arabic names match across hamza, taa marbuta, alif maqsura and diacritics', () => {
  assert.equal(normalizeName('أحمد  عيسى'), normalizeName('احمد عيسي'));
  assert.equal(namesMatch('فاطمة النجّار', 'فاطمه النجار'), true);
  assert.equal(namesMatch('محمود النجار', 'محمود أحمد النجار'), true);
  assert.equal(namesMatch('محمود', 'محمود النجار'), false, 'a single word is too weak to match');
  assert.equal(namesMatch('محمود النجار', 'محمود الخطيب'), false);
});

test('phones match on their last nine digits and IDs exactly', () => {
  assert.equal(phonesMatch('+970 599 120 344', '0599120344'), true);
  assert.equal(phonesMatch('0599120344', '0599120345'), false);
  assert.equal(phonesMatch('123', '123'), false, 'too short to identify anyone');
  assert.equal(idsMatch('401-234-567', '401234567'), true);
  assert.equal(idsMatch('401234567', '401234568'), false);
});

test('audit diffs list only changed fields and treat equal timestamps as unchanged', () => {
  const before = { title: 'A', status: 'open', opened_at: '2026-01-01T00:00:00+00:00' };
  const after = { title: 'A', status: 'closed', opened_at: '2026-01-01T00:00:00.000Z' };
  assert.deepEqual(diffValues(before, after, ['title', 'status', 'opened_at']), { status: { from: 'open', to: 'closed' } });
});

/* ───────── conflict check endpoint ───────── */

test('a new client matching an opposing party is reported as a conflict, inside the office only', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql) => {
    if (sql.includes('FROM clients c')) {
      return { rowCount: 1, rows: [{ id: clientId, name: 'شركة الزيتونة', national_id: null, phone: '092381100', cases: [] }] };
    }
    if (sql.includes('FROM case_opponents o')) {
      return {
        rowCount: 1,
        rows: [{ id: opponentId, name: 'شركة البناء الحديث', national_id: '562001234', phone: null, cases: [{ case_id: caseId, case_number: '2026/114', title: 'X', party_role: 'opponent' }] }],
      };
    }
    return { rowCount: 0, rows: [] };
  });
  const response = await request('GET', `/api/conflicts/check?name=${encodeURIComponent('شركه البناء الحديث')}&national_id=562-001-234`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.conflict, true);
  assert.equal(body.matches.length, 1);
  assert.equal(body.matches[0].source, 'opponent');
  assert.deepEqual(body.matches[0].matched_on.sort(), ['name', 'national_id']);
  for (const call of calls.filter((entry) => !entry.sql.includes('u.auth_user_id'))) {
    assert.ok(call.parameters.includes(officeId), 'every query is limited to the active office');
  }
});

test('the conflict check is for office administrators and needs something to search', async (t) => {
  setupRequest(t, 'lawyer');
  assert.equal((await request('GET', '/api/conflicts/check?name=x')).status, 403);
  t.mock.restoreAll();
  setupRequest(t, 'admin');
  assert.equal((await request('GET', '/api/conflicts/check')).status, 400);
  assert.equal((await request('GET', '/api/conflicts/check?name=a&role=judge')).status, 400);
});

/* ───────── opposing parties ───────── */

test('admin adds an opposing party and receives the conflict check result', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql, parameters) => {
    if (sql.includes('FROM legal_cases lc')) return { rowCount: 1, rows: [caseRecord] };
    if (sql.includes('FROM clients c')) return { rowCount: 1, rows: [{ id: clientId, name: 'هبة صالح', national_id: null, phone: '0568771902', cases: [] }] };
    if (sql.includes('FROM case_opponents o')) return { rowCount: 0, rows: [] };
    if (sql.includes('INSERT INTO case_opponents')) {
      assert.deepEqual(parameters, [officeId, caseId, 'هبه صالح', null, '0568 771 902', null, appUserId]);
      return { rowCount: 1, rows: [{ opponent_id: opponentId, case_id: caseId, full_name: 'هبه صالح', national_id: null, phone: '0568 771 902', notes: null, created_at: '2026-11-25T00:00:00.000Z' }] };
    }
    return { rowCount: 0, rows: [] };
  });
  const response = await request('POST', `/api/cases/${caseId}/opponents`, { full_name: ' هبه صالح ', phone: '0568 771 902' });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.opponent.opponent_id, opponentId);
  assert.equal(body.conflicts.conflict, true, 'the opposing party is already a client of the office');
  assert.ok(calls.some((call) => call.sql.includes('INSERT INTO case_opponents')));
});

test('opposing parties: staff cannot add, bad input is rejected, unknown ones are 404', async (t) => {
  setupRequest(t, 'lawyer');
  assert.equal((await request('POST', `/api/cases/${caseId}/opponents`, { full_name: 'X' })).status, 403);
  t.mock.restoreAll();

  setupRequest(t, 'admin', async (sql) => (sql.includes('FROM legal_cases lc') ? { rowCount: 1, rows: [caseRecord] } : { rowCount: 0, rows: [] }));
  assert.equal((await request('POST', `/api/cases/${caseId}/opponents`, { full_name: '' })).status, 400);
  assert.equal((await request('POST', `/api/cases/${caseId}/opponents`, { full_name: 'X', office_id: officeId })).status, 400);
  assert.equal((await request('DELETE', `/api/cases/${caseId}/opponents/${opponentId}`)).status, 404);
  assert.equal((await request('DELETE', `/api/cases/${caseId}/opponents/not-a-uuid`)).status, 400);
});

/* ───────── activity log ───────── */

test('the activity log is read by the office administrator, scoped to the office and paginated', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql) => {
    if (sql.includes('COUNT(*)')) return { rowCount: 1, rows: [{ total: 1 }] };
    if (sql.includes('FROM audit_logs log')) {
      return { rowCount: 1, rows: [{ audit_log_id: 'a', action: 'case_updated', entity_type: 'case', entity_id: caseId, details: {}, created_at: '2026-11-25T00:00:00.000Z', user_name: 'Owner' }] };
    }
    return { rowCount: 0, rows: [] };
  });
  const response = await request('GET', '/api/audit-logs?entity_type=case&pageSize=10');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.entries.length, 1);
  assert.deepEqual(body.pagination, { page: 1, pageSize: 10, total: 1, totalPages: 1 });
  const logQueries = calls.filter((call) => call.sql.includes('audit_logs'));
  assert.equal(logQueries.length, 2);
  for (const call of logQueries) assert.ok(call.parameters.includes(officeId));

  t.mock.restoreAll();
  setupRequest(t, 'lawyer');
  assert.equal((await request('GET', '/api/audit-logs')).status, 403);
  t.mock.restoreAll();
  setupRequest(t, 'admin');
  assert.equal((await request('GET', '/api/audit-logs?entity_type=secrets')).status, 400);
});
