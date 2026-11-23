/**
 * Office subscriptions: payments recorded by the platform owner, online payments through Stripe
 * Checkout, the renewal reminders, and what each side is allowed to see.
 *
 * A payment of N months extends the office's access from whichever is later, now or the current
 * end date, so paying early never loses days and paying late starts from the day of payment.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { pool, query as databaseQuery } from '../config/db.js';
import { getSecurityConfig } from '../config/security.js';
import { getSubscriptionConfig, subscriptionSummary } from '../config/subscription.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MANUAL_METHODS = new Set(['cash', 'bank_transfer', 'cheque']);
const STRIPE_CHECKOUT_URL = 'https://api.stripe.com/v1/checkout/sessions';
const STRIPE_TIMEOUT_MS = 15_000;

export class SubscriptionServiceError extends Error {
  constructor(status, message, publicCode) {
    super(message);
    this.name = 'SubscriptionServiceError';
    this.status = status;
    if (publicCode) this.publicCode = publicCode;
  }
}

function invalid(message) {
  throw new SubscriptionServiceError(400, message, 'VALIDATION');
}

function assertPlatformAdmin(actor) {
  if (actor?.is_platform_admin !== true) {
    throw new SubscriptionServiceError(403, 'You do not have permission to access this resource.', 'FORBIDDEN');
  }
}

function assertOfficeAdmin(actor) {
  if (actor?.role !== 'admin' || typeof actor.office_id !== 'string' || !UUID_PATTERN.test(actor.office_id)) {
    throw new SubscriptionServiceError(403, 'You do not have permission to access this resource.', 'FORBIDDEN');
  }
}

function validateOfficeId(officeId) {
  if (typeof officeId !== 'string' || !UUID_PATTERN.test(officeId)) invalid('officeId must be a valid UUID.');
}

function validateMonths(value, max) {
  if (!Number.isInteger(value) || value < 1 || value > max) invalid(`months must be a whole number from 1 to ${max}.`);
  return value;
}

function planOf(config) {
  return {
    monthly_price: config.monthlyPrice,
    currency: config.currency,
    grace_days: config.graceDays,
    trial_days: config.trialDays,
  };
}

/** numeric(12,2) arrives from pg as a string; the API sends amounts as numbers. */
function publicPayment(row) {
  return { ...row, amount: Number(row.amount) };
}

