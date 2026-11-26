import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');

const authUserId = 'auth-user-id';
const appUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const clientId = '6f1e8c0a-2b3d-4e5f-8a9b-0c1d2e3f4a5b';
const caseId = '1cdd115e-0279-48b4-a795-1be1d5a50d0b';
const invoiceId = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const session = { user: { id: authUserId }, session: { id: 'session-id', expiresAt: '2999-01-01T00:00:00.000Z' } };
const invoiceRow = {
  invoice_id: invoiceId,
  invoice_number: '2026-0001',
  category: 'legal_fees',
  description: 'Fees',
  amount: '5000.00',
  currency: 'ILS',
  status: 'partially_paid',
  state: 'partially_paid',
  issued_at: '2026-11-01T00:00:00.000Z',
  due_at: null,
  client_id: clientId,
  case_id: caseId,
  client_name: 'Client',
  case_number: 'CASE-1',
  paid_amount: '2000.00',
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
        rows: [{ user_id: appUserId, auth_user_id: authUserId, full_name: 'User', email: 'u@example.com', status: 'active', role_id: 'r', office_id: officeId, role }],
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

const businessCalls = (calls) => calls.filter((call) => !call.sql.includes('u.auth_user_id'));

test('only the office administrator bills, records payments, cancels and reads statements', async (t) => {
  for (const role of ['lawyer', 'assistant', 'client']) {
    setupRequest(t, role);
    assert.equal((await request('POST', '/api/finance/invoices', { client_id: clientId, category: 'legal_fees', amount: 1 })).status, 403, role);
    assert.equal((await request('POST', `/api/finance/invoices/${invoiceId}/payments`, { amount: 1, method: 'cash' })).status, 403, role);
    assert.equal((await request('POST', `/api/finance/invoices/${invoiceId}/cancel`)).status, 403, role);
    assert.equal((await request('GET', '/api/finance/summary')).status, 403, role);
    assert.equal((await request('GET', `/api/finance/statements/${clientId}`)).status, 403, role);
    t.mock.restoreAll();
  }
  setupRequest(t, 'admin');
  assert.equal((await request('GET', '/api/finance/statement')).status, 403, 'the portal statement is for clients');
});

test('invoices are validated before any query', async (t) => {
  const calls = setupRequest(t, 'admin');
  const valid = { client_id: clientId, category: 'legal_fees', amount: 100, currency: 'ILS' };
  for (const body of [
    { ...valid, category: 'gifts' },
    { ...valid, currency: 'EUR' },
    { ...valid, amount: 0 },
    { ...valid, amount: -5 },
    { ...valid, amount: 10.555 },
    { ...valid, amount: 'abc' },
    { ...valid, client_id: 'nope' },
    { ...valid, due_at: 'not a date' },
    { ...valid, office_id: officeId },
  ]) {
    assert.equal((await request('POST', '/api/finance/invoices', body)).status, 400, JSON.stringify(body));
  }
  assert.equal(businessCalls(calls).length, 0);
});

test('a new invoice is numbered, scoped to the office and to a client party to the case', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql) => {
    if (sql.includes('INSERT INTO invoices')) return { rowCount: 1, rows: [{ invoice_id: invoiceId }] };
    if (sql.includes('FROM invoices i')) return { rowCount: 1, rows: [{ ...invoiceRow, status: 'unpaid', state: 'unpaid', paid_amount: '0' }] };
    return { rowCount: 0, rows: [] };
  });
  const response = await request('POST', '/api/finance/invoices', { client_id: clientId, case_id: caseId, category: 'legal_fees', amount: 5000, description: ' Fees ' });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.invoice.remaining, 5000);
  const insert = calls.find((call) => call.sql.includes('INSERT INTO invoices'));
  assert.match(insert.sql, /FROM involves party/);
  assert.deepEqual(insert.parameters, [clientId, caseId, officeId, 5000, 'ILS', 'legal_fees', 'Fees', null, appUserId]);
});

test('an invoice for an unknown client, or a client not in the case, is 404', async (t) => {
  setupRequest(t, 'admin');
  assert.equal((await request('POST', '/api/finance/invoices', { client_id: clientId, case_id: caseId, category: 'court_fees', amount: 10 })).status, 404);
});

