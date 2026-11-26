import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';

const { manualPaymentMethods } = await import('../src/config/subscription.js');
const { pool } = await import('../src/config/db.js');
const {
  approvePaymentRequest,
  attachReceipt,
  cancelPaymentRequest,
  createPaymentRequest,
  getOfficeSubscription,
  getReceipt,
  listPaymentRequests,
  rejectPaymentRequest,
} = await import('../src/services/subscriptionService.js');
const { detectReceiptType, readReceiptBody } = await import('../src/services/receiptStorage.js');

const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const paymentId = '1cdd115e-0279-48b4-a795-1be1d5a50d0b';
const owner = { user_id: '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a', role: 'admin', office_id: officeId };
const lawyer = { ...owner, role: 'lawyer' };
const platform = { user_id: '6f1e8c0a-2b3d-4e5f-8a9b-0c1d2e3f4a5b', is_platform_admin: true };
const PAYMENT_ENV = {
  PAYMENT_BANK_NAME: 'Bank of Palestine',
  PAYMENT_BANK_ACCOUNT_NAME: 'Qadiyati',
  PAYMENT_BANK_IBAN: 'PS92PALS000000000400123456702',
  PAYMENT_WALLET_NAME: 'PalPay',
  PAYMENT_WALLET_NUMBER: '0599000000',
  PAYMENT_CASH_ADDRESS: 'Ramallah',
  SUBSCRIPTION_MONTHLY_PRICE: '100',
  SUBSCRIPTION_CURRENCY: 'ILS',
};

async function withEnv(values, work) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    return await work();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** A query function that records calls and answers by SQL text. */
function fakeQuery(answer = () => []) {
  const calls = [];
  const query = async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    const result = answer(sql, parameters);
    if (result instanceof Error) throw result;
    const rows = result ?? [];
    return { rowCount: rows.length, rows };
  };
  return { query, calls };
}

const rejects = async (promise, status, code) => {
  await assert.rejects(promise, (error) => error.status === status && (!code || error.publicCode === code));
};

/* ───────── configuration ───────── */

test('a payment method is offered only when its details are configured', () => {
  assert.deepEqual(manualPaymentMethods({}), []);
  const methods = manualPaymentMethods(PAYMENT_ENV);
  assert.deepEqual(methods.map((entry) => entry.method), ['bank_transfer', 'wallet', 'cash']);
  assert.equal(methods[0].details.account, PAYMENT_ENV.PAYMENT_BANK_IBAN);
  assert.equal(methods[1].details.wallet_name, 'PalPay');
  assert.deepEqual(manualPaymentMethods({ PAYMENT_WALLET_NUMBER: ' 0599 ' }).map((entry) => entry.method), ['wallet']);
});

test('the office page lists the methods and the request waiting for review', async () => {
  await withEnv(PAYMENT_ENV, async () => {
    const { query } = fakeQuery((sql) => {
      if (sql.includes('FROM law_offices')) return [{ subscription_ends_at: null }];
      if (sql.includes('FROM subscription_payments')) {
        return [
          { payment_id: paymentId, amount: '300.00', method: 'bank_transfer', status: 'pending' },
          { payment_id: 'old', amount: '100.00', method: 'online', status: 'pending' },
        ];
      }
      return [];
    });
    const page = await getOfficeSubscription(owner, { query });
    assert.deepEqual(page.payment_methods.map((entry) => entry.method), ['bank_transfer', 'wallet', 'cash']);
    // No lawyers counted (the fake returns none): priced as one; the year carries the discount.
    assert.equal(page.plan.lawyers, 1);
    assert.deepEqual(page.prices.map((price) => [price.months, price.amount, price.discount_percent]), [[1, 100, 0], [3, 300, 0], [6, 600, 0], [12, 1020, 15]]);
    assert.equal(page.prices[3].full_amount, 1200);
    assert.equal(page.pending_request.payment_id, paymentId, 'an unfinished card checkout is not a request under review');
  });
});

/* ───────── the office's request ───────── */

