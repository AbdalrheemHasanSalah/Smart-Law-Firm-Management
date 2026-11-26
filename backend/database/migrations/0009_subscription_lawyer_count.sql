-- A subscription is priced per lawyer: each payment keeps how many lawyers it covered.
-- Payments made before this change have no count (NULL).
ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS lawyer_count INTEGER;
ALTER TABLE subscription_payments DROP CONSTRAINT IF EXISTS subscription_payments_lawyer_count_check;
ALTER TABLE subscription_payments
    ADD CONSTRAINT subscription_payments_lawyer_count_check CHECK (lawyer_count IS NULL OR lawyer_count > 0);