async function inTransaction(work) {
  const client = await pool.connect();
  let releaseError;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      releaseError = rollbackError;
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

/** Locks the office row and moves its end date forward by `months`. */
async function extendSubscription(client, officeId, months) {
  const locked = await client.query(
    `SELECT status, GREATEST(COALESCE(subscription_ends_at, NOW()), NOW()) AS period_start
       FROM law_offices
      WHERE office_id = $1
        FOR UPDATE`,
    [officeId]
  );
  if (!locked.rowCount) throw new SubscriptionServiceError(404, 'Office not found.', 'NOT_FOUND');
  const { status, period_start: periodStart } = locked.rows[0];
  if (status !== 'active' && status !== 'suspended') {
    throw new SubscriptionServiceError(409, 'Payments can be recorded only for approved offices.', 'VALIDATION');
  }
  const updated = await client.query(
    `UPDATE law_offices
        SET subscription_ends_at = $2::timestamptz + make_interval(months => $3::int),
            subscription_reminder_sent_for = NULL,
            updated_at = NOW()
      WHERE office_id = $1
      RETURNING subscription_ends_at`,
    [officeId, periodStart, months]
  );
  return { periodStart, periodEnd: updated.rows[0].subscription_ends_at };
}

const PAYMENT_FIELDS = `
  p.payment_id, p.amount, p.currency, p.months, p.method, p.status, p.reference,
  p.period_start, p.period_end, p.created_at, p.paid_at`;

async function paymentsOf(officeId, query) {
  const result = await query(
    `SELECT ${PAYMENT_FIELDS}, recorder.full_name AS recorded_by_name
       FROM subscription_payments p
       LEFT JOIN app_users recorder ON recorder.user_id = p.recorded_by_user_id
      WHERE p.office_id = $1
      ORDER BY p.created_at DESC, p.payment_id
      LIMIT 100`,
    [officeId]
  );
  return result.rows.map(publicPayment);
}

/* ───────────── platform owner ───────────── */

/** Every approved office with its subscription state and its latest payment. */
export async function listSubscriptions(actor, { query = databaseQuery, now = new Date() } = {}) {
  assertPlatformAdmin(actor);
  const config = getSubscriptionConfig();
  const result = await query(
    `SELECT o.office_id, o.name, o.city, o.status, o.subscription_ends_at,
            owner.full_name AS owner_name, owner.email AS owner_email,
            last_payment.paid_at AS last_paid_at, last_payment.amount AS last_amount,
            last_payment.currency AS last_currency, last_payment.method AS last_method,
            COALESCE(totals.paid_total, 0) AS paid_total
       FROM law_offices o
       JOIN app_users owner ON owner.user_id = o.created_by_user_id
       LEFT JOIN LATERAL (
         SELECT paid_at, amount, currency, method
           FROM subscription_payments p
          WHERE p.office_id = o.office_id AND p.status = 'paid'
          ORDER BY p.paid_at DESC NULLS LAST
          LIMIT 1
       ) last_payment ON TRUE
       LEFT JOIN LATERAL (
         SELECT SUM(amount) AS paid_total
           FROM subscription_payments p
          WHERE p.office_id = o.office_id AND p.status = 'paid'
       ) totals ON TRUE
      WHERE o.status IN ('active', 'suspended')
      ORDER BY o.subscription_ends_at ASC NULLS FIRST, o.name, o.office_id`
  );
  const offices = result.rows.map(({ subscription_ends_at: endsAt, last_amount: lastAmount, paid_total: total, ...row }) => ({
    ...row,
    last_amount: lastAmount === null ? null : Number(lastAmount),
    paid_total: Number(total),
    subscription: subscriptionSummary(endsAt, { now, graceDays: config.graceDays }),
  }));
  return { offices, plan: planOf(config) };
}

export async function listOfficePayments(actor, officeId, { query = databaseQuery } = {}) {
  assertPlatformAdmin(actor);
  validateOfficeId(officeId);
  return { payments: await paymentsOf(officeId, query) };
}

/** A payment received outside the system (cash, transfer, cheque), recorded by the platform owner. */
export async function recordManualPayment(actor, officeId, body) {
  assertPlatformAdmin(actor);
  validateOfficeId(officeId);
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Request body must be a JSON object.');
  const allowed = new Set(['amount', 'months', 'method', 'reference']);
  if (Object.keys(body).some((field) => !allowed.has(field))) invalid('Request contains unsupported fields.');
  const amount = typeof body.amount === 'string' ? Number(body.amount) : body.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    invalid('amount must be a positive number.');
  }
  if (Math.round(amount * 100) !== amount * 100) invalid('amount may have at most two decimals.');
  const months = validateMonths(body.months, 24);
  if (!MANUAL_METHODS.has(body.method)) invalid('method must be cash, bank_transfer, or cheque.');
  const reference = body.reference ?? null;
  if (reference !== null && (typeof reference !== 'string' || reference.trim().length > 120)) {
    invalid('reference must be a string of at most 120 characters.');
  }
  const { currency } = getSubscriptionConfig();

  return inTransaction(async (client) => {
    const { periodStart, periodEnd } = await extendSubscription(client, officeId, months);
    const inserted = await client.query(
      `INSERT INTO subscription_payments
         (office_id, amount, currency, months, method, status, reference,
          period_start, period_end, recorded_by_user_id, paid_at)
       VALUES ($1, $2, $3, $4, $5, 'paid', $6, $7, $8, $9, NOW())
       RETURNING payment_id, amount, currency, months, method, status, reference,
                 period_start, period_end, created_at, paid_at`,
      [officeId, amount, currency, months, body.method, reference?.trim() || null, periodStart, periodEnd, actor.user_id]
    );
    await client.query(
      `INSERT INTO audit_logs (action, entity_type, entity_id, user_id, details)
       VALUES ('subscription_payment_recorded', 'law_office', $1, $2, $3::jsonb)`,
      [officeId, actor.user_id, JSON.stringify({ amount, months, method: body.method })]
    );
    return { payment: publicPayment(inserted.rows[0]), subscription_ends_at: periodEnd };
  });
}