test('a request is priced per lawyer and period, needs a reference for transfers, and only the owner sends it', async () => {
  await withEnv(PAYMENT_ENV, async () => {
    const { query, calls } = fakeQuery((sql) => {
      if (sql.includes('FROM law_offices')) return [{ status: 'active' }];
      if (sql.includes('FROM office_memberships m')) return [{ lawyers: 3 }];
      if (sql.includes('INSERT INTO subscription_payments')) return [{ payment_id: paymentId, amount: '900.00', status: 'pending' }];
      return [];
    });
    await rejects(createPaymentRequest(lawyer, { months: 3, method: 'bank_transfer', reference: 'X' }, { query }), 403);
    await rejects(createPaymentRequest(owner, { months: 3, method: 'bank_transfer' }, { query }), 400);
    await rejects(createPaymentRequest(owner, { months: 3, method: 'cheque', reference: 'X' }, { query }), 400);
    await rejects(createPaymentRequest(owner, { months: 13, method: 'cash' }, { query }), 400);
    await rejects(createPaymentRequest(owner, { months: 2, method: 'cash' }, { query }), 400, 'VALIDATION');
    await rejects(createPaymentRequest(owner, { months: 1, method: 'cash', amount: 1 }, { query }), 400);
    await rejects(createPaymentRequest(owner, { months: 1, method: 'cash', lawyers: 1 }, { query }), 400);
    assert.equal(calls.length, 0, 'nothing is written for an invalid request');

    // 3 lawyers × 3 months × 100.
    const { request } = await createPaymentRequest(owner, { months: 3, method: 'bank_transfer', reference: ' TRX-1 ', note: 'from the office account' }, { query });
    assert.equal(request.amount, 900);
    let insert = calls.findLast((call) => call.sql.includes('INSERT INTO subscription_payments'));
    assert.deepEqual(insert.parameters, [officeId, 900, 'ILS', 3, 'bank_transfer', 'TRX-1', 'from the office account', owner.user_id, 3]);
    assert.match(insert.sql, /'pending'/);
    const count = calls.find((call) => call.sql.includes('FROM office_memberships m'));
    assert.match(count.sql, /role_name IN \('admin', 'lawyer'\)/, 'the owner and lawyers are counted, assistants are not');
    assert.match(count.sql, /m\.status = 'active'/);

    // A year: 3 × 12 × 100 = 3600, less 15% = 3060.
    await createPaymentRequest(owner, { months: 12, method: 'cash' }, { query });
    insert = calls.findLast((call) => call.sql.includes('INSERT INTO subscription_payments'));
    assert.equal(insert.parameters[1], 3060);
  });
});

test('an office is charged for at least one lawyer', async () => {
  await withEnv(PAYMENT_ENV, async () => {
    const { query, calls } = fakeQuery((sql) => {
      if (sql.includes('FROM law_offices')) return [{ status: 'active' }];
      if (sql.includes('FROM office_memberships m')) return [{ lawyers: 0 }];
      return [{ payment_id: paymentId, amount: '100.00' }];
    });
    await createPaymentRequest(owner, { months: 1, method: 'cash' }, { query });
    const insert = calls.findLast((call) => call.sql.includes('INSERT INTO subscription_payments'));
    assert.equal(insert.parameters[1], 100);
    assert.equal(insert.parameters.at(-1), 1);
  });
});

test('a second open request is refused, and an office that is not approved cannot pay', async () => {
  await withEnv(PAYMENT_ENV, async () => {
    const duplicate = Object.assign(new Error('duplicate'), { code: '23505', constraint: 'subscription_payments_one_open_request' });
    let { query } = fakeQuery((sql) => {
      if (sql.includes('FROM law_offices')) return [{ status: 'active' }];
      if (sql.includes('FROM office_memberships m')) return [{ lawyers: 1 }];
      return duplicate;
    });
    await rejects(createPaymentRequest(owner, { months: 1, method: 'cash' }, { query }), 409, 'PAYMENT_REQUEST_OPEN');
    ({ query } = fakeQuery((sql) => (sql.includes('FROM law_offices') ? [{ status: 'pending' }] : [])));
    await rejects(createPaymentRequest(owner, { months: 1, method: 'cash' }, { query }), 409);
  });
});

test('receipts are recognised by their bytes and limited in size', async () => {
  assert.equal(detectReceiptType(Buffer.from('%PDF-1.7 …'))?.mime, 'application/pdf');
  assert.equal(detectReceiptType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.mime, 'image/png');
  assert.equal(detectReceiptType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mime, 'image/jpeg');
  assert.equal(detectReceiptType(Buffer.from('<svg onload=alert(1)>')), null);

  const tooBig = Object.assign(Readable.from([Buffer.alloc(10)]), { headers: { 'content-length': String(6 * 1024 * 1024) } });
  await rejects(readReceiptBody(tooBig), 413);
  const empty = Object.assign(Readable.from([]), { headers: {} });
  await rejects(readReceiptBody(empty), 400);
});

test('a receipt must be an allowed type and belong to the office’s own waiting request', async () => {
  const { query, calls } = fakeQuery(() => []);
  const request = (type) => Object.assign(Readable.from([Buffer.from('x')]), { headers: { 'content-type': type } });
  await rejects(attachReceipt(owner, paymentId, request('image/svg+xml'), { query }), 415);
  assert.equal(calls.length, 0);
  await rejects(attachReceipt(owner, paymentId, request('image/png'), { query }), 404, 'NOT_FOUND');
  assert.deepEqual(calls[0].parameters.slice(0, 2), [paymentId, officeId]);
  await rejects(attachReceipt(owner, 'nope', request('image/png'), { query }), 400);
});