test('payments: validated, checked against what remains, and refused on a closed invoice', async (t) => {
  let outcome = { payment_id: null, status: null, previous_status: 'partially_paid', invoice_amount: '5000.00', paid_before: '2000.00' };
  const calls = setupRequest(t, 'admin', async (sql) => {
    if (sql.includes('INSERT INTO payments')) return { rowCount: 1, rows: [outcome] };
    if (sql.includes('FROM invoices i')) return { rowCount: 1, rows: [{ ...invoiceRow, status: 'paid', state: 'paid', paid_amount: '5000.00' }] };
    return { rowCount: 0, rows: [] };
  });
  const path = `/api/finance/invoices/${invoiceId}/payments`;
  for (const body of [{ amount: 1, method: 'bitcoin' }, { amount: 0, method: 'cash' }, { amount: 1, method: 'cash', paid_at: '2999-01-01' }, { amount: 1, method: 'cash', note: 'x' }]) {
    assert.equal((await request('POST', path, body)).status, 400, JSON.stringify(body));
  }

  let response = await request('POST', path, { amount: 3500, method: 'cash' });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /3000/);

  outcome = { ...outcome, previous_status: 'cancelled' };
  assert.equal((await request('POST', path, { amount: 1, method: 'cash' })).status, 409);

  outcome = { payment_id: 'p-1', status: 'paid', previous_status: 'partially_paid', invoice_amount: '5000.00', paid_before: '2000.00' };
  response = await request('POST', path, { amount: 3000, method: 'bank_transfer', reference: 'TRX-1' });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.invoice.state, 'paid');
  assert.equal(body.invoice.remaining, 0);
  const payment = calls.filter((call) => call.sql.includes('INSERT INTO payments')).at(-1);
  assert.match(payment.sql, /FOR UPDATE/);
  assert.deepEqual(payment.parameters.slice(0, 3), [invoiceId, officeId, 3000]);

  outcome = { payment_id: null, status: null, previous_status: null, invoice_amount: null, paid_before: null };
  assert.equal((await request('POST', path, { amount: 1, method: 'cash' })).status, 404);
});

test('staff list only the invoices of cases assigned to them', async (t) => {
  const calls = setupRequest(t, 'lawyer', async (sql) => {
    if (sql.includes('COUNT(*)')) return { rowCount: 1, rows: [{ total: 1 }] };
    return { rowCount: 1, rows: [invoiceRow] };
  });
  const response = await request('GET', `/api/finance/invoices?case_id=${caseId}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.invoices[0].remaining, 3000);
  for (const call of businessCalls(calls)) {
    assert.match(call.sql, /assigned_to/);
    assert.ok(call.parameters.includes(officeId) && call.parameters.includes(appUserId));
  }
  t.mock.restoreAll();
  setupRequest(t, 'lawyer');
  assert.equal((await request('GET', '/api/finance/invoices?state=lost')).status, 400);
});

test('a client reads only their own statement, totalled per currency without mixing', async (t) => {
  const calls = setupRequest(t, 'client', async (sql) => {
    if (sql.includes('c.user_id = $1')) return { rowCount: 1, rows: [{ client_id: clientId }] };
    if (sql.includes('JOIN law_offices office')) return { rowCount: 1, rows: [{ client_id: clientId, full_name_or_org: 'Client', office_name: 'Office' }] };
    // The invoice query also sums payments (in a LATERAL subquery), so it is matched first.
    if (sql.includes('LEFT JOIN LATERAL')) {
      return {
        rowCount: 2,
        rows: [invoiceRow, { ...invoiceRow, invoice_id: 'x', invoice_number: '2026-0002', category: 'expenses', amount: '100.50', currency: 'JOD', status: 'unpaid', state: 'unpaid', paid_amount: '0' }],
      };
    }
    if (sql.includes('FROM payments p')) return { rowCount: 1, rows: [{ payment_id: 'p', amount: '2000.00', method: 'cash', invoice_number: '2026-0001', currency: 'ILS' }] };
    return { rowCount: 0, rows: [] };
  });
  const response = await request('GET', '/api/finance/statement');
  assert.equal(response.status, 200);
  const { statement } = await response.json();
  assert.deepEqual(statement.currencies, [
    { currency: 'ILS', legal_fees: 5000, court_fees: 0, expenses: 0, billed: 5000, paid: 2000, balance: 3000 },
    { currency: 'JOD', legal_fees: 0, court_fees: 0, expenses: 100.5, billed: 100.5, paid: 0, balance: 100.5 },
  ]);
  const lookup = calls.find((call) => call.sql.includes('c.user_id = $1'));
  assert.deepEqual(lookup.parameters, [appUserId, officeId]);
  for (const call of businessCalls(calls)) assert.ok(call.parameters.includes(officeId));
});
