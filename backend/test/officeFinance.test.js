import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';
const storageDirectory = await mkdtemp(path.join(os.tmpdir(), 'smart-law-finance-test-'));
process.env.DOCUMENT_STORAGE_DIR = storageDirectory;

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');

const appUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const accountId = 'a1111111-1111-4111-8111-111111111111';
const otherAccountId = 'b2222222-2222-4222-8222-222222222222';
const custodyId = 'c3333333-3333-4333-8333-333333333333';
const expenseId = 'd4444444-4444-4444-8444-444444444444';
const caseId = 'e4663540-663f-4d4d-b8f2-bfbc6a414d64';
const invoiceId = 'f5555555-5555-4555-8555-555555555555';
const holderId = 'd5a39bb4-f7b6-43a0-bfca-2b16678cc514';
const session = { user: { id: 'auth-user-id' }, session: { id: 'session-id', expiresAt: '2999-01-01T00:00:00.000Z' } };
const mappedUser = {
  user_id: appUserId, auth_user_id: 'auth-user-id', full_name: 'Owner', email: 'owner@example.com',
  email_verified: true, status: 'active', role_id: 'role-id', office_id: officeId, role: 'admin',
};
const ACCOUNT = { account_id: accountId, name: 'الصندوق', account_type: 'cash', currency: 'ILS', opening_balance: '1000.00', opened_on: '2026-01-01', is_active: true, created_at: '2026-01-01T00:00:00Z', balance: '1500.00' };
const CUSTODY = {
  custody_id: custodyId, holder_user_id: appUserId, holder_name: 'Lawyer', account_id: accountId, account_name: 'الصندوق',
  amount: '500.00', currency: 'ILS', issued_on: '2026-11-01', purpose: null, status: 'open', settled_on: null,
  returned_amount: null, return_account_id: null, created_at: '2026-11-01T00:00:00Z', spent: '420.00',
};
const EXPENSE = {
  expense_id: expenseId, category: 'transport', amount: '30.00', currency: 'ILS', spent_on: '2026-11-02', payee: 'Taxi', description: null,
  account_id: null, account_name: null, custody_id: custodyId, custody_holder_name: 'Lawyer', case_id: null, case_number: null,
  has_receipt: false, status: 'active', created_at: '2026-11-02T00:00:00Z', created_by_name: 'Lawyer', created_by_user_id: appUserId, custody_status: 'open',
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
    assert.match(sql, /office_id = \$\d+/);
    const highest = Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])));
    assert.equal(parameters.length, highest, 'each query is sent exactly the values it uses');
  }
}

/* ───────────── accounts, transfers, profitability ───────────── */

test('only the office administrator handles accounts, transfers and profitability', async (t) => {
  for (const role of ['lawyer', 'assistant', 'client']) {
    await t.test(role, async (subtest) => {
      const calls = setup(subtest, role);
      assert.equal((await request('GET', '/api/finance/accounts')).status, 403);
      assert.equal((await request('POST', '/api/finance/accounts', { name: 'x', account_type: 'cash', currency: 'ILS' })).status, 403);
      assert.equal((await request('GET', `/api/finance/accounts/${accountId}/ledger?from=2026-01-01&to=2026-12-31`)).status, 403);
      assert.equal((await request('POST', '/api/finance/transfers', { from_account_id: accountId, to_account_id: otherAccountId, amount: 1, transferred_on: '2026-11-01' })).status, 403);
      assert.equal((await request('GET', '/api/finance/profitability?from=2026-01-01&to=2026-12-31')).status, 403);
      assert.equal((await request('POST', '/api/finance/custodies', { holder_user_id: holderId, account_id: accountId, amount: 100, issued_on: '2026-11-01' })).status, 403);
      assert.equal(calls.length, 0);
    });
  }
});

