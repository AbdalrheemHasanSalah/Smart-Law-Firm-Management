import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');
const { leaveDays } = await import('../src/services/hrService.js');

const appUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const staffId = 'd5a39bb4-f7b6-43a0-bfca-2b16678cc514';
const accountId = 'a1111111-1111-4111-8111-111111111111';
const payslipId = 'b2222222-2222-4222-8222-222222222222';
const leaveId = 'c3333333-3333-4333-8333-333333333333';
const session = { user: { id: 'auth-user-id' }, session: { id: 'session-id', expiresAt: '2999-01-01T00:00:00.000Z' } };
const mappedUser = {
  user_id: appUserId, auth_user_id: 'auth-user-id', full_name: 'Owner', email: 'owner@example.com',
  email_verified: true, status: 'active', role_id: 'role-id', office_id: officeId, role: 'admin',
};
const PAYSLIP = {
  payslip_id: payslipId, user_id: staffId, full_name: 'Lawyer', period: '2026-11', salary: '3000', advance_deduction: '500',
  other_deductions: '0', deduction_note: null, net: '2500', currency: 'ILS', status: 'draft', paid_on: null,
  account_id: null, account_name: null, advances_owed: '800',
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
    headers: { cookie: 'better-auth.session_token=test', ...(body ? { 'content-type': 'application/json' } : {}) },
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

test('leave days skip Fridays', () => {
  // 2026-11-26 is a Thursday, 2026-11-27 a Friday.
  assert.equal(leaveDays('2026-11-26', '2026-11-28'), 2);
  assert.equal(leaveDays('2026-11-27', '2026-11-27'), 0);
  assert.equal(leaveDays('2026-11-01', '2026-11-30'), 26);
});

test('only the office administrator handles staff records, advances and payroll', async (t) => {
  for (const role of ['lawyer', 'assistant', 'client']) {
    await t.test(role, async (subtest) => {
      const calls = setup(subtest, role);
      assert.equal((await request('GET', '/api/hr/staff')).status, 403);
      assert.equal((await request('PUT', `/api/hr/staff/${staffId}`, { monthly_salary: 1 })).status, 403);
      assert.equal((await request('POST', '/api/hr/advances', { user_id: staffId, amount: 100, account_id: accountId, given_on: '2026-11-01' })).status, 403);
      assert.equal((await request('POST', '/api/hr/payroll', { period: '2026-11' })).status, 403);
      assert.equal((await request('POST', `/api/hr/payslips/${payslipId}/pay`, { account_id: accountId, paid_on: '2026-11-30' })).status, 403);
      assert.equal((await request('POST', `/api/hr/leave/${leaveId}/decision`, { status: 'approved' })).status, 403);
      assert.equal(calls.length, 0);
    });
  }
});

test('a staff member sees only their own advances, paid payslips and leave', async (t) => {
  const calls = setup(t, 'lawyer');
  assert.equal((await request('GET', `/api/hr/advances?userId=${staffId}`)).status, 403);
  assert.equal((await request('GET', '/api/hr/payslips')).status, 200);
  assert.equal((await request('GET', '/api/hr/leave')).status, 200);
  assertOfficeScoped(calls);
  assert.match(calls[0].sql, /p\.user_id = \$2 AND p\.status = 'paid'/);
  assert.match(calls[1].sql, /l\.user_id = \$2/);
  for (const { parameters } of calls) assert.equal(parameters[1], appUserId);
});

test('a staff record belongs to a staff member of the office, with sane values', async (t) => {
  const calls = setup(t, 'admin');
  for (const body of [
    { salary_currency: 'EUR' },
    { annual_leave_days: 61 },
    { annual_leave_days: 1.5 },
    { monthly_salary: -1 },
    { hire_date: '2026-02-30' },
    { office_id: officeId },
  ]) {
    assert.equal((await request('PUT', `/api/hr/staff/${staffId}`, body)).status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
  assert.equal((await request('PUT', `/api/hr/staff/${staffId}`, { monthly_salary: 3000, salary_currency: 'USD' })).status, 400);
  assert.match(calls[0].sql, /r\.role_name IN \('admin', 'lawyer', 'assistant'\)/);
  assert.match(calls[0].sql, /old\.salary_currency <> \$7/);
  assertOfficeScoped(calls);
});

test('an advance is paid from an open account in the salary currency, as a salaries expense, in one statement', async (t) => {
  const calls = setup(t, 'admin', async (sql) => (sql.includes('INSERT INTO salary_advances') ? { rowCount: 1, rows: [{ advance_id: 'x' }] } : { rowCount: 0, rows: [] }));
  const response = await request('POST', '/api/hr/advances', { user_id: staffId, amount: 500, account_id: accountId, given_on: '2026-11-05' });
  assert.equal(response.status, 201);
  const [insert] = calls;
  assert.match(insert.sql, /INSERT INTO office_expenses/);
  assert.match(insert.sql, /'salaries'/);
  assert.match(insert.sql, /a\.currency = person\.salary_currency/);
  assert.match(insert.sql, /a\.is_active/);
  assertOfficeScoped(calls);
});

test("the month's payroll proposes taking back what is owed, up to the salary, once per person", async (t) => {
  const calls = setup(t, 'admin', async (sql) => (sql.startsWith('INSERT INTO payslips') ? { rowCount: 2, rows: [] } : { rowCount: 0, rows: [] }));
  assert.equal((await request('POST', '/api/hr/payroll', { period: '2026-13' })).status, 400);
  const response = await request('POST', '/api/hr/payroll', { period: '2026-11' });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).created, 2);
  const insert = calls.find(({ sql }) => sql.startsWith('INSERT INTO payslips'));
  assert.match(insert.sql, /LEAST\(sp\.monthly_salary, GREATEST\(/);
  assert.match(insert.sql, /ON CONFLICT \(office_id, user_id, period\) DO NOTHING/);
  assert.match(insert.sql, /m\.status = 'active'/);
  assertOfficeScoped(calls);
});

test('a draft cannot deduct more than is owed or than the salary, and a paid payslip never changes', async (t) => {
  setup(t, 'admin', async () => ({ rowCount: 1, rows: [PAYSLIP] }));
  assert.equal((await request('PATCH', `/api/hr/payslips/${payslipId}`, { advance_deduction: 900 })).status, 400);
  assert.equal((await request('PATCH', `/api/hr/payslips/${payslipId}`, { other_deductions: 2600 })).status, 400);
  t.mock.restoreAll();
  setup(t, 'admin', async () => ({ rowCount: 1, rows: [{ ...PAYSLIP, status: 'paid' }] }));
  const response = await request('PATCH', `/api/hr/payslips/${payslipId}`, { other_deductions: 10 });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'PAYSLIP_PAID');
  assert.equal((await request('POST', `/api/hr/payslips/${payslipId}/pay`, { account_id: accountId, paid_on: '2026-11-30' })).status, 409);
});

test('paying a payslip records its net as a salaries expense under a row lock, checking the account and what is owed', async (t) => {
  const calls = setup(t, 'admin', async (sql) => (sql.includes('WITH slip AS') ? { rowCount: 1, rows: [{ payslip_id: payslipId }] } : { rowCount: 1, rows: [PAYSLIP] }));
  assert.equal((await request('POST', `/api/hr/payslips/${payslipId}/pay`, { paid_on: '2026-11-30' })).status, 400);
  const response = await request('POST', `/api/hr/payslips/${payslipId}/pay`, { account_id: accountId, paid_on: '2026-11-30' });
  assert.equal(response.status, 200);
  const pay = calls.find(({ sql }) => sql.includes('WITH slip AS'));
  assert.match(pay.sql, /FOR UPDATE/);
  assert.match(pay.sql, /a\.currency = slip\.currency/);
  assert.match(pay.sql, /slip\.advance_deduction <=/);
  assert.match(pay.sql, /'salaries', ready\.net/);
  assertOfficeScoped(calls);
});

test('a leave request covers working days, fits the annual balance and does not overlap', async (t) => {
  const calls = setup(t, 'lawyer', async () => ({ rowCount: 1, rows: [{ overlaps: false, entitlement: 14, taken: 12 }] }));
  for (const body of [
    { leave_type: 'holiday', starts_on: '2026-12-01', ends_on: '2026-12-02' },
    { leave_type: 'annual', starts_on: '2026-12-03', ends_on: '2026-12-01' },
    { leave_type: 'annual', starts_on: '2026-11-27', ends_on: '2026-11-27' },
  ]) {
    assert.equal((await request('POST', '/api/hr/leave', body)).status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
  const tooLong = await request('POST', '/api/hr/leave', { leave_type: 'annual', starts_on: '2026-12-01', ends_on: '2026-12-03' });
  assert.equal(tooLong.status, 409);
  assert.equal((await tooLong.json()).code, 'LEAVE_BALANCE');
  const sick = await request('POST', '/api/hr/leave', { leave_type: 'sick', starts_on: '2026-12-01', ends_on: '2026-12-03' });
  assert.equal(sick.status, 201);
  assert.equal((await sick.json()).days, 3);
  const insert = calls.find(({ sql }) => sql.startsWith('INSERT INTO leave_requests'));
  assert.deepEqual(insert.parameters.slice(0, 5), [appUserId, 'sick', '2026-12-01', '2026-12-03', 3]);
  // The request is filed in the actor's own office, taken from the session.
  assert.equal(insert.parameters[6], officeId);
  assertOfficeScoped(calls.filter((call) => call !== insert));
});

test('overlapping leave is refused', async (t) => {
  setup(t, 'assistant', async () => ({ rowCount: 1, rows: [{ overlaps: true, entitlement: 14, taken: 0 }] }));
  const response = await request('POST', '/api/hr/leave', { leave_type: 'annual', starts_on: '2026-12-01', ends_on: '2026-12-02' });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'LEAVE_OVERLAP');
});

test('only a pending request is decided, and only inside the office', async (t) => {
  const calls = setup(t, 'admin');
  assert.equal((await request('POST', `/api/hr/leave/${leaveId}/decision`, { status: 'maybe' })).status, 400);
  const response = await request('POST', `/api/hr/leave/${leaveId}/decision`, { status: 'approved' });
  assert.equal(response.status, 409);
  assert.match(calls[0].sql, /l\.status = 'pending'/);
  assertOfficeScoped(calls);
});

test("a staff member withdraws only their own pending request", async (t) => {
  const calls = setup(t, 'lawyer');
  assert.equal((await request('POST', `/api/hr/leave/${leaveId}/cancel`)).status, 409);
  assert.match(calls[0].sql, /l\.status = 'pending' AND l\.user_id = \$3/);
  assert.equal(calls[0].parameters[2], appUserId);
  assertOfficeScoped(calls);
});
