/**
 * Office subscription settings and the rule that turns an end date into a state.
 *
 *   active   the paid (or trial) period has not ended
 *   grace    it ended less than SUBSCRIPTION_GRACE_DAYS ago: the office still works, with a warning
 *   expired  the grace period is over too: the office is locked until a payment is recorded
 *   none     no end date is tracked for this office (offices created before subscriptions)
 *
 * The lock is computed from the date on every request, never stored, so recording a payment
 * restores access immediately and nothing has to run at midnight for it to start.
 */
const DAY_MS = 86_400_000;

function positiveNumber(value, fallback, { integer = false, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > max || (integer && !Number.isInteger(parsed))) {
    throw new Error(`Invalid subscription setting: ${value}`);
  }
  return parsed;
}

export function getSubscriptionConfig(env = process.env) {
  const currency = (env.SUBSCRIPTION_CURRENCY || 'ILS').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('SUBSCRIPTION_CURRENCY must be a 3-letter ISO code.');
  return {
    monthlyPrice: positiveNumber(env.SUBSCRIPTION_MONTHLY_PRICE, 100, { max: 1_000_000 }),
    currency,
    graceDays: positiveNumber(env.SUBSCRIPTION_GRACE_DAYS, 7, { integer: true, max: 90 }),
    trialDays: positiveNumber(env.SUBSCRIPTION_TRIAL_DAYS, 30, { integer: true, max: 365 }),
    reminderDays: positiveNumber(env.SUBSCRIPTION_REMINDER_DAYS, 7, { integer: true, max: 60 }),
    stripeSecretKey: env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
    get onlinePaymentsEnabled() {
      return Boolean(this.stripeSecretKey && this.stripeWebhookSecret);
    },
  };
}

/** The subscription of one office at `now`, as the API reports it. */
export function subscriptionSummary(endsAt, { now = new Date(), graceDays = getSubscriptionConfig().graceDays } = {}) {
  if (endsAt === null || endsAt === undefined) {
    return { state: 'none', ends_at: null, grace_ends_at: null, days_left: null };
  }
  const end = new Date(endsAt);
  const graceEnd = new Date(end.getTime() + graceDays * DAY_MS);
  const nowMs = now.getTime();
  let state = 'active';
  if (nowMs >= graceEnd.getTime()) state = 'expired';
  else if (nowMs >= end.getTime()) state = 'grace';
  // Days until the next change: the end of the period, or the end of the grace period.
  const target = state === 'active' ? end : graceEnd;
  return {
    state,
    ends_at: end.toISOString(),
    grace_ends_at: graceEnd.toISOString(),
    days_left: Math.max(0, Math.ceil((target.getTime() - nowMs) / DAY_MS)),
  };
}

export function isSubscriptionLocked(endsAt, options) {
  return subscriptionSummary(endsAt, options).state === 'expired';
}
