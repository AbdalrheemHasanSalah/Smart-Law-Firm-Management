-- Office finance: accounts (cash box, bank, wallet), office expenses, petty cash custodies
-- (العُهد) and transfers between accounts.
--
-- No running balance is stored. An account's balance and ledger are read from what moved money:
-- its opening balance, client payments received into it, expenses paid from it, custodies issued
-- from or returned to it, and transfers. Each account has one currency, and money never moves
-- between currencies.

CREATE TABLE IF NOT EXISTS finance_accounts (
    account_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    account_type VARCHAR(20) NOT NULL CHECK (account_type IN ('cash', 'bank', 'wallet')),
    currency CHAR(3) NOT NULL CHECK (currency IN ('ILS', 'JOD', 'USD')),
    opening_balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
    opened_on DATE NOT NULL DEFAULT CURRENT_DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    CONSTRAINT finance_accounts_office_account_key UNIQUE (office_id, account_id),
    CONSTRAINT finance_accounts_office_name_key UNIQUE (office_id, name)
);

-- The account a client payment was received into (optional; older payments have none).
ALTER TABLE payments ADD COLUMN IF NOT EXISTS account_id UUID;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_account_fkey;
ALTER TABLE payments ADD CONSTRAINT payments_account_fkey
    FOREIGN KEY (office_id, account_id) REFERENCES finance_accounts(office_id, account_id);

CREATE TABLE IF NOT EXISTS custodies (
    custody_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    holder_user_id UUID NOT NULL,
    account_id UUID NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    currency CHAR(3) NOT NULL CHECK (currency IN ('ILS', 'JOD', 'USD')),
    issued_on DATE NOT NULL,
    purpose TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled')),
    settled_on DATE,
    returned_amount NUMERIC(12, 2) CHECK (returned_amount >= 0),
    return_account_id UUID,
    created_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    CONSTRAINT custodies_office_custody_key UNIQUE (office_id, custody_id),
    CONSTRAINT custodies_holder_fkey FOREIGN KEY (office_id, holder_user_id)
        REFERENCES office_memberships(office_id, user_id),
    CONSTRAINT custodies_account_fkey FOREIGN KEY (office_id, account_id)
        REFERENCES finance_accounts(office_id, account_id),
    CONSTRAINT custodies_return_account_fkey FOREIGN KEY (office_id, return_account_id)
        REFERENCES finance_accounts(office_id, account_id),
    CONSTRAINT custodies_settled_check CHECK (
        (status = 'open' AND settled_on IS NULL AND returned_amount IS NULL AND return_account_id IS NULL)
        OR (status = 'settled' AND settled_on IS NOT NULL AND returned_amount IS NOT NULL
            AND (returned_amount = 0 OR return_account_id IS NOT NULL))
    ),
    CONSTRAINT custodies_dates_check CHECK (settled_on IS NULL OR settled_on >= issued_on)
);

CREATE TABLE IF NOT EXISTS office_expenses (
    expense_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(20) NOT NULL
        CHECK (category IN ('rent', 'salaries', 'utilities', 'supplies', 'transport', 'court_costs', 'other')),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    currency CHAR(3) NOT NULL CHECK (currency IN ('ILS', 'JOD', 'USD')),
    spent_on DATE NOT NULL,
    payee VARCHAR(200),
    description TEXT,
    -- Paid either from an office account or from a custody, never both.
    account_id UUID,
    custody_id UUID,
    case_id UUID,
    receipt_key TEXT UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
    cancelled_at TIMESTAMPTZ,
    created_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    CONSTRAINT office_expenses_office_expense_key UNIQUE (office_id, expense_id),
    CONSTRAINT office_expenses_source_check CHECK (num_nonnulls(account_id, custody_id) = 1),
    CONSTRAINT office_expenses_cancelled_check CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
    CONSTRAINT office_expenses_account_fkey FOREIGN KEY (office_id, account_id)
        REFERENCES finance_accounts(office_id, account_id),
    CONSTRAINT office_expenses_custody_fkey FOREIGN KEY (office_id, custody_id)
        REFERENCES custodies(office_id, custody_id),
    CONSTRAINT office_expenses_case_fkey FOREIGN KEY (office_id, case_id)
        REFERENCES legal_cases(office_id, case_id)
);

CREATE TABLE IF NOT EXISTS account_transfers (
    transfer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_account_id UUID NOT NULL,
    to_account_id UUID NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    transferred_on DATE NOT NULL,
    note TEXT,
    created_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    CONSTRAINT account_transfers_distinct_check CHECK (from_account_id <> to_account_id),
    CONSTRAINT account_transfers_from_fkey FOREIGN KEY (office_id, from_account_id)
        REFERENCES finance_accounts(office_id, account_id),
    CONSTRAINT account_transfers_to_fkey FOREIGN KEY (office_id, to_account_id)
        REFERENCES finance_accounts(office_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_payments_account ON payments(account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_custodies_holder ON custodies(holder_user_id, status);
CREATE INDEX IF NOT EXISTS idx_custodies_office_issued ON custodies(office_id, issued_on DESC);
CREATE INDEX IF NOT EXISTS idx_office_expenses_office_spent ON office_expenses(office_id, spent_on DESC);
CREATE INDEX IF NOT EXISTS idx_office_expenses_custody ON office_expenses(custody_id) WHERE custody_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_office_expenses_case ON office_expenses(case_id) WHERE case_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_account_transfers_office_date ON account_transfers(office_id, transferred_on DESC);
