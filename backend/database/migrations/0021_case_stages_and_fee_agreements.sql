-- Case workflow and fee agreements (المرحلة 6).
--
--   legal_cases.stage          where the case stands in its life: registration → preparation →
--                              hearings → judgment → appeal → execution → closed. Separate from
--                              the status (open, on hold, closed…), which says whether work goes on.
--   legal_cases.mizan_number   the case number in the judiciary's Mizan system
--   case_stage_history         every move between stages: from, to, who, when and why
--   fee_agreements             the fee agreed with a client on a case, in one currency
--   fee_installments           its schedule: one invoice per installment, issued with the
--                              agreement, so payments, statements and aging reports need nothing new

ALTER TABLE legal_cases ADD COLUMN IF NOT EXISTS stage VARCHAR(20) NOT NULL DEFAULT 'registration';
ALTER TABLE legal_cases ADD COLUMN IF NOT EXISTS mizan_number VARCHAR(60);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_cases_stage_check') THEN
        ALTER TABLE legal_cases ADD CONSTRAINT legal_cases_stage_check
            CHECK (stage IN ('registration', 'preparation', 'hearings', 'judgment', 'appeal', 'execution', 'closed'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS case_stage_history (
    history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL,
    case_id UUID NOT NULL,
    from_stage VARCHAR(20),
    to_stage VARCHAR(20) NOT NULL,
    note VARCHAR(1000),
    changed_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS fee_agreements (
    agreement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    case_id UUID NOT NULL,
    client_id UUID NOT NULL,
    currency CHAR(3) NOT NULL CHECK (currency IN ('ILS', 'JOD', 'USD')),
    total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount > 0),
    description VARCHAR(500),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'settled')),
    -- A settlement closes what is left: unpaid installments are cancelled and, when the client pays
    -- an agreed sum instead, one invoice for it is issued.
    settled_at TIMESTAMPTZ,
    settlement_amount NUMERIC(12, 2) CHECK (settlement_amount IS NULL OR settlement_amount >= 0),
    settlement_note VARCHAR(1000),
    settlement_invoice_id UUID REFERENCES invoices(invoice_id),
    created_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fee_agreements_office_key UNIQUE (office_id, agreement_id),
    CONSTRAINT fee_agreements_case_fkey FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id) ON DELETE CASCADE,
    CONSTRAINT fee_agreements_client_fkey FOREIGN KEY (office_id, client_id) REFERENCES clients(office_id, client_id),
    CONSTRAINT fee_agreements_settled_check CHECK ((status = 'settled') = (settled_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS fee_installments (
    installment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL,
    agreement_id UUID NOT NULL,
    sequence SMALLINT NOT NULL CHECK (sequence > 0),
    due_on DATE NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    invoice_id UUID NOT NULL REFERENCES invoices(invoice_id),
    CONSTRAINT fee_installments_sequence_key UNIQUE (agreement_id, sequence),
    FOREIGN KEY (office_id, agreement_id) REFERENCES fee_agreements(office_id, agreement_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_case_stage_history_case ON case_stage_history(case_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_fee_agreements_case ON fee_agreements(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fee_agreements_client ON fee_agreements(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fee_installments_agreement ON fee_installments(agreement_id, sequence);
CREATE INDEX IF NOT EXISTS idx_fee_installments_invoice ON fee_installments(invoice_id);