test('the office can withdraw only its own waiting request', async () => {
  let { query, calls } = fakeQuery(() => []);
  await rejects(cancelPaymentRequest(owner, paymentId, { query }), 404);
  ({ query, calls } = fakeQuery((sql) => (sql.startsWith('SELECT') ? [{ payment_id: paymentId }] : [])));
  assert.deepEqual(await cancelPaymentRequest(owner, paymentId, { query }), { payment_id: paymentId, status: 'cancelled' });
  const update = calls.find((call) => call.sql.includes("status = 'cancelled'"));
  assert.deepEqual(update.parameters, [paymentId, officeId]);
});

test('a receipt is read by its office or by the platform owner, and not by other offices', async () => {
  const { query, calls } = fakeQuery(() => []);
  await rejects(getReceipt(owner, paymentId, { query }), 404);
  assert.deepEqual(calls[0].parameters, [paymentId, officeId], 'an office reads only its own receipts');
  await rejects(getReceipt(lawyer, paymentId, { query }), 403);
  await rejects(getReceipt(platform, paymentId, { query }), 404);
  assert.deepEqual(calls[1].parameters, [paymentId]);
});

/* ───────── the platform owner's review ───────── */

test('only the platform owner lists, approves and rejects requests', async () => {
  const { query } = fakeQuery(() => []);
  await rejects(listPaymentRequests(owner, { query }), 403);
  await rejects(approvePaymentRequest(owner, paymentId), 403);
  await rejects(rejectPaymentRequest(owner, paymentId, { note: 'x' }, { query }), 403);
  const listed = await listPaymentRequests(platform, { query });
  assert.deepEqual(listed, { requests: [] });
});

test('approving extends the subscription by the requested months, once', async (t) => {
  const calls = [];
  let status = 'pending';
  const client = {
    query: async (sql, parameters = []) => {
      calls.push({ sql, parameters });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rowCount: 0, rows: [] };
      if (sql.includes('FROM subscription_payments')) {
        return { rowCount: 1, rows: [{ payment_id: paymentId, office_id: officeId, months: 3, amount: '300.00', method: 'wallet', status }] };
      }
      if (sql.includes('FOR UPDATE') && sql.includes('law_offices')) return { rowCount: 1, rows: [{ status: 'active', period_start: '2026-12-25T00:00:00.000Z' }] };
      if (sql.includes('UPDATE law_offices')) return { rowCount: 1, rows: [{ subscription_ends_at: '2027-03-25T00:00:00.000Z' }] };
      return { rowCount: 1, rows: [] };
    },
    release: () => {},
  };
  t.mock.method(pool, 'connect', async () => client);

  const result = await approvePaymentRequest(platform, paymentId);
  assert.deepEqual(result, { office_id: officeId, subscription_ends_at: '2027-03-25T00:00:00.000Z' });
  const extend = calls.find((call) => call.sql.includes('UPDATE law_offices'));
  assert.deepEqual(extend.parameters, [officeId, '2026-12-25T00:00:00.000Z', 3]);
  const paid = calls.find((call) => call.sql.includes("status = 'paid'"));
  assert.equal(paid.parameters[3], platform.user_id, 'the reviewer is recorded');
  assert.ok(calls.some((call) => call.sql.includes('subscription_request_approved')));

  status = 'paid';
  await rejects(approvePaymentRequest(platform, paymentId), 409, 'PAYMENT_REQUEST_REVIEWED');
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
});

test('rejecting needs a reason and changes only a waiting request', async () => {
  let { query, calls } = fakeQuery(() => []);
  await rejects(rejectPaymentRequest(platform, paymentId, {}, { query }), 400);
  await rejects(rejectPaymentRequest(platform, paymentId, { note: '   ' }, { query }), 400);
  await rejects(rejectPaymentRequest(platform, paymentId, { note: 'x', months: 1 }, { query }), 400);
  assert.equal(calls.length, 0);
  await rejects(rejectPaymentRequest(platform, paymentId, { note: 'Reference not found' }, { query }), 404);

  ({ query, calls } = fakeQuery((sql) => (sql.startsWith('UPDATE') ? [{ office_id: officeId }] : [])));
  const result = await rejectPaymentRequest(platform, paymentId, { note: ' Reference not found ' }, { query });
  assert.deepEqual(result, { office_id: officeId, note: 'Reference not found' });
  assert.match(calls[0].sql, /status = 'pending'/);
  assert.ok(calls.some((call) => call.sql.includes('subscription_request_rejected')));
});
