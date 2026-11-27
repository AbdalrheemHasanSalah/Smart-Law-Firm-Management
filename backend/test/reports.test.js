import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');
const { compile } = await import('../src/services/reportService.js');

const appUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const lawyerId = 'd5a39bb4-f7b6-43a0-bfca-2b16678cc514';
const session = { user: { id: 'auth-user-id' }, session: { id: 'session-id', expiresAt: '2999-01-01T00:00:00.000Z' } };
const mappedUser = {
  user_id: appUserId, auth_user_id: 'auth-user-id', full_name: 'Owner', email: 'owner@example.com',
  email_verified: true, status: 'active', role_id: 'role-id', office_id: officeId, role: 'admin',
};
const RANGE = 'from=2026-01-01&to=2026-12-31';

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

const request = (route) => fetch(`${baseUrl}${route}`, { headers: { cookie: 'better-auth.session_token=test' } });

/** Every statement filters on the office and is sent exactly the values it uses, numbered in order. */
function assertWellFormed(calls) {
  assert.ok(calls.length > 0);
  for (const { sql, parameters } of calls) {
    assert.ok(parameters.includes(officeId), `office is a parameter of: ${sql.slice(0, 80)}`);
    const used = [...new Set([...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])))].sort((a, b) => a - b);
    assert.deepEqual(used, used.map((_, index) => index + 1), 'placeholders are $1…$n with no gaps');
    assert.equal(parameters.length, used.length, 'each query is sent exactly the values it uses');
    assert.doesNotMatch(sql, /:(from|to|now|office|member)\b/, 'no named value left uncompiled');
  }
}

test('named values become numbered placeholders for only those used', () => {
  const { text, parameters } = compile('a = :office AND b < :to::date AND c = :office', { from: 'f', to: 't', office: 'o' });
  assert.equal(text, 'a = $1 AND b < $2::date AND c = $1');
  assert.deepEqual(parameters, ['o', 't']);
});

test('clients have no reports, and the period must be valid', async (t) => {
  const calls = setup(t, 'client');
  assert.equal((await request(`/api/reports?${RANGE}`)).status, 403);
  assert.equal(calls.length, 0);
  t.mock.restoreAll();
  const adminCalls = setup(t, 'admin');
  for (const query of ['', 'from=2026-01-01', 'from=2026-12-31&to=2026-01-01', `${RANGE}&office=x`, `${RANGE}&userId=me`]) {
    assert.equal((await request(`/api/reports?${query}`)).status, 400, query);
  }
  assert.equal(adminCalls.length, 0);
});

test("a lawyer sees their own cases and tasks, no money, and cannot open someone else's report", async (t) => {
  for (const role of ['lawyer', 'assistant']) {
    await t.test(role, async (subtest) => {
      const calls = setup(subtest, role);
      assert.equal((await request(`/api/reports?${RANGE}&userId=${lawyerId}`)).status, 403);
      assert.equal(calls.length, 0);
      const response = await request(`/api/reports?${RANGE}`);
      assert.equal(response.status, 200);
      const report = await response.json();
      assert.equal(report.scope, 'member');
      assert.equal(report.finance, null);
      assert.equal(report.cases.per_lawyer, null);
      assertWellFormed(calls);
      assert.equal(calls.some(({ sql }) => /FROM (invoices|payments|office_expenses)/.test(sql)), false, 'no money is read');
      for (const { sql, parameters } of calls) {
        assert.ok(parameters.includes(appUserId));
        assert.match(sql, /mine\.user_id = \$\d+|t\.assigned_to_user_id = \$\d+/);
      }
    });
  }
});

test("the administrator's view of one member hides that member's private tasks and the office's money", async (t) => {
  const calls = setup(t, 'admin');
  const response = await request(`/api/reports?${RANGE}&userId=${lawyerId}`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).finance, null);
  assertWellFormed(calls);
  for (const { sql } of calls.filter(({ sql }) => sql.includes('FROM tasks t'))) {
    assert.match(sql, /NOT t\.is_private/);
    assert.doesNotMatch(sql, /t\.created_by_user_id/);
  }
});

test('the whole-office report adds money: billed and collected, balances by age, debtors and profit', async (t) => {
  const calls = setup(t, 'admin', async (sql) => {
    if (sql.includes('SUM(i.amount) AS billed')) return { rows: [{ currency: 'ILS', billed: '5000' }] };
    if (sql.includes('SUM(p.amount) AS collected FROM payments')) return { rows: [{ currency: 'ILS', collected: '3000' }] };
    if (sql.includes('AS days_late')) {
      return {
        rows: [
          { invoice_id: 'i1', invoice_number: 'A', currency: 'ILS', client_id: 'c1', client_name: 'One', remaining: '1000', days_late: 0 },
          { invoice_id: 'i2', invoice_number: 'B', currency: 'ILS', client_id: 'c1', client_name: 'One', remaining: '400', days_late: 45 },
          { invoice_id: 'i3', invoice_number: 'C', currency: 'ILS', client_id: 'c2', client_name: 'Two', remaining: '250', days_late: 120 },
          { invoice_id: 'i4', invoice_number: 'D', currency: 'ILS', client_id: 'c2', client_name: 'Two', remaining: '0', days_late: 10 },
        ],
      };
    }
    if (sql.includes("lc.status AS key")) return { rows: [{ key: 'open', count: 3 }, { key: 'closed', count: 1 }] };
    if (sql.includes('AS opened')) return { rows: [{ opened: 2, closed: 1 }] };
    return { rows: [] };
  });
  const response = await request(`/api/reports?${RANGE}`);
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.scope, 'office');
  assert.deepEqual(report.cases.by_status, { open: 3, closed: 1 });
  assert.equal(report.cases.opened, 2);
  assert.deepEqual(report.finance.billed_vs_collected, [{ currency: 'ILS', billed: 5000, collected: 3000 }]);
  assert.deepEqual(report.finance.aging, [{ currency: 'ILS', current: 1000, d1_30: 0, d31_60: 400, d61_90: 0, d90_plus: 250, total: 1650 }]);
  assert.deepEqual(report.finance.debtors.map((debtor) => [debtor.client_name, debtor.outstanding, debtor.invoices]), [['One', 1400, 2], ['Two', 250, 1]]);
  assertWellFormed(calls);
  // Private tasks stay their writer's, even in the administrator's whole-office view.
  for (const { sql, parameters } of calls.filter(({ sql }) => sql.includes('FROM tasks t'))) {
    assert.match(sql, /NOT t\.is_private OR t\.created_by_user_id = \$\d+/);
    assert.ok(parameters.includes(appUserId));
  }
});
