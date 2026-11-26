-- Subscription payment requests: the office owner pays by bank transfer, e-wallet or cash, sends
-- the reference (and a receipt), and the platform owner approves or rejects it.
--
-- * method gains 'wallet' (PalPay, Jawwal Pay and similar e-wallets).
-- * status gains 'rejected' (refused by the platform owner) and 'cancelled' (withdrawn by the office).
-- * payer_note, receipt_key: what the office sent with the request; the receipt file lives in
--   private storage under receipt_key.
-- * review_note, reviewed_by_user_id, reviewed_at: the platform owner's decision.
-- * An office has at most one manual request waiting for review at a time.
-- Like the earlier migrations, this file has no IF NOT EXISTS clauses. Review it before applying.

ALTER TABLE subscription_payments
    DROP CONSTRAINT subscription_payments_method_check,
    ADD CONSTRAINT subscription_payments_method_check
        CHECK (method IN ('cash', 'bank_transfer', 'cheque', 'online', 'wallet')),
    DROP CONSTRAINT subscription_payments_status_check,
    ADD CONSTRAINT subscription_payments_status_check
        CHECK (status IN ('pending', 'paid', 'failed', 'rejected', 'cancelled')),
    ADD COLUMN payer_note TEXT,
    ADD COLUMN receipt_key VARCHAR(80),
    ADD COLUMN review_note TEXT,
    ADD COLUMN reviewed_by_user_id UUID REFERENCES app_users(user_id),
    ADD COLUMN reviewed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX subscription_payments_one_open_request
    ON subscription_payments (office_id)
    WHERE status = 'pending' AND method IN ('bank_transfer', 'wallet', 'cash');

CREATE INDEX subscription_payments_pending_idx
    ON subscription_payments (created_at)
    WHERE status = 'pending';