test('an account has a name, a known type and currency, and an amount with at most two decimals', async (t) => {
  const calls = setup(t, 'admin');
  for (const body of [
    { account_type: 'cash', currency: 'ILS' },
    { name: 'x', account_type: 'safe', currency: 'ILS' },
    { name: 'x', account_type: 'cash', currency: 'EUR' },
    { name: 'x', account_type: 'cash', currency: 'ILS', opening_balance: 10.555 },
    { name: 'x', account_type: 'cash', currency: 'ILS', office_id: officeId },
  ]) {
    assert.equal((await request('POST', '/api/finance/accounts', body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await request('PATCH', `/api/finance/accounts/${accountId}`, { currency: 'USD' })).status, 400);
  assert.equal(calls.length, 0);
});

test('balances come from what moved money, within the office', async (t) => {
  const calls = setup(t, 'admin', async () => ({ rowCount: 1, rows: [ACCOUNT] }));
  const response = await request('GET', '/api/finance/accounts');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).accounts[0].balance, 1500);
  assertOfficeScoped(calls);
  for (const table of ['FROM payments p', 'FROM office_expenses e', 'FROM custodies cu', 'FROM account_transfers t']) {
    assert.ok(calls[0].sql.includes(table), table);
  }
  assert.match(calls[0].sql, /e\.status = 'active'/);
  assert.match(calls[0].sql, /p\.status = 'completed'/);
});

test('a ledger shows the balance before the range and after every movement in it', async (t) => {
  const calls = setup(t, 'admin', async (sql) => {
    if (sql.includes('FROM finance_accounts a WHERE a.account_id')) return { rowCount: 1, rows: [ACCOUNT] };
    return {
      rowCount: 4,
      rows: [
        { kind: 'payment', id: '1', on_date: '2026-10-05', amount: '300.00', reference: 'INV-1', party: 'Client', category: null },
        { kind: 'expense', id: '2', on_date: '2026-11-02', amount: '-50.00', reference: null, party: 'Taxi', category: 'transport' },
        { kind: 'transfer_in', id: '3', on_date: '2026-11-20', amount: '250.00', reference: null, party: 'Bank', category: null },
        { kind: 'expense', id: '4', on_date: '2026-12-15', amount: '-10.00', reference: null, party: 'X', category: 'other' },
      ],
    };
  });
  const response = await request('GET', `/api/finance/accounts/${accountId}/ledger?from=2026-11-01&to=2026-11-30`);
  assert.equal(response.status, 200);
  const ledger = await response.json();
  assert.equal(ledger.balance_before, 1300);
  assert.deepEqual(ledger.entries.map((entry) => entry.balance_after), [1250, 1500]);
  assert.equal(ledger.balance_after, 1500);
  assert.equal(calls[1].parameters[0], accountId);
  assert.equal((await request('GET', `/api/finance/accounts/${accountId}/ledger?from=2026-12-01&to=2026-11-01`)).status, 400);
});

test('a transfer needs two open accounts of the office in the same currency', async (t) => {
  const calls = setup(t, 'admin');
  assert.equal((await request('POST', '/api/finance/transfers', { from_account_id: accountId, to_account_id: accountId, amount: 10, transferred_on: '2026-11-01' })).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await request('POST', '/api/finance/transfers', { from_account_id: accountId, to_account_id: otherAccountId, amount: 10, transferred_on: '2026-11-01' })).status, 400);
  assert.match(calls[0].sql, /target\.currency = source\.currency/);
  assert.match(calls[0].sql, /target\.office_id = source\.office_id/);
  assert.match(calls[0].sql, /source\.is_active/);
  assertOfficeScoped(calls);
});

test('profit is what clients paid minus what the office spent, per currency, never across currencies', async (t) => {
  const calls = setup(t, 'admin', async (sql) => {
    if (sql.includes('WITH paid AS')) return { rows: [{ case_id: caseId, case_number: '2026/1', title: 'T', currency: 'ILS', collected: '900', spent: '100' }] };
    if (sql.includes('FROM payments p')) return { rows: [{ month: '2026-10', currency: 'ILS', total: '1000' }, { month: '2026-10', currency: 'USD', total: '200' }] };
    return { rows: [{ month: '2026-10', currency: 'ILS', category: 'rent', total: '600' }, { month: '2026-11', currency: 'ILS', category: 'transport', total: '50.5' }] };
  });
  const response = await request('GET', '/api/finance/profitability?from=2026-01-01&to=2026-12-31');
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.deepEqual(report.totals, [
    { currency: 'ILS', collected: 1000, spent: 650.5, net: 349.5 },
    { currency: 'USD', collected: 200, spent: 0, net: 200 },
  ]);
  assert.equal(report.months.length, 3);
  assert.equal(report.by_category[0].category, 'rent');
  assert.equal(report.cases[0].net, 800);
  assertOfficeScoped(calls);
  for (const { parameters } of calls) assert.deepEqual(parameters, ['2026-01-01', '2026-12-31', officeId]);
});

