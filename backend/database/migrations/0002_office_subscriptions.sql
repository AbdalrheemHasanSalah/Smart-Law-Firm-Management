-- Office subscriptions: paid access periods for each law office.
--
-- Adds the subscription end date to law_offices and a ledger of subscription payments.
-- Offices that are already active receive a 30-day period so they are not locked out the
-- moment this migration runs. Like 0001, this file has no IF NOT EXISTS clauses: re-running it
-- fails instead of silently skipping. Review it before applying (see README.md).

ALTER TABLE law_offices
    ADD COLUMN subscription_ends_at TIMESTAMPTZ,
    ADD COLUMN subscription_reminder_sent_for TIMESTAMPTZ;

CREATE TABLE subscription_payments (
    payment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    currency CHAR(3) NOT NULL,
    months INTEGER NOT NULL CHECK (months BETWEEN 1 AND 24),
    method VARCHAR(20) NOT NULL CHECK (method IN ('cash', 'bank_transfer', 'cheque', 'online')),
    status VARCHAR(20) NOT NULL DEFAULT 'paid' CHECK (status IN ('pending', 'paid', 'failed')),
    reference VARCHAR(120),
    provider_session_id VARCHAR(255) UNIQUE,
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    recorded_by_user_id UUID REFERENCES app_users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    paid_at TIMESTAMPTZ
);

CREATE INDEX subscription_payments_office_idx
    ON subscription_payments (office_id, created_at DESC);

UPDATE law_offices
   SET subscription_ends_at = NOW() + INTERVAL '30 days'
 WHERE status = 'active';
