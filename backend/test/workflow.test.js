import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');
const { addMonths, evenSchedule, installmentState } = await import('../src/services/feeAgreementService.js');
const { mizanUrl } = await import('../src/services/caseStageService.js');

const appUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const caseId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const clientId = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const session = { user: { id: 'auth-user-id' }, session: { id: 'session-id', expiresAt: '2999-01-01T00:00:00.000Z' } };
const mappedUser = {
  user_id: appUserId, auth_user_id: 'auth-user-id', full_name: 'Member', email: 'member@example.com',
  email_verified: true, status: 'active', role_id: 'role-id', office_id: officeId, role: 'lawyer', is_platform_admin: false,
};
const caseRow = { case_id: caseId, case_number: '2026/9', title: 'تعويض', case_type: 'civil', status: 'open', priority: 'medium', opened_at: '2026-01-01T00:00:00.000Z', closed_at: null, description: null, court_id: null };

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
    if (sql.includes('FROM legal_cases lc') && sql.includes('LIMIT 1')) return { rowCount: 1, rows: [caseRow] };
    return handler(sql, parameters);
  });
  return calls;
}

const send = (method, route, body) =>
  fetch(`${baseUrl}/api${route}`, {
    method,
    headers: { cookie: 'better-auth.session_token=test', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

test('an even schedule adds up to the fee exactly, and months keep their day or the month end', () => {
  const schedule = evenSchedule(1000, 3, '2026-01-31', 1);
  assert.deepEqual(schedule.map((entry) => entry.amount), [333.33, 333.33, 333.34]);
  assert.deepEqual(schedule.map((entry) => entry.due_on), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
  const total = evenSchedule(0.05, 4, '2026-01-01').reduce((sum, entry) => sum + Math.round(entry.amount * 100), 0);
  assert.equal(total, 5);
});

test('an installment reads its state from its invoice', () => {
  const day = '2026-06-01';
  assert.equal(installmentState({ invoice_status: 'cancelled', amount: 10, paid: 0, due_on: '2026-01-01' }, day), 'cancelled');
  assert.equal(installmentState({ invoice_status: 'paid', amount: 10, paid: 10, due_on: '2026-01-01' }, day), 'paid');
  assert.equal(installmentState({ invoice_status: 'unpaid', amount: 10, paid: 0, due_on: '2026-05-31' }, day), 'overdue');
  assert.equal(installmentState({ invoice_status: 'partially_paid', amount: 10, paid: 4, due_on: '2026-06-01' }, day), 'partial');
  assert.equal(installmentState({ invoice_status: 'unpaid', amount: 10, paid: 0, due_on: '2026-07-01' }, day), 'due');
});

test('only the admin and lawyers move a case between known stages, and the move is recorded with the office', async (t) => {
  const calls = setup(t, 'lawyer', async (sql) => (sql.includes('INSERT INTO case_stage_history') ? { rowCount: 1, rows: [{ from_stage: 'registration' }] } : { rowCount: 0, rows: [] }));
  assert.equal((await send('PUT', `/cases/${caseId}/stage`, { stage: 'hearings', note: 'قُيّدت' })).status, 200);
  const move = calls.find((call) => call.sql.includes('INSERT INTO case_stage_history'));
  assert.deepEqual(move.parameters, [caseId, officeId, 'hearings', 'قُيّدت', appUserId]);
  assert.match(move.sql, /FOR UPDATE/);
  assert.match(move.sql, /previous\.stage <> \$3/, 'moving to the same stage changes nothing');
  assert.equal((await send('PUT', `/cases/${caseId}/stage`, { stage: 'won' })).status, 400);
  t.mock.restoreAll();
  const assistantCalls = setup(t, 'assistant');
  assert.equal((await send('PUT', `/cases/${caseId}/stage`, { stage: 'judgment' })).status, 403);
  assert.equal((await send('PUT', `/cases/${caseId}/mizan`, { mizan_number: '1' })).status, 403);
  assert.equal(assistantCalls.filter((call) => call.sql.includes('UPDATE legal_cases')).length, 0);
});

test('the Mizan button needs an https address set by the office', () => {
  assert.equal(mizanUrl({}), null);
  assert.equal(mizanUrl({ MIZAN_URL: 'http://not-secure.example' }), null);
  assert.equal(mizanUrl({ MIZAN_URL: 'https://mizan.example/search' }), 'https://mizan.example/search');
});

test('fee agreements are the admin\'s, and their installments must add up to the fee', async (t) => {
  setup(t, 'lawyer');
  assert.equal((await send('GET', `/fee-agreements?caseId=${caseId}`)).status, 403);
  assert.equal((await send('POST', '/fee-agreements', {})).status, 403);
  t.mock.restoreAll();
  const calls = setup(t, 'admin');
  const base = { case_id: caseId, client_id: clientId, currency: 'JOD', total_amount: 100 };
  for (const body of [
    { ...base, installments: [{ due_on: '2026-12-01', amount: 60 }, { due_on: '2027-01-01', amount: 30 }] },
    { ...base, currency: 'EUR', plan: { count: 2, first_due_on: '2026-12-01' } },
    { ...base, plan: { count: 0, first_due_on: '2026-12-01' } },
    { ...base, plan: { count: 2, first_due_on: '2026-02-30' } },
    { ...base, total_amount: 10.555, plan: { count: 2, first_due_on: '2026-12-01' } },
    { ...base, plan: { count: 2, first_due_on: '2026-12-01' }, installments: [] },
  ]) {
    assert.equal((await send('POST', '/fee-agreements', body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await send('POST', '/fee-agreements', { ...base, plan: { count: 2, first_due_on: '2026-12-01' } })).status, 400, 'the client must be a party to the case');
  assert.equal(calls.filter((call) => call.sql.includes('INSERT INTO fee_agreements')).length, 0, 'nothing is recorded for an invalid agreement');
});

test('the briefcase shows a lawyer the client without the office money', async (t) => {
  const calls = setup(t, 'lawyer', async (sql) => {
    if (sql.includes('FROM clients c') && sql.includes('c.client_type')) return { rowCount: 1, rows: [{ client_id: clientId, client_type: 'individual', full_name_or_org: 'سامي' }] };
    return { rowCount: 0, rows: [] };
  });
  const response = await send('GET', `/clients/${clientId}/briefcase`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.money, null);
  assert.equal(calls.filter((call) => /FROM invoices|fee_agreements/.test(call.sql)).length, 0, 'no money is read for a lawyer');
  const cases = calls.find((call) => call.sql.includes('lc.stage'));
  assert.match(cases.sql, /assigned_to a WHERE a\.case_id = lc\.case_id AND a\.user_id = \$3/);
  t.mock.restoreAll();
  setup(t, 'client');
  assert.equal((await send('GET', `/clients/${clientId}/briefcase`)).status, 403);
});
