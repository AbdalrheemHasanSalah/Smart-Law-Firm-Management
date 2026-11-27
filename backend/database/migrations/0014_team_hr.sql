-- Team HR: staff records, salary advances (السُلف), monthly payslips and leave requests.
--
-- Money follows the office-finance rules: an advance is cash out of an account when it is given,
-- and a payslip, once paid, is cash out for its net. Both are recorded as "salaries" office
-- expenses, linked here, so balances and profit stay right without a second ledger. An advance is
-- paid back by deducting it from later payslips; what is still owed is the advances minus those
-- deductions on paid payslips.

CREATE TABLE IF NOT EXISTS staff_profiles (
    user_id UUID NOT NULL,
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    job_title VARCHAR(100),
    hire_date DATE,
    phone VARCHAR(30),
    -- Seen by the office administrator and the person only.
    national_id VARCHAR(30),
    monthly_salary NUMERIC(12, 2) CHECK (monthly_salary >= 0),
    salary_currency CHAR(3) NOT NULL DEFAULT 'ILS' CHECK (salary_currency IN ('ILS', 'JOD', 'USD')),
    annual_leave_days INTEGER NOT NULL DEFAULT 14 CHECK (annual_leave_days BETWEEN 0 AND 60),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (office_id, user_id),
    FOREIGN KEY (office_id, user_id) REFERENCES office_memberships(office_id, user_id)
);

CREATE TABLE IF NOT EXISTS salary_advances (
    advance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    currency CHAR(3) NOT NULL CHECK (currency IN ('ILS', 'JOD', 'USD')),
    given_on DATE NOT NULL,
    note TEXT,
    expense_id UUID NOT NULL,
    created_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    CONSTRAINT salary_advances_member_fkey FOREIGN KEY (office_id, user_id)
        REFERENCES office_memberships(office_id, user_id),
    CONSTRAINT salary_advances_expense_fkey FOREIGN KEY (office_id, expense_id)
        REFERENCES office_expenses(office_id, expense_id)
);

CREATE TABLE IF NOT EXISTS payslips (
    payslip_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    period CHAR(7) NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    salary NUMERIC(12, 2) NOT NULL CHECK (salary >= 0),
    advance_deduction NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (advance_deduction >= 0),
    other_deductions NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (other_deductions >= 0),
    deduction_note TEXT,
    net NUMERIC(12, 2) NOT NULL,
    currency CHAR(3) NOT NULL CHECK (currency IN ('ILS', 'JOD', 'USD')),
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'paid')),
    paid_on DATE,
    expense_id UUID,
    created_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    CONSTRAINT payslips_office_member_period_key UNIQUE (office_id, user_id, period),
    CONSTRAINT payslips_member_fkey FOREIGN KEY (office_id, user_id)
        REFERENCES office_memberships(office_id, user_id),
    CONSTRAINT payslips_expense_fkey FOREIGN KEY (office_id, expense_id)
        REFERENCES office_expenses(office_id, expense_id),
    CONSTRAINT payslips_net_check CHECK (net = salary - advance_deduction - other_deductions AND net >= 0),
    -- A paid payslip has its date; its expense exists whenever something was paid out.
    CONSTRAINT payslips_paid_check CHECK (
        (status = 'draft' AND paid_on IS NULL AND expense_id IS NULL)
        OR (status = 'paid' AND paid_on IS NOT NULL AND (net = 0 OR expense_id IS NOT NULL))
    )
);

CREATE TABLE IF NOT EXISTS leave_requests (
    leave_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    leave_type VARCHAR(20) NOT NULL CHECK (leave_type IN ('annual', 'sick', 'unpaid', 'other')),
    starts_on DATE NOT NULL,
    ends_on DATE NOT NULL,
    -- Working days in the leave (Fridays are not counted), worked out when it is requested.
    days INTEGER NOT NULL CHECK (days > 0),
    reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    decided_by_user_id UUID REFERENCES app_users(user_id),
    decided_at TIMESTAMPTZ,
    decision_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    CONSTRAINT leave_requests_member_fkey FOREIGN KEY (office_id, user_id)
        REFERENCES office_memberships(office_id, user_id),
    CONSTRAINT leave_requests_dates_check CHECK (ends_on >= starts_on),
    CONSTRAINT leave_requests_decided_check CHECK (
        (status IN ('approved', 'rejected')) = (decided_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_salary_advances_member ON salary_advances(office_id, user_id);
CREATE INDEX IF NOT EXISTS idx_payslips_office_period ON payslips(office_id, period);
CREATE INDEX IF NOT EXISTS idx_leave_requests_member ON leave_requests(office_id, user_id, starts_on DESC);
CREATE INDEX IF NOT EXISTS idx_leave_requests_office_dates ON leave_requests(office_id, starts_on, ends_on)
    WHERE status = 'approved';