test("another office's case has no profitability", async (t) => {
  const calls = setup(t, 'admin');
  assert.equal((await request('GET', `/api/finance/cases/${caseId}/profitability`)).status, 404);
  assertOfficeScoped(calls);
});

/* ───────────── custodies and expenses ───────────── */

test('a lawyer cannot pay from an office account, but records spending from their own custody', async (t) => {
  const calls = setup(t, 'lawyer', async (sql) => {
    if (sql.includes('INSERT INTO office_expenses')) return { rowCount: 1, rows: [{ expense_id: expenseId }] };
    if (sql.includes('FROM office_expenses e')) return { rowCount: 1, rows: [EXPENSE] };
    return { rowCount: 1, rows: [CUSTODY] };
  });
  assert.equal((await request('POST', '/api/finance/expenses', { category: 'transport', amount: 30, spent_on: '2026-11-02', account_id: accountId })).status, 403);
  assert.equal(calls.length, 0);
  const response = await request('POST', '/api/finance/expenses', { category: 'transport', amount: 30, spent_on: '2026-11-02', custody_id: custodyId, payee: 'Taxi' });
  assert.equal(response.status, 201);
  const insert = calls.find(({ sql }) => sql.includes('INSERT INTO office_expenses'));
  assert.match(insert.sql, /FOR UPDATE/);
  assert.match(insert.sql, /cu\.holder_user_id = \$7/);
  assert.match(insert.sql, /source\.left_over >= \$2/);
  assertOfficeScoped(calls);
});

test('an expense comes from exactly one source and a known category', async (t) => {
  const calls = setup(t, 'admin');
  for (const body of [
    { category: 'rent', amount: 100, spent_on: '2026-11-01' },
    { category: 'rent', amount: 100, spent_on: '2026-11-01', account_id: accountId, custody_id: custodyId },
    { category: 'party', amount: 100, spent_on: '2026-11-01', account_id: accountId },
    { category: 'rent', amount: -5, spent_on: '2026-11-01', account_id: accountId },
  ]) {
    assert.equal((await request('POST', '/api/finance/expenses', body)).status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
});

test('a custody cannot be overspent', async (t) => {
  setup(t, 'lawyer', async (sql) => (sql.includes('INSERT INTO office_expenses') ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [CUSTODY] }));
  const response = await request('POST', '/api/finance/expenses', { category: 'transport', amount: 100, spent_on: '2026-11-02', custody_id: custodyId });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'CUSTODY_INSUFFICIENT');
});

test('nothing is spent from, or cancelled in, a settled custody', async (t) => {
  setup(t, 'lawyer', async (sql) => {
    if (sql.includes('FROM office_expenses e')) return { rowCount: 1, rows: [{ ...EXPENSE, custody_status: 'settled' }] };
    return { rowCount: 1, rows: [{ ...CUSTODY, status: 'settled', settled_on: '2026-11-10', returned_amount: '80.00' }] };
  });
  const spend = await request('POST', '/api/finance/expenses', { category: 'transport', amount: 10, spent_on: '2026-11-02', custody_id: custodyId });
  assert.equal(spend.status, 409);
  assert.equal((await spend.json()).code, 'CUSTODY_SETTLED');
  const cancel = await request('POST', `/api/finance/expenses/${expenseId}/cancel`);
  assert.equal(cancel.status, 409);
});

test('a lawyer sees only the custodies they hold and the expenses paid from them', async (t) => {
  const calls = setup(t, 'assistant', async (sql) => (sql.includes('COUNT(*)') ? { rowCount: 1, rows: [{ total: 0 }] } : { rowCount: 0, rows: [] }));
  assert.equal((await request('GET', '/api/finance/custodies')).status, 200);
  assert.equal((await request('GET', '/api/finance/expenses')).status, 200);
  assertOfficeScoped(calls);
  for (const { sql, parameters } of calls) {
    assert.match(sql, /cu\.holder_user_id = \$2/);
    assert.equal(parameters[1], appUserId);
  }
});

