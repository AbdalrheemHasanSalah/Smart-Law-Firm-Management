-- Case finances: what the office bills its clients and what they pay.
--
-- * invoices.category separates lawyer's fees, court fees and expenses, so a client statement
--   shows each kind on its own line. invoices.description says what the charge is for.
-- * Currencies are limited to the three used in Palestine: ILS, JOD and USD.
-- * Payment methods are a fixed list.
-- * Payment reference numbers were unique across all offices, so one office could learn that
--   another had used a number. They are now unique within each office.
-- Like the earlier migrations, this file has no IF NOT EXISTS clauses: re-running it fails
-- instead of silently skipping. Review it before applying (see README.md).

ALTER TABLE invoices
    ADD COLUMN category VARCHAR(20) NOT NULL DEFAULT 'legal_fees'
        CHECK (category IN ('legal_fees', 'court_fees', 'expenses')),
    ADD COLUMN description TEXT,
    ADD CONSTRAINT invoices_currency_check CHECK (currency IN ('ILS', 'JOD', 'USD'));

ALTER TABLE payments
    DROP CONSTRAINT payments_reference_number_key,
    ADD CONSTRAINT payments_office_reference_key UNIQUE (office_id, reference_number),
    ADD CONSTRAINT payments_method_check
        CHECK (payment_method IN ('cash', 'bank_transfer', 'cheque', 'card'));

CREATE INDEX idx_invoices_office_issued
    ON invoices (office_id, issued_at DESC);
