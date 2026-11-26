import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');

const appUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const caseId = 'e4663540-663f-4d4d-b8f2-bfbc6a414d64';
const clientId = '1cdd115e-0279-48b4-a795-1be1d5a50d0b';
const lawyerId = 'd5a39bb4-f7b6-43a0-bfca-2b16678cc514';
const hearingId = 'a1111111-1111-4111-8111-111111111111';
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

const request = (method, path, body) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { cookie: 'better-auth.session_token=test', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

test('clients have no calendar, and only the office administrator schedules', async (t) => {
  for (const role of ['lawyer', 'assistant', 'client']) {
    await t.test(role, async (subtest) => {
      const calls = setup(subtest, role);
      assert.equal((await request('POST', '/api/calendar/hearings', { case_id: caseId, hearing_at: '2026-11-10T09:00:00Z', hearing_type: 'مرافعة' })).status, 403);
      assert.equal((await request('POST', '/api/calendar/appointments', { client_id: clientId, user_id: lawyerId, starts_at: '2026-11-05T08:00:00Z', ends_at: '2026-11-05T09:00:00Z', purpose: 'x' })).status, 403);
      assert.equal((await request('PATCH', `/api/calendar/hearings/${hearingId}`, { status: 'completed' })).status, 403);
      if (role === 'client') assert.equal((await request('GET', '/api/calendar?from=2026-11-01&to=2026-11-30')).status, 403);
      assert.equal(calls.length, 0);
    });
  }
});

test("a lawyer's calendar holds only their cases' hearings, their appointments and their tasks, and no claims", async (t) => {
  for (const role of ['lawyer', 'assistant']) {
    await t.test(role, async (subtest) => {
      const calls = setup(subtest, role, async () => ({ rows: [] }));
      const response = await request('GET', '/api/calendar?from=2026-11-01&to=2026-11-30');
      assert.equal(response.status, 200);
      assert.equal(calls.length, 3);
      assert.equal(calls.some(({ sql }) => sql.includes('FROM invoices')), false);
      for (const { parameters } of calls) assert.deepEqual(parameters.slice(2), [officeId, appUserId]);
      const sqlOf = (table) => calls.find(({ sql }) => sql.includes(`FROM ${table}`)).sql;
      assert.match(sqlOf('hearings h'), /mine\.case_id = h\.case_id AND mine\.user_id = \$4/);
      assert.match(sqlOf('appointments a'), /a\.user_id = \$4 OR/);
      assert.match(sqlOf('tasks t'), /t\.assigned_to_user_id = \$4/);
      assert.match(sqlOf('tasks t'), /NOT t\.is_private OR t\.created_by_user_id = \$4/);
    });
  }
});

test('the calendar merges hearings, appointments, task deadlines and claims due, in time order, within the office', async (t) => {
  const calls = setup(t, 'admin', async (sql) => {
    if (sql.includes('FROM hearings h')) return { rows: [{ id: hearingId, at: '2026-11-10T09:00:00.000Z', hearing_type: 'مرافعة', status: 'scheduled', case_id: caseId, case_number: '2026/1' }] };
    if (sql.includes('FROM appointments a')) return { rows: [{ id: 'b2', at: '2026-11-05T08:00:00.000Z', ends_at: '2026-11-05T09:00:00.000Z', purpose: 'استشارة', status: 'scheduled', client_name: 'Client' }] };
    if (sql.includes('FROM tasks t')) return { rows: [{ id: 'c3', at: '2026-11-07T12:00:00.000Z', title: 'Draft', status: 'pending', priority: 'high' }] };
    if (sql.includes('FROM invoices i')) return { rows: [{ id: 'd4', at: '2026-11-20T00:00:00.000Z', invoice_number: 'INV-1', amount: '100.00', currency: 'ILS', status: 'unpaid' }] };
    return { rows: [] };
  });
  const response = await request('GET', '/api/calendar?from=2026-11-01&to=2026-11-30');
  assert.equal(response.status, 200);
  const { events } = await response.json();
  assert.deepEqual(events.map((event) => event.kind), ['appointment', 'task', 'hearing', 'invoice']);
  assert.equal(events[3].details.amount, 100);
  assert.equal(calls.length, 4);
  for (const { sql, parameters } of calls) {
    assert.match(sql, /\.office_id = \$3/);
    assert.equal(parameters[2], officeId);
    // PostgreSQL rejects a statement given more values than it uses.
    const highest = Math.max(...[...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])));
    assert.equal(parameters.length, highest, 'each query is sent exactly the values it uses');
  }
  assert.match(calls.find(({ sql }) => sql.includes('FROM tasks t')).sql, /NOT t\.is_private/);
  assert.match(calls.find(({ sql }) => sql.includes('FROM invoices i')).sql, /'unpaid', 'partially_paid'/);
});

