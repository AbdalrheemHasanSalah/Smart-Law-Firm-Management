import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';

const { getSubscriptionConfig, isSubscriptionLocked, subscriptionSummary } = await import('../src/config/subscription.js');
const { pool } = await import('../src/config/db.js');
const {
  applyStripeEvent,
  createCheckout,
  getOfficeSubscription,
  listSubscriptions,
  recordManualPayment,
  sendSubscriptionReminders,
  verifyStripeSignature,
} = await import('../src/services/subscriptionService.js');
const { requireRole } = await import('../src/middleware/auth.js');
const { notify } = await import('../src/services/notificationService.js');

const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const paymentId = '1cdd115e-0279-48b4-a795-1be1d5a50d0b';
const platformAdmin = { user_id: '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a', is_platform_admin: true };
const officeAdmin = { user_id: '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a', role: 'admin', office_id: officeId, email: 'owner@office.ps' };
const now = new Date('2026-06-15T12:00:00.000Z');
const day = 86_400_000;

/** Runs `work` with STRIPE / subscription variables set, then restores the environment. */
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

/** A fake transaction client: `answer(sql)` returns the rows for each statement. */
function mockTransaction(t, answer) {
  const calls = [];
  const client = {
    query: async (sql, parameters = []) => {
      calls.push({ sql, parameters });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rowCount: 0, rows: [] };
      const rows = answer(sql) ?? [];
      return { rowCount: rows.length, rows };
    },
    release: () => {},
  };
  t.mock.method(pool, 'connect', async () => client);
  return calls;
}

/* ───────────── the state rule ───────────── */

test('an end date becomes active, grace, expired or none', () => {
  const at = (offsetDays) => new Date(now.getTime() + offsetDays * day).toISOString();
  assert.equal(subscriptionSummary(at(10), { now, graceDays: 7 }).state, 'active');
  assert.equal(subscriptionSummary(at(10), { now, graceDays: 7 }).days_left, 10);
  const grace = subscriptionSummary(at(-2), { now, graceDays: 7 });
  assert.equal(grace.state, 'grace');
  assert.equal(grace.days_left, 5);
  assert.equal(subscriptionSummary(at(-8), { now, graceDays: 7 }).state, 'expired');
  assert.equal(subscriptionSummary(null, { now }).state, 'none');
  assert.equal(subscriptionSummary(undefined, { now }).state, 'none');
  assert.equal(isSubscriptionLocked(null), false, 'offices without a tracked subscription are not locked');
});