/* ───────────── office owner ───────────── */

export async function getOfficeSubscription(actor, { query = databaseQuery, now = new Date() } = {}) {
  assertOfficeAdmin(actor);
  const config = getSubscriptionConfig();
  const office = await query('SELECT subscription_ends_at FROM law_offices WHERE office_id = $1', [actor.office_id]);
  if (!office.rowCount) throw new SubscriptionServiceError(404, 'Office not found.', 'NOT_FOUND');
  const payments = (await paymentsOf(actor.office_id, query)).map(({ recorded_by_name: _recorder, ...payment }) => payment);
  return {
    subscription: subscriptionSummary(office.rows[0].subscription_ends_at, { now, graceDays: config.graceDays }),
    plan: planOf(config),
    online_payments: config.onlinePaymentsEnabled,
    payments,
  };
}

/**
 * Starts an online payment: records a pending payment, opens a Stripe Checkout session for it,
 * and returns the page the office owner is sent to. Access is extended only when Stripe confirms
 * the payment through the webhook, never because the browser came back to the success page.
 */
export async function createCheckout(actor, body, { query = databaseQuery, fetchImpl = fetch } = {}) {
  assertOfficeAdmin(actor);
  const config = getSubscriptionConfig();
  if (!config.onlinePaymentsEnabled) {
    throw new SubscriptionServiceError(503, 'Online payments are not configured.', 'ONLINE_PAYMENTS_DISABLED');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((field) => field !== 'months')) {
    invalid('Request body must contain only months.');
  }
  const months = validateMonths(body.months, 12);
  const unitAmount = Math.round(config.monthlyPrice * 100);
  const amount = (unitAmount * months) / 100;

  const pending = await query(
    `INSERT INTO subscription_payments (office_id, amount, currency, months, method, status, recorded_by_user_id)
     VALUES ($1, $2, $3, $4, 'online', 'pending', $5)
     RETURNING payment_id`,
    [actor.office_id, amount, config.currency, months, actor.user_id]
  );
  const paymentId = pending.rows[0].payment_id;
  const [origin] = getSecurityConfig().trustedOrigins;
  const form = new URLSearchParams({
    mode: 'payment',
    client_reference_id: paymentId,
    success_url: `${origin}/office/subscription?payment=success`,
    cancel_url: `${origin}/office/subscription?payment=cancelled`,
    'metadata[payment_id]': paymentId,
    'metadata[office_id]': actor.office_id,
    'line_items[0][quantity]': String(months),
    'line_items[0][price_data][currency]': config.currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(unitAmount),
    'line_items[0][price_data][product_data][name]': 'اشتراك قضيتي الشهري',
  });
  if (typeof actor.email === 'string' && actor.email) form.set('customer_email', actor.email);

  let session;
  try {
    const response = await fetchImpl(STRIPE_CHECKOUT_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.stripeSecretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
        'idempotency-key': paymentId,
      },
      body: form.toString(),
      signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
    });
    session = response.ok ? await response.json() : null;
    if (!response.ok) console.error(`Payment provider refused the checkout (HTTP ${response.status}).`);
  } catch (error) {
    console.error('Payment provider could not be reached.', { name: error?.name ?? 'Error' });
  }
  if (!session?.id || !session?.url) {
    await query("UPDATE subscription_payments SET status = 'failed' WHERE payment_id = $1", [paymentId]);
    throw new SubscriptionServiceError(502, 'The payment page could not be opened.', 'PAYMENT_PROVIDER_ERROR');
  }
  await query('UPDATE subscription_payments SET provider_session_id = $2 WHERE payment_id = $1', [paymentId, session.id]);
  return { checkout_url: session.url };
}

/* ───────────── Stripe webhook ───────────── */