test('settling a custody with cash left needs an account to return it to', async (t) => {
  const calls = setup(t, 'admin', async () => ({ rowCount: 1, rows: [CUSTODY] }));
  assert.equal((await request('POST', `/api/finance/custodies/${custodyId}/settle`, { settled_on: '2026-11-10' })).status, 400);
  assert.equal((await request('POST', `/api/finance/custodies/${custodyId}/settle`, { settled_on: '2026-10-01', return_account_id: accountId })).status, 400);
  const response = await request('POST', `/api/finance/custodies/${custodyId}/settle`, { settled_on: '2026-11-10', return_account_id: accountId });
  assert.equal(response.status, 200);
  const update = calls.find(({ sql }) => sql.includes('UPDATE custodies'));
  assert.match(update.sql, /FOR UPDATE/);
  assert.match(update.sql, /back\.currency = remainder\.currency/);
  assertOfficeScoped(calls);
});

test('a custody goes to an active staff member from an open account', async (t) => {
  const calls = setup(t, 'admin');
  const response = await request('POST', '/api/finance/custodies', { holder_user_id: holderId, account_id: accountId, amount: 500, issued_on: '2026-11-01' });
  assert.equal(response.status, 400);
  assert.match(calls[0].sql, /member\.status = 'active'/);
  assert.match(calls[0].sql, /r\.role_name IN \('admin', 'lawyer', 'assistant'\)/);
  assert.match(calls[0].sql, /a\.is_active/);
  assertOfficeScoped(calls);
});

test('an expense receipt must really be a PDF, PNG or JPG', async (t) => {
  const calls = setup(t, 'admin', async () => ({ rowCount: 1, rows: [EXPENSE] }));
  const textBody = new TextEncoder().encode('not a receipt');
  assert.equal((await request('PUT', `/api/finance/expenses/${expenseId}/receipt`, textBody, { 'content-type': 'text/plain' })).status, 415);
  assert.equal(calls.length, 0);
  assert.equal((await request('PUT', `/api/finance/expenses/${expenseId}/receipt`, textBody, { 'content-type': 'image/png' })).status, 415);
});

/* ───────────── client payments into an account ───────────── */

test('a client payment may name an open account of the office in the invoice currency', async (t) => {
  const calls = setup(t, 'admin', async (sql) => (sql.includes('FROM finance_accounts a') ? { rowCount: 0, rows: [] } : { rowCount: 0, rows: [] }));
  const response = await request('POST', `/api/finance/invoices/${invoiceId}/payments`, { amount: 100, method: 'cash', account_id: accountId });
  assert.equal(response.status, 400);
  assert.match(calls[0].sql, /i\.currency = a\.currency/);
  assert.match(calls[0].sql, /a\.is_active/);
  assert.deepEqual(calls[0].parameters, [invoiceId, officeId, accountId]);
});

test('the payment is recorded into the named account', async (t) => {
  const calls = setup(t, 'admin', async (sql) => {
    if (sql.includes('FROM finance_accounts a')) return { rowCount: 1, rows: [{}] };
    if (sql.includes('INSERT INTO payments')) return { rowCount: 1, rows: [{ payment_id: 'p1', status: 'paid', previous_status: 'unpaid', invoice_amount: '100', paid_before: '0' }] };
    return { rowCount: 1, rows: [{ invoice_id: invoiceId, invoice_number: 'INV-1', amount: '100', currency: 'ILS', status: 'paid', paid_total: '100', client_id: holderId, case_id: null }] };
  });
  const response = await request('POST', `/api/finance/invoices/${invoiceId}/payments`, { amount: 100, method: 'cash', account_id: accountId });
  assert.equal(response.status, 201);
  const insert = calls.find(({ sql }) => sql.includes('INSERT INTO payments'));
  assert.match(insert.sql, /account_id\)/);
  assert.equal(insert.parameters[7], accountId);
});