test('the calendar range must be valid dates at most two months apart', async (t) => {
  const calls = setup(t, 'admin');
  for (const path of [
    '/api/calendar',
    '/api/calendar?from=2026-11-01',
    '/api/calendar?from=2026-11-30&to=2026-11-01',
    '/api/calendar?from=2026-01-01&to=2026-12-31',
    '/api/calendar?from=2026-11-01&to=2026-11-30&office=x',
  ]) {
    assert.equal((await request('GET', path)).status, 400, path);
  }
  assert.equal(calls.length, 0);
});

test('a hearing is scheduled only on a case of the office', async (t) => {
  const calls = setup(t, 'admin', async () => ({ rowCount: 0, rows: [] }));
  const response = await request('POST', '/api/calendar/hearings', { case_id: caseId, hearing_at: '2026-11-10T09:00:00Z', hearing_type: 'مرافعة' });
  assert.equal(response.status, 404);
  assert.match(calls[0].sql, /lc\.case_id = \$1 AND lc\.office_id = \$2/);
  assert.deepEqual(calls[0].parameters.slice(0, 2), [caseId, officeId]);
});

test('hearings need a case, a time and a type, and change only to known statuses', async (t) => {
  const calls = setup(t, 'admin');
  assert.equal((await request('POST', '/api/calendar/hearings', { hearing_at: '2026-11-10T09:00:00Z', hearing_type: 'x' })).status, 400);
  assert.equal((await request('POST', '/api/calendar/hearings', { case_id: caseId, hearing_at: 'tomorrow', hearing_type: 'x' })).status, 400);
  assert.equal((await request('POST', '/api/calendar/hearings', { case_id: caseId, hearing_at: '2026-11-10T09:00:00Z' })).status, 400);
  assert.equal((await request('PATCH', `/api/calendar/hearings/${hearingId}`, { status: 'won' })).status, 400);
  assert.equal(calls.length, 0);
});

test('an appointment ties a client, an active staff member and an optional case of the same office', async (t) => {
  const calls = setup(t, 'admin', async () => ({ rowCount: 1, rows: [{ appointment_id: 'e5' }] }));
  const response = await request('POST', '/api/calendar/appointments', {
    client_id: clientId, user_id: lawyerId, starts_at: '2026-11-05T08:00:00Z', ends_at: '2026-11-05T09:00:00Z', purpose: 'استشارة',
  });
  assert.equal(response.status, 201);
  assert.match(calls[0].sql, /membership\.status = 'active'/);
  assert.match(calls[0].sql, /\$3::uuid IS NULL OR lc\.case_id IS NOT NULL/);
  assert.deepEqual(calls[0].parameters.slice(0, 4), [clientId, lawyerId, null, officeId]);
});

test('an appointment must end after it starts', async (t) => {
  const calls = setup(t, 'admin');
  const response = await request('POST', '/api/calendar/appointments', {
    client_id: clientId, user_id: lawyerId, starts_at: '2026-11-05T09:00:00Z', ends_at: '2026-11-05T08:00:00Z', purpose: 'x',
  });
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});