/** Checks a `Stripe-Signature` header against the raw request body (Stripe's v1 scheme). */
export function verifyStripeSignature(rawBody, header, secret, { toleranceSeconds = 300, now = Date.now() } = {}) {
  if (!secret || typeof header !== 'string' || !Buffer.isBuffer(rawBody)) return false;
  const pairs = header.split(',').map((part) => part.trim().split('='));
  const timestamp = pairs.find(([key]) => key === 't')?.[1];
  const signatures = pairs.filter(([key, value]) => key === 'v1' && /^[0-9a-f]{64}$/i.test(value ?? '')).map(([, value]) => value);
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
  return signatures.some((signature) => timingSafeEqual(Buffer.from(signature, 'hex'), expected));
}

/**
 * Applies a verified Stripe event. Only a completed and paid Checkout session for a pending
 * payment whose amount, currency and session all match extends the subscription; anything else
 * is acknowledged and ignored. Replayed events change nothing, because the payment is no longer
 * pending the second time.
 */
export async function applyStripeEvent(event) {
  const session = event?.data?.object;
  const paymentId = session?.client_reference_id;
  if (!session || typeof paymentId !== 'string' || !UUID_PATTERN.test(paymentId)) return { applied: false };

  if (event.type === 'checkout.session.expired') {
    await databaseQuery(
      "UPDATE subscription_payments SET status = 'failed' WHERE payment_id = $1 AND status = 'pending'",
      [paymentId]
    );
    return { applied: false };
  }
  const completed = event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded';
  if (!completed || session.payment_status !== 'paid') return { applied: false };

  return inTransaction(async (client) => {
    const found = await client.query(
      `SELECT payment_id, office_id, months, amount, currency, status, provider_session_id
         FROM subscription_payments
        WHERE payment_id = $1
          FOR UPDATE`,
      [paymentId]
    );
    const payment = found.rows[0];
    if (!payment || payment.status !== 'pending') return { applied: false };
    const matches = payment.provider_session_id === session.id
      && Number(session.amount_total) === Math.round(Number(payment.amount) * 100)
      && String(session.currency).toUpperCase() === String(payment.currency).trim().toUpperCase();
    if (!matches) {
      console.error('Payment confirmation did not match the pending payment.', { paymentId });
      return { applied: false };
    }
    const { periodStart, periodEnd } = await extendSubscription(client, payment.office_id, payment.months);
    await client.query(
      `UPDATE subscription_payments
          SET status = 'paid', paid_at = NOW(), period_start = $2, period_end = $3,
              reference = COALESCE(reference, $4)
        WHERE payment_id = $1`,
      [paymentId, periodStart, periodEnd, typeof session.payment_intent === 'string' ? session.payment_intent.slice(0, 120) : null]
    );
    await client.query(
      `INSERT INTO audit_logs (action, entity_type, entity_id, user_id, details)
       VALUES ('subscription_paid_online', 'law_office', $1, NULL, $2::jsonb)`,
      [payment.office_id, JSON.stringify({ payment_id: paymentId, months: payment.months })]
    );
    return { applied: true, officeId: payment.office_id, endsAt: periodEnd };
  });
}

/* ───────────── reminders ───────────── */

/**
 * Finds active offices whose paid period ends within the reminder window and that have not been
 * reminded for this end date yet, and hands each to `notify`. Safe to run as often as wanted.
 */
export async function sendSubscriptionReminders({ query = databaseQuery, notify } = {}) {
  const { reminderDays } = getSubscriptionConfig();
  const due = await query(
    `SELECT office_id, subscription_ends_at
       FROM law_offices
      WHERE status = 'active'
        AND subscription_ends_at > NOW()
        AND subscription_ends_at <= NOW() + make_interval(days => $1::int)
        AND subscription_reminder_sent_for IS DISTINCT FROM subscription_ends_at`,
    [reminderDays]
  );
  for (const office of due.rows) {
    await notify('subscription.expiring', { officeId: office.office_id, endsAt: office.subscription_ends_at });
    await query(
      `UPDATE law_offices SET subscription_reminder_sent_for = subscription_ends_at
        WHERE office_id = $1 AND subscription_ends_at = $2`,
      [office.office_id, office.subscription_ends_at]
    );
  }
  return due.rowCount ?? due.rows.length;
}