test('settings have safe defaults and reject nonsense', () => {
  const config = getSubscriptionConfig({});
  assert.equal(config.monthlyPrice, 100);
  assert.equal(config.currency, 'ILS');
  assert.equal(config.graceDays, 7);
  assert.equal(config.onlinePaymentsEnabled, false);
  assert.equal(getSubscriptionConfig({ STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh' }).onlinePaymentsEnabled, true);
  assert.throws(() => getSubscriptionConfig({ SUBSCRIPTION_MONTHLY_PRICE: '-5' }));
  assert.throws(() => getSubscriptionConfig({ SUBSCRIPTION_CURRENCY: 'shekel' }));
});

/* ───────────── the lock ───────────── */

function runRole(user, options) {
  let status = 200;
  let body = null;
  let passed = false;
  const response = { status: (code) => ((status = code), { json: (value) => (body = value) }) };
  requireRole('admin', options)({ user }, response, () => (passed = true));
  return { status, body, passed };
}

test('a lapsed office is locked everywhere except routes that allow it', () => {
  const lapsed = { ...officeAdmin, subscription_ends_at: new Date(Date.now() - 30 * day).toISOString() };
  const locked = runRole(lapsed);
  assert.equal(locked.passed, false);
  assert.equal(locked.status, 403);
  assert.equal(locked.body.code, 'SUBSCRIPTION_EXPIRED');
  assert.equal(runRole(lapsed, { allowLockedSubscription: true }).passed, true);

  const inGrace = { ...officeAdmin, subscription_ends_at: new Date(Date.now() - 2 * day).toISOString() };
  assert.equal(runRole(inGrace).passed, true, 'the grace period still works');
  assert.equal(runRole({ ...officeAdmin, subscription_ends_at: null }).passed, true);
  assert.equal(runRole(officeAdmin).passed, true);
});

/* ───────────── platform owner ───────────── */

test('only the platform owner lists subscriptions or records payments', async () => {
  await assert.rejects(listSubscriptions(officeAdmin, { query: async () => assert.fail() }), { status: 403 });
  await assert.rejects(recordManualPayment(officeAdmin, officeId, { amount: 100, months: 1, method: 'cash' }), { status: 403 });
});

test('subscriptions are listed with their state, amounts as numbers', async () => {
  const query = async () => ({
    rows: [{
      office_id: officeId, name: 'Office', city: 'Nablus', status: 'active',
      subscription_ends_at: new Date(now.getTime() + 3 * day).toISOString(),
      owner_name: 'Owner', owner_email: 'o@x.ps', last_paid_at: null, last_amount: '300.00',
      last_currency: 'ILS', last_method: 'cash', paid_total: '600.00',
    }],
  });
  const { offices, plan } = await listSubscriptions(platformAdmin, { query, now });
  assert.equal(offices[0].subscription.state, 'active');
  assert.equal(offices[0].last_amount, 300);
  assert.equal(offices[0].paid_total, 600);
  assert.equal(Object.hasOwn(offices[0], 'subscription_ends_at'), false);
  assert.equal(plan.currency, 'ILS');
});

test('a manual payment is validated before anything touches the database', async (t) => {
  const calls = mockTransaction(t, () => assert.fail('must not reach the database'));
  for (const body of [
    { amount: 0, months: 1, method: 'cash' },
    { amount: 100, months: 0, method: 'cash' },
    { amount: 100, months: 25, method: 'cash' },
    { amount: 100, months: 1, method: 'online' },
    { amount: 100.555, months: 1, method: 'cash' },
    { amount: 100, months: 1, method: 'cash', office_id: officeId },
  ]) {
    await assert.rejects(recordManualPayment(platformAdmin, officeId, body), { status: 400 }, JSON.stringify(body));
  }
  await assert.rejects(recordManualPayment(platformAdmin, 'not-a-uuid', { amount: 1, months: 1, method: 'cash' }), { status: 400 });
  assert.equal(calls.length, 0);
});

test('a manual payment extends the office from the later of now and its end date, in one transaction', async (t) => {
  const start = new Date('2026-07-01T00:00:00.000Z');
  const end = new Date('2026-10-01T00:00:00.000Z');
  const calls = mockTransaction(t, (sql) => {
    if (sql.includes('FOR UPDATE')) return [{ status: 'active', period_start: start }];
    if (sql.includes('UPDATE law_offices')) return [{ subscription_ends_at: end }];
    if (sql.includes('INSERT INTO subscription_payments')) return [{ payment_id: paymentId, amount: '300.00', months: 3 }];
    if (sql.includes('INSERT INTO audit_logs')) return [{}];
    return undefined;
  });
  const result = await recordManualPayment(platformAdmin, officeId, { amount: '300', months: 3, method: 'bank_transfer', reference: ' TR-55 ' });
  assert.equal(result.payment.amount, 300);
  assert.equal(result.subscription_ends_at, end);
  const lock = calls.find(({ sql }) => sql.includes('FOR UPDATE'));
  assert.match(lock.sql, /GREATEST\(COALESCE\(subscription_ends_at, NOW\(\)\), NOW\(\)\)/);
  const extend = calls.find(({ sql }) => sql.includes('UPDATE law_offices'));
  assert.deepEqual(extend.parameters, [officeId, start, 3]);
  const insert = calls.find(({ sql }) => sql.includes('INSERT INTO subscription_payments'));
  assert.deepEqual(insert.parameters, [officeId, 300, 'ILS', 3, 'bank_transfer', 'TR-55', start, end, platformAdmin.user_id]);
  assert.equal(calls.at(-1).sql, 'COMMIT');
});

test('payments are refused for offices that were never approved', async (t) => {
  const calls = mockTransaction(t, (sql) => (sql.includes('FOR UPDATE') ? [{ status: 'pending', period_start: now }] : undefined));
  await assert.rejects(recordManualPayment(platformAdmin, officeId, { amount: 100, months: 1, method: 'cash' }), { status: 409 });
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
  assert.equal(calls.some(({ sql }) => sql.includes('INSERT INTO subscription_payments')), false);
});

/* ───────────── office owner ───────────── */

test('the office owner sees their own subscription, without who recorded each payment', async () => {
  const calls = [];
  const query = async (sql, parameters) => {
    calls.push({ sql, parameters });
    if (sql.includes('FROM law_offices')) return { rowCount: 1, rows: [{ subscription_ends_at: new Date(now.getTime() + day) }] };
    return { rowCount: 1, rows: [{ payment_id: paymentId, amount: '100.00', recorded_by_name: 'Platform' }] };
  };
  const result = await getOfficeSubscription(officeAdmin, { query, now });
  assert.equal(result.subscription.state, 'active');
  assert.equal(result.payments[0].amount, 100);
  assert.equal(Object.hasOwn(result.payments[0], 'recorded_by_name'), false);
  for (const { parameters } of calls) assert.deepEqual(parameters, [officeId]);
  await assert.rejects(getOfficeSubscription({ ...officeAdmin, role: 'lawyer' }, { query }), { status: 403 });
});

test('online checkout is refused when Stripe is not configured', async () => {
  await withEnv({ STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '' }, async () => {
    await assert.rejects(createCheckout(officeAdmin, { months: 1 }, { query: async () => assert.fail() }), {
      status: 503,
      publicCode: 'ONLINE_PAYMENTS_DISABLED',
    });
  });
});

test('checkout records a pending payment and opens a Stripe session for its exact amount', async () => {
  await withEnv({ STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_WEBHOOK_SECRET: 'whsec_1', SUBSCRIPTION_MONTHLY_PRICE: '120' }, async () => {
    const calls = [];
    const query = async (sql, parameters) => {
      calls.push({ sql, parameters });
      return sql.includes('INSERT') ? { rowCount: 1, rows: [{ payment_id: paymentId }] } : { rowCount: 1, rows: [] };
    };
    let request;
    const fetchImpl = async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }) };
    };
    const result = await createCheckout(officeAdmin, { months: 3 }, { query, fetchImpl });
    assert.equal(result.checkout_url, 'https://checkout.stripe.com/c/pay/cs_test_1');
    assert.deepEqual(calls[0].parameters, [officeId, 360, 'ILS', 3, officeAdmin.user_id]);
    const form = new URLSearchParams(request.options.body);
    assert.equal(request.options.headers.authorization, 'Bearer sk_test_1');
    assert.equal(request.options.headers['idempotency-key'], paymentId);
    assert.equal(form.get('client_reference_id'), paymentId);
    assert.equal(form.get('line_items[0][price_data][unit_amount]'), '12000');
    assert.equal(form.get('line_items[0][quantity]'), '3');
    assert.equal(form.get('line_items[0][price_data][currency]'), 'ils');
    assert.deepEqual(calls.at(-1).parameters, [paymentId, 'cs_test_1']);
  });
});

test('a refused checkout marks the payment failed and reports a provider error', async (t) => {
  t.mock.method(console, 'error', () => {});
  await withEnv({ STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_WEBHOOK_SECRET: 'whsec_1' }, async () => {
    const calls = [];
    const query = async (sql, parameters) => {
      calls.push({ sql, parameters });
      return { rowCount: 1, rows: [{ payment_id: paymentId }] };
    };
    await assert.rejects(
      createCheckout(officeAdmin, { months: 1 }, { query, fetchImpl: async () => ({ ok: false, status: 402 }) }),
      { status: 502, publicCode: 'PAYMENT_PROVIDER_ERROR' }
    );
    assert.match(calls.at(-1).sql, /status = 'failed'/);
  });
});

/* ───────────── webhook ───────────── */

const sign = (body, secret, timestamp = Math.floor(Date.now() / 1000)) =>
  `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

test('webhook signatures are checked against the raw body, the secret and the clock', () => {
  const body = Buffer.from('{"id":"evt_1"}');
  assert.equal(verifyStripeSignature(body, sign(body, 'whsec_1'), 'whsec_1'), true);
  assert.equal(verifyStripeSignature(body, sign(body, 'other'), 'whsec_1'), false);
  assert.equal(verifyStripeSignature(Buffer.from('{"id":"evt_2"}'), sign(body, 'whsec_1'), 'whsec_1'), false);
  assert.equal(verifyStripeSignature(body, sign(body, 'whsec_1', Math.floor(Date.now() / 1000) - 3600), 'whsec_1'), false);
  assert.equal(verifyStripeSignature(body, 'garbage', 'whsec_1'), false);
  assert.equal(verifyStripeSignature(body, sign(body, 'whsec_1'), ''), false);
});

const paidEvent = (overrides = {}) => ({
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_test_1', client_reference_id: paymentId, payment_status: 'paid', amount_total: 36000, currency: 'ils', payment_intent: 'pi_1', ...overrides } },
});
const pendingPayment = { payment_id: paymentId, office_id: officeId, months: 3, amount: '360.00', currency: 'ILS', status: 'pending', provider_session_id: 'cs_test_1' };

test('a confirmed payment extends the subscription and marks the payment paid', async (t) => {
  const end = new Date('2026-09-15T12:00:00.000Z');
  const calls = mockTransaction(t, (sql) => {
    if (sql.includes('FROM subscription_payments')) return [pendingPayment];
    if (sql.includes('FROM law_offices')) return [{ status: 'active', period_start: now }];
    if (sql.includes('UPDATE law_offices')) return [{ subscription_ends_at: end }];
    return [{}];
  });
  const result = await applyStripeEvent(paidEvent());
  assert.deepEqual(result, { applied: true, officeId, endsAt: end });
  const paid = calls.find(({ sql }) => sql.includes("SET status = 'paid'"));
  assert.deepEqual(paid.parameters, [paymentId, now, end, 'pi_1']);
});

test('replays, mismatches and unpaid sessions change nothing', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const [label, payment, event] of [
    ['already paid', { ...pendingPayment, status: 'paid' }, paidEvent()],
    ['wrong amount', pendingPayment, paidEvent({ amount_total: 100 })],
    ['wrong currency', pendingPayment, paidEvent({ currency: 'usd' })],
    ['wrong session', pendingPayment, paidEvent({ id: 'cs_other' })],
  ]) {
    await t.test(label, async (subtest) => {
      const calls = mockTransaction(subtest, (sql) => (sql.includes('FROM subscription_payments') ? [payment] : assert.fail(sql)));
      assert.deepEqual(await applyStripeEvent(event), { applied: false });
      assert.equal(calls.some(({ sql }) => /^\s*UPDATE/.test(sql)), false, 'nothing may be updated');
    });
  }
  assert.deepEqual(await applyStripeEvent(paidEvent({ payment_status: 'unpaid' })), { applied: false });
  assert.deepEqual(await applyStripeEvent({ type: 'customer.created', data: { object: {} } }), { applied: false });
});

/* ───────────── reminders and emails ───────────── */

test('each office is reminded once per end date', async () => {
  const endsAt = new Date(Date.now() + 3 * day);
  const calls = [];
  const notified = [];
  const query = async (sql, parameters) => {
    calls.push({ sql, parameters });
    return sql.startsWith('SELECT') ? { rowCount: 1, rows: [{ office_id: officeId, subscription_ends_at: endsAt }] } : { rowCount: 1, rows: [] };
  };
  const count = await sendSubscriptionReminders({ query, notify: async (event, payload) => notified.push([event, payload]) });
  assert.equal(count, 1);
  assert.deepEqual(notified, [['subscription.expiring', { officeId, endsAt }]]);
  assert.match(calls[0].sql, /subscription_reminder_sent_for IS DISTINCT FROM subscription_ends_at/);
  assert.deepEqual(calls[1].parameters, [officeId, endsAt]);
});

test('payment emails reach the office owner, and online ones the platform owner too', async () => {
  const owner = { user_id: 'u-owner', email: 'owner@office.ps' };
  const platform = { user_id: 'u-platform', email: 'platform@q.ps' };
  const mails = [];
  const dependencies = {
    query: async (sql) => {
      if (sql.includes('m.is_owner = TRUE')) return { rows: [owner] };
      if (sql.includes('is_platform_admin = TRUE')) return { rows: [platform] };
      if (sql.includes('FROM law_offices')) return { rows: [{ name: 'مكتب الاختبار' }] };
      return { rows: [], rowCount: 1 };
    },
    sendMail: async (mail) => mails.push(mail),
  };
  await notify('subscription.paid', { officeId, endsAt: '2026-09-15T00:00:00.000Z', actorUserId: 'u-platform' }, dependencies);
  assert.deepEqual(mails.map((mail) => mail.to), ['owner@office.ps']);
  mails.length = 0;
  await notify('subscription.paid', { officeId, endsAt: '2026-09-15T00:00:00.000Z', online: true }, dependencies);
  assert.deepEqual(mails.map((mail) => mail.to).sort(), ['owner@office.ps', 'platform@q.ps']);
  assert.match(mails.find((mail) => mail.to === 'platform@q.ps').text, /مكتب الاختبار/);
});
