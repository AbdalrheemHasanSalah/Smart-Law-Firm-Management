-- 1. Required extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Roles
-- Role names are reused as office-membership roles: 'admin' is the administrator of one
-- law office. Platform-wide administration is the separate app_users.is_platform_admin flag.
CREATE TABLE IF NOT EXISTS roles (
    role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT
);

INSERT INTO roles (role_name, description) VALUES
    ('admin', 'Law office administrator'),
    ('lawyer', 'Lawyer or attorney'),
    ('assistant', 'Law firm assistant or staff member'),
    ('client', 'Client portal user')
ON CONFLICT (role_name) DO NOTHING;

-- 3. Better Auth identity and session storage
CREATE TABLE IF NOT EXISTS auth_users (
    id TEXT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(254) NOT NULL UNIQUE,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    image TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    access_token TEXT,
    refresh_token TEXT,
    id_token TEXT,
    access_token_expires_at TIMESTAMPTZ,
    refresh_token_expires_at TIMESTAMPTZ,
    scope TEXT,
    password TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider_id, account_id)
);

CREATE TABLE IF NOT EXISTS verifications (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Business users and Better Auth mapping
-- role_id is retained for compatibility; authorization uses office_memberships.role_id.
CREATE TABLE IF NOT EXISTS app_users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id TEXT UNIQUE REFERENCES auth_users(id) ON DELETE SET NULL,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash TEXT,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'suspended')),
    is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE,
    -- Reminder emails (hearings, tasks, appointments); in-app reminders are always kept.
    email_reminders BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    role_id UUID NOT NULL REFERENCES roles(role_id)
);

-- 5. Law offices (tenants), memberships, and invitations
CREATE TABLE IF NOT EXISTS law_offices (
    office_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    email VARCHAR(254),
    -- The owner's personal address, optional; the office address above is the one the site writes to.
    personal_email VARCHAR(254),
    phone VARCHAR(30),
    city VARCHAR(100),
    address TEXT,
    license_number VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'rejected', 'suspended')),
    review_note TEXT,
    reviewed_at TIMESTAMPTZ,
    reviewed_by_user_id UUID REFERENCES app_users(user_id),
    created_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Paid (or trial) access runs until this moment; NULL means no subscription is tracked.
    subscription_ends_at TIMESTAMPTZ,
    -- The subscription_ends_at value a renewal reminder was last sent for.
    subscription_reminder_sent_for TIMESTAMPTZ
);

-- Office subscription payments: recorded by the platform owner, or paid online by the office.
CREATE TABLE IF NOT EXISTS subscription_payments (
    payment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    currency CHAR(3) NOT NULL,
    months INTEGER NOT NULL CHECK (months BETWEEN 1 AND 24),
    -- How many lawyers the payment covered (the subscription is priced per lawyer).
    lawyer_count INTEGER CONSTRAINT subscription_payments_lawyer_count_check CHECK (lawyer_count IS NULL OR lawyer_count > 0),
    method VARCHAR(20) NOT NULL CHECK (method IN ('cash', 'bank_transfer', 'cheque', 'online', 'wallet')),
    -- rejected: refused by the platform owner; cancelled: withdrawn by the office.
    status VARCHAR(20) NOT NULL DEFAULT 'paid' CHECK (status IN ('pending', 'paid', 'failed', 'rejected', 'cancelled')),
    reference VARCHAR(120),
    provider_session_id VARCHAR(255) UNIQUE,
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    recorded_by_user_id UUID REFERENCES app_users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    paid_at TIMESTAMPTZ,
    -- A payment request sent by the office (bank transfer, e-wallet, cash) and its review.
    payer_note TEXT,
    receipt_key VARCHAR(80),
    review_note TEXT,
    reviewed_by_user_id UUID REFERENCES app_users(user_id),
    reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS subscription_payments_office_idx
    ON subscription_payments (office_id, created_at DESC);
-- An office has at most one manual payment request waiting for review.
CREATE UNIQUE INDEX IF NOT EXISTS subscription_payments_one_open_request
    ON subscription_payments (office_id)
    WHERE status = 'pending' AND method IN ('bank_transfer', 'wallet', 'cash');
CREATE INDEX IF NOT EXISTS subscription_payments_pending_idx
    ON subscription_payments (created_at)
    WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS office_memberships (
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    user_id UUID NOT NULL REFERENCES app_users(user_id),
    role_id UUID NOT NULL REFERENCES roles(role_id),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended')),
    is_owner BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (office_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS office_memberships_one_owner
    ON office_memberships(office_id) WHERE is_owner;

-- The office chosen for a session is stored server-side and re-validated on every request.
ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS active_office_id UUID REFERENCES law_offices(office_id) ON DELETE SET NULL;

-- 6. Lawyer profiles, clients, and courts
-- A lawyer profile describes the person, so it stays platform-wide across offices.
CREATE TABLE IF NOT EXISTS lawyer_profiles (
    lawyer_profile_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bar_number VARCHAR(50) UNIQUE,
    specialty VARCHAR(100),
    years_experience SMALLINT CHECK (years_experience IS NULL OR years_experience >= 0),
    license_status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (license_status IN ('active', 'inactive', 'pending', 'suspended')),
    user_id UUID NOT NULL UNIQUE REFERENCES app_users(user_id)
);

-- A client record belongs to one office. The same person may hold a record in several offices.
CREATE TABLE IF NOT EXISTS clients (
    client_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_type VARCHAR(20) NOT NULL
        CHECK (client_type IN ('individual', 'organization')),
    full_name_or_org VARCHAR(200) NOT NULL,
    phone VARCHAR(30),
    email VARCHAR(254),
    address TEXT,
    -- ID or company registration number, matched exactly by the conflict-of-interest check.
    national_id VARCHAR(30),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id UUID REFERENCES app_users(user_id),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    CONSTRAINT clients_office_client_key UNIQUE (office_id, client_id),
    CONSTRAINT clients_office_user_key UNIQUE (office_id, user_id),
    CONSTRAINT clients_office_member_fkey FOREIGN KEY (office_id, user_id)
        REFERENCES office_memberships(office_id, user_id)
);

CREATE TABLE IF NOT EXISTS office_invitations (
    invitation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    email VARCHAR(254) NOT NULL,
    role_id UUID NOT NULL REFERENCES roles(role_id),
    client_id UUID,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    invited_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    accepted_at TIMESTAMPTZ,
    accepted_by_user_id UUID REFERENCES app_users(user_id),
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT office_invitations_client_fkey FOREIGN KEY (office_id, client_id)
        REFERENCES clients(office_id, client_id),
    CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);

-- Courts are shared reference data across all offices.
CREATE TABLE IF NOT EXISTS courts (
    court_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    location TEXT,
    court_type VARCHAR(50)
);

-- 7. Legal cases
CREATE TABLE IF NOT EXISTS legal_cases (
    case_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_number VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    case_type VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_progress', 'on_hold', 'closed', 'cancelled')),
    priority VARCHAR(20) NOT NULL DEFAULT 'medium'
        CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    description TEXT,
    court_id UUID REFERENCES courts(court_id),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    CONSTRAINT legal_cases_office_case_key UNIQUE (office_id, case_id),
    CONSTRAINT legal_cases_office_number_key UNIQUE (office_id, case_number),
    CHECK (closed_at IS NULL OR closed_at >= opened_at)
);

-- 8. Case participants and assignments
-- Composite (office_id, ...) foreign keys make cross-office links impossible at the database level.
CREATE TABLE IF NOT EXISTS involves (
    client_id UUID NOT NULL REFERENCES clients(client_id),
    case_id UUID NOT NULL REFERENCES legal_cases(case_id),
    party_role VARCHAR(50) NOT NULL DEFAULT 'client',
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    PRIMARY KEY (client_id, case_id),
    FOREIGN KEY (office_id, client_id) REFERENCES clients(office_id, client_id),
    FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id)
);

CREATE TABLE IF NOT EXISTS assigned_to (
    user_id UUID NOT NULL REFERENCES app_users(user_id),
    case_id UUID NOT NULL REFERENCES legal_cases(case_id),
    assignment_role VARCHAR(50) NOT NULL DEFAULT 'lawyer',
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_lead BOOLEAN NOT NULL DEFAULT FALSE,
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    PRIMARY KEY (user_id, case_id),
    FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id),
    FOREIGN KEY (office_id, user_id) REFERENCES office_memberships(office_id, user_id)
);

-- 9. Notifications and messages
CREATE TABLE IF NOT EXISTS notifications (
    notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    notification_type VARCHAR(50) NOT NULL,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id UUID NOT NULL REFERENCES app_users(user_id),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    FOREIGN KEY (office_id, user_id) REFERENCES office_memberships(office_id, user_id)
);

-- One row per reminder sent to one person; inserting it first claims the reminder, so it is
-- never sent twice.
CREATE TABLE IF NOT EXISTS reminder_deliveries (
    reminder_key VARCHAR(200) NOT NULL,
    user_id UUID NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
    office_id UUID NOT NULL REFERENCES law_offices(office_id) ON DELETE CASCADE,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (reminder_key, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
    message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    body TEXT NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at TIMESTAMPTZ,
    message_type VARCHAR(30),
    sender_user_id UUID NOT NULL REFERENCES app_users(user_id),
    receiver_user_id UUID NOT NULL REFERENCES app_users(user_id),
    case_id UUID REFERENCES legal_cases(case_id),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    FOREIGN KEY (office_id, sender_user_id) REFERENCES office_memberships(office_id, user_id),
    FOREIGN KEY (office_id, receiver_user_id) REFERENCES office_memberships(office_id, user_id),
    FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id),
    CHECK (sender_user_id <> receiver_user_id)
);

-- 10. Appointments, hearings, and tasks
CREATE TABLE IF NOT EXISTS appointments (
    appointment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')),
    purpose TEXT NOT NULL,
    location TEXT,
    external_party_name VARCHAR(200),
    appointment_type VARCHAR(20) NOT NULL DEFAULT 'meeting'
        CONSTRAINT appointments_type_check
        CHECK (appointment_type IN ('meeting', 'expert_session', 'court_visit', 'other')),
    -- A client meeting needs a client; other appointments may have none.
    client_id UUID REFERENCES clients(client_id),
    user_id UUID NOT NULL REFERENCES app_users(user_id),
    case_id UUID REFERENCES legal_cases(case_id),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    FOREIGN KEY (office_id, client_id) REFERENCES clients(office_id, client_id),
    FOREIGN KEY (office_id, user_id) REFERENCES office_memberships(office_id, user_id),
    FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id),
    CHECK (ends_at > starts_at),
    CONSTRAINT appointments_meeting_client_check CHECK (appointment_type <> 'meeting' OR client_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS hearings (
    hearing_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hearing_at TIMESTAMPTZ NOT NULL,
    hearing_type VARCHAR(50) NOT NULL,
    court_room VARCHAR(50),
    outcome TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'completed', 'postponed', 'cancelled')),
    notes TEXT,
    -- The outcome as recorded after the session: who attended, why it was postponed, and the
    -- hearing it was postponed to.
    attended_by_user_id UUID,
    postponement_reason TEXT,
    next_hearing_id UUID REFERENCES hearings(hearing_id) ON DELETE SET NULL,
    outcome_recorded_at TIMESTAMPTZ,
    outcome_recorded_by_user_id UUID REFERENCES app_users(user_id),
    case_id UUID NOT NULL REFERENCES legal_cases(case_id),
    court_id UUID REFERENCES courts(court_id),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id),
    CONSTRAINT hearings_attended_by_member_fkey FOREIGN KEY (office_id, attended_by_user_id)
        REFERENCES office_memberships(office_id, user_id)
);

CREATE TABLE IF NOT EXISTS tasks (
    task_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    priority VARCHAR(20) NOT NULL DEFAULT 'medium'
        CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    due_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    case_id UUID REFERENCES legal_cases(case_id),
    assigned_to_user_id UUID NOT NULL REFERENCES app_users(user_id),
    created_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    -- A staff member's own to-do item: seen by its writer only, never tied to a case.
    is_private BOOLEAN NOT NULL DEFAULT FALSE,
    FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id),
    FOREIGN KEY (office_id, assigned_to_user_id) REFERENCES office_memberships(office_id, user_id),
    FOREIGN KEY (office_id, created_by_user_id) REFERENCES office_memberships(office_id, user_id),
    CHECK (status <> 'completed' OR completed_at IS NOT NULL),
    CONSTRAINT tasks_private_owner_check
        CHECK (NOT is_private OR (assigned_to_user_id = created_by_user_id AND case_id IS NULL))
);

-- 11. Documents, audit logs, and legal references
CREATE TABLE IF NOT EXISTS documents (
    document_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name VARCHAR(255) NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    mime_type VARCHAR(100),
    document_type VARCHAR(50) NOT NULL,
    source VARCHAR(100),
    document_date DATE,
    access_level VARCHAR(30) NOT NULL DEFAULT 'restricted'
        CHECK (access_level IN ('restricted', 'case_team', 'authorized_users')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    case_id UUID NOT NULL REFERENCES legal_cases(case_id),
    client_id UUID REFERENCES clients(client_id),
    user_id UUID NOT NULL REFERENCES app_users(user_id),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    CONSTRAINT documents_office_document_key UNIQUE (office_id, document_id),
    FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id),
    FOREIGN KEY (office_id, client_id) REFERENCES clients(office_id, client_id)
);

-- office_id is nullable: platform-level actions (office review) are not tied to one tenant.
CREATE TABLE IF NOT EXISTS audit_logs (
    audit_log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    details JSONB,
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id UUID REFERENCES app_users(user_id),
    office_id UUID REFERENCES law_offices(office_id)
);

-- Legal references are a shared library across all offices.
CREATE TABLE IF NOT EXISTS legal_references (
    reference_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(250) NOT NULL,
    reference_type VARCHAR(50) NOT NULL,
    jurisdiction VARCHAR(100) NOT NULL,
    citation TEXT,
    source_url TEXT,
    published_at DATE,
    user_id UUID REFERENCES app_users(user_id)
);

-- 12. Contracts, invoices, and payments
CREATE TABLE IF NOT EXISTS contracts (
    contract_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    contract_type VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'under_review', 'approved', 'signed', 'archived')),
    storage_key TEXT NOT NULL UNIQUE,
    analysis_summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    client_id UUID NOT NULL REFERENCES clients(client_id),
    case_id UUID REFERENCES legal_cases(case_id),
    user_id UUID NOT NULL REFERENCES app_users(user_id),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    FOREIGN KEY (office_id, client_id) REFERENCES clients(office_id, client_id),
    FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id)
);

CREATE TABLE IF NOT EXISTS powers_of_attorney (
    poa_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    poa_number VARCHAR(60) NOT NULL,
    poa_type VARCHAR(20) NOT NULL
        CHECK (poa_type IN ('general', 'special', 'litigation')),
    issuing_authority VARCHAR(200),
    issued_on DATE NOT NULL,
    expires_on DATE,
    scope TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'revoked')),
    revoked_at TIMESTAMPTZ,
    scan_key TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    client_id UUID NOT NULL,
    created_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    CONSTRAINT powers_of_attorney_office_key UNIQUE (office_id, poa_id),
    CONSTRAINT powers_of_attorney_office_number_key UNIQUE (office_id, poa_number),
    CONSTRAINT powers_of_attorney_dates_check CHECK (expires_on IS NULL OR expires_on >= issued_on),
    CONSTRAINT powers_of_attorney_revoked_check CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
    CONSTRAINT powers_of_attorney_client_fkey FOREIGN KEY (office_id, client_id)
        REFERENCES clients(office_id, client_id)
);

CREATE TABLE IF NOT EXISTS power_of_attorney_lawyers (
    poa_id UUID NOT NULL,
    user_id UUID NOT NULL,
    office_id UUID NOT NULL,
    PRIMARY KEY (poa_id, user_id),
    FOREIGN KEY (office_id, poa_id) REFERENCES powers_of_attorney(office_id, poa_id) ON DELETE CASCADE,
    FOREIGN KEY (office_id, user_id) REFERENCES office_memberships(office_id, user_id)
);

CREATE TABLE IF NOT EXISTS power_of_attorney_cases (
    poa_id UUID NOT NULL,
    case_id UUID NOT NULL,
    office_id UUID NOT NULL,
    PRIMARY KEY (poa_id, case_id),
    FOREIGN KEY (office_id, poa_id) REFERENCES powers_of_attorney(office_id, poa_id) ON DELETE CASCADE,
    FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS court_notices (
    notice_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notice_type VARCHAR(20) NOT NULL
        CHECK (notice_type IN ('notification', 'summons', 'judgment_service', 'execution')),
    recipient VARCHAR(200),
    bailiff_office VARCHAR(200),
    sent_on DATE NOT NULL,
    delivery_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (delivery_status IN ('pending', 'delivered', 'returned', 'refused')),
    delivered_on DATE,
    notes TEXT,
    attachment_key TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    case_id UUID NOT NULL,
    created_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    CONSTRAINT court_notices_case_fkey FOREIGN KEY (office_id, case_id)
        REFERENCES legal_cases(office_id, case_id),
    CONSTRAINT court_notices_dates_check CHECK (delivered_on IS NULL OR delivered_on >= sent_on),
    CONSTRAINT court_notices_delivered_check CHECK (delivery_status = 'pending' OR delivered_on IS NOT NULL)
);

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

CREATE TABLE IF NOT EXISTS invoices (
    invoice_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number VARCHAR(50) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'ILS',
    status VARCHAR(30) NOT NULL DEFAULT 'unpaid'
        CHECK (status IN ('unpaid', 'partially_paid', 'paid', 'overdue', 'cancelled')),
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    due_at TIMESTAMPTZ,
    client_id UUID NOT NULL REFERENCES clients(client_id),
    case_id UUID REFERENCES legal_cases(case_id),
    user_id UUID NOT NULL REFERENCES app_users(user_id),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    -- Lawyer's fees, court fees or expenses: each shows on its own line in a client statement.
    category VARCHAR(20) NOT NULL DEFAULT 'legal_fees'
        CHECK (category IN ('legal_fees', 'court_fees', 'expenses')),
    description TEXT,
    CONSTRAINT invoices_currency_check CHECK (currency IN ('ILS', 'JOD', 'USD')),
    CONSTRAINT invoices_office_invoice_key UNIQUE (office_id, invoice_id),
    CONSTRAINT invoices_office_number_key UNIQUE (office_id, invoice_number),
    FOREIGN KEY (office_id, client_id) REFERENCES clients(office_id, client_id),
    FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id)
);

CREATE TABLE IF NOT EXISTS payments (
    payment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(30) NOT NULL,
    paid_at TIMESTAMPTZ,
    reference_number VARCHAR(100),
    status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
    invoice_id UUID NOT NULL REFERENCES invoices(invoice_id),
    user_id UUID NOT NULL REFERENCES app_users(user_id),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    -- The account the payment was received into (optional; older payments have none).
    account_id UUID,
    -- Unique within an office only, so no office can learn which references another has used.
    CONSTRAINT payments_office_reference_key UNIQUE (office_id, reference_number),
    CONSTRAINT payments_method_check
        CHECK (payment_method IN ('cash', 'bank_transfer', 'cheque', 'card')),
    FOREIGN KEY (office_id, invoice_id) REFERENCES invoices(office_id, invoice_id),
    CONSTRAINT payments_account_fkey FOREIGN KEY (office_id, account_id)
        REFERENCES finance_accounts(office_id, account_id)
);

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
    -- Listed (name and job title only) on the office's public page.
    show_on_public_page BOOLEAN NOT NULL DEFAULT FALSE,
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

CREATE TABLE IF NOT EXISTS office_public_pages (
    office_id UUID PRIMARY KEY REFERENCES law_offices(office_id),
    -- Lower-case Latin letters, digits and single hyphens, unique across the platform.
    slug VARCHAR(60) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    is_published BOOLEAN NOT NULL DEFAULT FALSE,
    tagline VARCHAR(200),
    about TEXT,
    practice_areas TEXT[] NOT NULL DEFAULT '{}',
    whatsapp VARCHAR(30),
    working_hours VARCHAR(300),
    map_url VARCHAR(500) CHECK (map_url IS NULL OR map_url ~ '^https://'),
    logo_key TEXT UNIQUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consultation_requests (
    request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    email VARCHAR(254),
    case_type VARCHAR(50),
    message TEXT NOT NULL,
    preferred_time VARCHAR(200),
    status VARCHAR(20) NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'contacted', 'converted', 'rejected')),
    assigned_to_user_id UUID,
    client_id UUID,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    CONSTRAINT consultation_requests_assignee_fkey FOREIGN KEY (office_id, assigned_to_user_id)
        REFERENCES office_memberships(office_id, user_id),
    CONSTRAINT consultation_requests_client_fkey FOREIGN KEY (office_id, client_id)
        REFERENCES clients(office_id, client_id),
    CONSTRAINT consultation_requests_converted_check CHECK ((status = 'converted') = (client_id IS NOT NULL))
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


-- 13. Case notes
CREATE TABLE IF NOT EXISTS case_notes (
    note_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    body TEXT NOT NULL,
    visibility VARCHAR(30) NOT NULL DEFAULT 'internal'
        CHECK (visibility IN ('internal', 'case_team', 'client_visible')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ,
    case_id UUID NOT NULL REFERENCES legal_cases(case_id),
    user_id UUID NOT NULL REFERENCES app_users(user_id),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id)
);

-- 14. AI interactions and their legal sources
CREATE TABLE IF NOT EXISTS ai_interactions (
    interaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question TEXT NOT NULL,
    answer_summary TEXT,
    model_name VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id UUID NOT NULL REFERENCES app_users(user_id),
    case_id UUID REFERENCES legal_cases(case_id),
    document_id UUID REFERENCES documents(document_id),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id),
    FOREIGN KEY (office_id, document_id) REFERENCES documents(office_id, document_id)
);

CREATE TABLE IF NOT EXISTS ai_interaction_sources (
    interaction_id UUID NOT NULL
        REFERENCES ai_interactions(interaction_id) ON DELETE CASCADE,
    reference_id UUID NOT NULL REFERENCES legal_references(reference_id),
    source_note TEXT,
    PRIMARY KEY (interaction_id, reference_id)
);

-- 15. Case status history
CREATE TABLE IF NOT EXISTS case_status_history (
    history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    old_status VARCHAR(30)
        CHECK (old_status IS NULL OR old_status IN ('open', 'in_progress', 'on_hold', 'closed', 'cancelled')),
    new_status VARCHAR(30) NOT NULL
        CHECK (new_status IN ('open', 'in_progress', 'on_hold', 'closed', 'cancelled')),
    change_note TEXT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    case_id UUID NOT NULL REFERENCES legal_cases(case_id),
    user_id UUID NOT NULL REFERENCES app_users(user_id),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id)
);

-- 15a. Messages to the platform's management from the site's support chat.
CREATE TABLE IF NOT EXISTS support_messages (
    message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    email VARCHAR(254) NOT NULL,
    phone VARCHAR(30),
    topic VARCHAR(30) NOT NULL DEFAULT 'other'
        CHECK (topic IN ('registration', 'subscription', 'account', 'technical', 'other')),
    body TEXT NOT NULL,
    transcript JSONB,
    page_path VARCHAR(300),
    user_id UUID REFERENCES app_users(user_id),
    office_id UUID REFERENCES law_offices(office_id),
    status VARCHAR(20) NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'in_progress', 'closed')),
    reply TEXT,
    replied_at TIMESTAMPTZ,
    replied_by_user_id UUID REFERENCES app_users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15b. Opposing parties of each case, compared with new clients by the conflict-of-interest check.
CREATE TABLE IF NOT EXISTS case_opponents (
    opponent_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    case_id UUID NOT NULL REFERENCES legal_cases(case_id) ON DELETE CASCADE,
    full_name VARCHAR(200) NOT NULL,
    national_id VARCHAR(30),
    phone VARCHAR(30),
    notes TEXT,
    created_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id) ON DELETE CASCADE
);

-- 15c. Legal library (المكتبة القانونية): legislation, rulings and the Official Gazette shared by
-- every office, plus each office's saved items, principles and case references. See migration 0016.
CREATE OR REPLACE FUNCTION legal_normalize(input TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT regexp_replace(
        translate(COALESCE(input, ''), 'أإآٱىةؤئ٠١٢٣٤٥٦٧٨٩', 'اااايهوي0123456789'),
        '[ً-ْٰـ]', '', 'g'
    )
$$;

-- The normalized text, then each word again without its leading clitics when 3+ letters remain.
CREATE OR REPLACE FUNCTION legal_search_text(input TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT legal_normalize(input) || ' ' || regexp_replace(
        legal_normalize(input),
        '(^|[^ء-يa-zA-Z0-9])(وال|بال|كال|فال|لل|ال|و|ف|ب|ل|ك)([ء-ي]{3,})',
        '\1\3',
        'g'
    )
$$;

CREATE TABLE IF NOT EXISTS gazette_issues (
    issue_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key VARCHAR(120) NOT NULL UNIQUE,
    issue_number INTEGER NOT NULL CHECK (issue_number > 0),
    published_on DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS legal_laws (
    law_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key VARCHAR(120) NOT NULL UNIQUE,
    jurisdiction VARCHAR(2) NOT NULL CHECK (jurisdiction IN ('ps', 'jo', 'eg')),
    law_kind VARCHAR(20) NOT NULL
        CHECK (law_kind IN ('law', 'decree_law', 'regulation', 'decree', 'decision', 'order', 'other')),
    title VARCHAR(500) NOT NULL,
    law_number VARCHAR(40),
    law_year SMALLINT CHECK (law_year BETWEEN 1800 AND 2200),
    status VARCHAR(20) NOT NULL DEFAULT 'in_force' CHECK (status IN ('in_force', 'amended', 'repealed')),
    status_note TEXT,
    published_on DATE,
    gazette_issue_id UUID REFERENCES gazette_issues(issue_id) ON DELETE SET NULL,
    source_url TEXT,
    search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', legal_search_text(title))) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS legal_articles (
    article_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    law_id UUID NOT NULL REFERENCES legal_laws(law_id) ON DELETE CASCADE,
    article_number VARCHAR(40) NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    body TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'in_force' CHECK (status IN ('in_force', 'amended', 'repealed')),
    note TEXT,
    search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', legal_search_text(body))) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT legal_articles_law_number_key UNIQUE (law_id, article_number)
);

CREATE TABLE IF NOT EXISTS legal_rulings (
    ruling_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key VARCHAR(120) NOT NULL UNIQUE,
    jurisdiction VARCHAR(2) NOT NULL CHECK (jurisdiction IN ('ps', 'jo', 'eg')),
    court_level VARCHAR(20) NOT NULL
        CHECK (court_level IN ('cassation', 'high', 'constitutional', 'appeal', 'first_instance', 'magistrate', 'other')),
    court_name VARCHAR(200),
    case_number VARCHAR(60),
    ruling_year SMALLINT CHECK (ruling_year BETWEEN 1800 AND 2200),
    decided_on DATE,
    subject VARCHAR(500),
    summary TEXT,
    body TEXT NOT NULL,
    search_vector TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', legal_search_text(COALESCE(subject, '') || ' ' || COALESCE(summary, ''))), 'A')
        || setweight(to_tsvector('simple', legal_search_text(body)), 'D')
    ) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The articles a ruling applied.
CREATE TABLE IF NOT EXISTS legal_ruling_articles (
    ruling_id UUID NOT NULL REFERENCES legal_rulings(ruling_id) ON DELETE CASCADE,
    article_id UUID NOT NULL REFERENCES legal_articles(article_id) ON DELETE CASCADE,
    PRIMARY KEY (ruling_id, article_id)
);

-- What each Gazette issue published, in order. `law_id` links an item to an imported law.
CREATE TABLE IF NOT EXISTS gazette_issue_items (
    issue_id UUID NOT NULL REFERENCES gazette_issues(issue_id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    title VARCHAR(500) NOT NULL,
    law_id UUID REFERENCES legal_laws(law_id) ON DELETE SET NULL,
    PRIMARY KEY (issue_id, position)
);

-- Everyday wording mapped to legal terms: "انطرد من الشغل" → {"فصل تعسفي"}. Phrases are stored
-- normalized, so a search matches them however hamza or taa marbuta were typed.
CREATE TABLE IF NOT EXISTS legal_synonyms (
    phrase VARCHAR(200) PRIMARY KEY,
    terms TEXT[] NOT NULL CHECK (cardinality(terms) BETWEEN 1 AND 10),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per import run, dry runs excluded, for the platform admin's history.
CREATE TABLE IF NOT EXISTS legal_library_imports (
    import_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name VARCHAR(200),
    summary JSONB NOT NULL,
    imported_by_user_id UUID REFERENCES app_users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- An article or ruling an office saved, with its note and tags.
CREATE TABLE IF NOT EXISTS office_library_items (
    item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    article_id UUID REFERENCES legal_articles(article_id) ON DELETE CASCADE,
    ruling_id UUID REFERENCES legal_rulings(ruling_id) ON DELETE CASCADE,
    note TEXT,
    tags TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 10),
    created_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT office_library_items_office_key UNIQUE (office_id, item_id),
    CONSTRAINT office_library_items_target_check CHECK ((article_id IS NULL) <> (ruling_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_office_library_items_article
    ON office_library_items(office_id, article_id) WHERE article_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_office_library_items_ruling
    ON office_library_items(office_id, ruling_id) WHERE ruling_id IS NOT NULL;

-- Principles the office adopts, in its own words.
CREATE TABLE IF NOT EXISTS office_legal_principles (
    principle_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 10),
    created_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT office_legal_principles_office_key UNIQUE (office_id, principle_id)
);

-- An article or ruling linked to one of the office's cases.
CREATE TABLE IF NOT EXISTS case_legal_references (
    reference_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL,
    case_id UUID NOT NULL,
    article_id UUID REFERENCES legal_articles(article_id) ON DELETE CASCADE,
    ruling_id UUID REFERENCES legal_rulings(ruling_id) ON DELETE CASCADE,
    note TEXT,
    linked_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT case_legal_references_target_check CHECK ((article_id IS NULL) <> (ruling_id IS NULL)),
    CONSTRAINT case_legal_references_case_fkey FOREIGN KEY (office_id, case_id)
        REFERENCES legal_cases(office_id, case_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_case_legal_references_article
    ON case_legal_references(case_id, article_id) WHERE article_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_case_legal_references_ruling
    ON case_legal_references(case_id, ruling_id) WHERE ruling_id IS NOT NULL;

-- 15d. Case analysis tools: each AI tool run on a case. See migration 0017.
CREATE TABLE IF NOT EXISTS case_ai_analyses (
    analysis_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    case_id UUID NOT NULL,
    tool VARCHAR(30) NOT NULL CHECK (tool IN (
        'argument', 'legal_question', 'gaps_defenses', 'document', 'appeal_grounds',
        'contract_review', 'judgment', 'brief_check', 'minutes', 'translate'
    )),
    question TEXT,
    target_language VARCHAR(2) CHECK (target_language IS NULL OR target_language IN ('en', 'he', 'fr')),
    model_name VARCHAR(100),
    provider VARCHAR(20),
    result JSONB NOT NULL,
    redaction JSONB NOT NULL DEFAULT '{}'::jsonb,
    tasks_created_at TIMESTAMPTZ,
    created_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT case_ai_analyses_case_fkey FOREIGN KEY (office_id, case_id)
        REFERENCES legal_cases(office_id, case_id) ON DELETE CASCADE
);

-- 15e. Drafting and printing: letterhead, templates, case drafts, issued documents. See migration 0018.
CREATE TABLE IF NOT EXISTS office_letterheads (
    office_id UUID PRIMARY KEY REFERENCES law_offices(office_id),
    display_name VARCHAR(200),
    subtitle VARCHAR(200),
    address TEXT,
    phone VARCHAR(60),
    email VARCHAR(254),
    license_number VARCHAR(100),
    footer_text VARCHAR(500),
    logo_key TEXT UNIQUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_templates (
    template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('contract', 'pleading', 'letter', 'other')),
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT document_templates_office_key UNIQUE (office_id, template_id)
);

CREATE TABLE IF NOT EXISTS case_drafts (
    draft_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    case_id UUID NOT NULL,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('contract', 'pleading', 'letter', 'other')),
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    -- Where it started: a built-in skeleton, an office template, the AI, or a blank page.
    source VARCHAR(20) NOT NULL CHECK (source IN ('builtin', 'template', 'ai', 'blank')),
    source_ref VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final', 'revoked')),
    finalized_at TIMESTAMPTZ,
    finalized_by_user_id UUID REFERENCES app_users(user_id),
    revoked_at TIMESTAMPTZ,
    created_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT case_drafts_office_key UNIQUE (office_id, draft_id),
    CONSTRAINT case_drafts_case_fkey FOREIGN KEY (office_id, case_id)
        REFERENCES legal_cases(office_id, case_id) ON DELETE CASCADE,
    CONSTRAINT case_drafts_final_check CHECK ((status = 'draft') = (finalized_at IS NULL)),
    CONSTRAINT case_drafts_revoked_check CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

-- The verification code is short enough to type from paper: 10 characters with no 0/O or 1/I.
CREATE TABLE IF NOT EXISTS issued_documents (
    issued_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    code VARCHAR(12) NOT NULL UNIQUE,
    kind VARCHAR(30) NOT NULL CHECK (kind IN (
        'contract', 'pleading', 'letter', 'other', 'statement', 'hearing_prep', 'analysis', 'invoice', 'report'
    )),
    content_sha256 CHAR(64) NOT NULL,
    draft_id UUID,
    issued_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    CONSTRAINT issued_documents_draft_fkey FOREIGN KEY (office_id, draft_id)
        REFERENCES case_drafts(office_id, draft_id) ON DELETE SET NULL (draft_id)
);

-- 15f. Voice recordings attached to messages and case notes. See migration 0019.
CREATE TABLE IF NOT EXISTS voice_clips (
    clip_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    owner_user_id UUID NOT NULL REFERENCES app_users(user_id),
    storage_key TEXT NOT NULL UNIQUE,
    mime_type VARCHAR(30) NOT NULL CHECK (mime_type IN ('audio/webm', 'audio/ogg', 'audio/mp4')),
    duration_seconds SMALLINT NOT NULL CHECK (duration_seconds BETWEEN 1 AND 120),
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
    message_id UUID REFERENCES messages(message_id) ON DELETE CASCADE,
    note_id UUID REFERENCES case_notes(note_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT voice_clips_one_place_check CHECK (message_id IS NULL OR note_id IS NULL)
);

-- 15g. Client files, push subscriptions and official notices. See migration 0020.
CREATE TABLE IF NOT EXISTS shared_files (
    file_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    uploaded_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    -- 'portal': a client sent it to the office for a case; 'message': a chat attachment.
    purpose VARCHAR(10) NOT NULL CHECK (purpose IN ('portal', 'message')),
    -- Set when a client sent it: whose file it is, and where it now waits for the office.
    client_id UUID,
    case_id UUID,
    message_id UUID REFERENCES messages(message_id) ON DELETE CASCADE,
    storage_key TEXT NOT NULL UNIQUE,
    mime_type VARCHAR(30) NOT NULL CHECK (mime_type IN ('application/pdf', 'image/png', 'image/jpeg')),
    file_name VARCHAR(255) NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
    note VARCHAR(1000),
    status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'moved', 'dismissed')),
    moved_document_id UUID REFERENCES documents(document_id) ON DELETE SET NULL,
    handled_by_user_id UUID REFERENCES app_users(user_id),
    handled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT shared_files_client_fkey FOREIGN KEY (office_id, client_id) REFERENCES clients(office_id, client_id),
    CONSTRAINT shared_files_case_fkey FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id) ON DELETE SET NULL (case_id),
    CONSTRAINT shared_files_handled_check CHECK ((status = 'new') = (handled_at IS NULL)),
    CONSTRAINT shared_files_portal_case_check CHECK (purpose <> 'portal' OR (client_id IS NOT NULL AND message_id IS NULL))
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    subscription_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh VARCHAR(200) NOT NULL,
    auth VARCHAR(100) NOT NULL,
    user_agent VARCHAR(300),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_success_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS official_notices (
    notice_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    case_id UUID NOT NULL,
    client_id UUID NOT NULL,
    hearing_id UUID REFERENCES hearings(hearing_id) ON DELETE SET NULL,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('hearing', 'judgment', 'other')),
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    sent_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    CONSTRAINT official_notices_office_key UNIQUE (office_id, notice_id),
    CONSTRAINT official_notices_case_fkey FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id) ON DELETE CASCADE,
    CONSTRAINT official_notices_client_fkey FOREIGN KEY (office_id, client_id) REFERENCES clients(office_id, client_id)
);

CREATE TABLE IF NOT EXISTS notice_deliveries (
    delivery_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL,
    notice_id UUID NOT NULL,
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('portal', 'push', 'email', 'whatsapp')),
    -- prepared: a WhatsApp message ready for the lawyer to send; sent: delivered or handed over;
    -- failed: could not be sent (detail says why); skipped: the channel was not available.
    status VARCHAR(20) NOT NULL CHECK (status IN ('prepared', 'sent', 'failed', 'skipped')),
    detail VARCHAR(300),
    recorded_by_user_id UUID REFERENCES app_users(user_id),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (office_id, notice_id) REFERENCES official_notices(office_id, notice_id) ON DELETE CASCADE
);

-- 16. Query and foreign-key indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_verifications_identifier ON verifications(identifier);

CREATE INDEX IF NOT EXISTS idx_users_role ON app_users(role_id);
CREATE INDEX IF NOT EXISTS idx_law_offices_status ON law_offices(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_office_memberships_user ON office_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_office_invitations_office ON office_invitations(office_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_office_invitations_email ON office_invitations(lower(email));
CREATE INDEX IF NOT EXISTS idx_clients_user ON clients(user_id);
CREATE INDEX IF NOT EXISTS idx_clients_office ON clients(office_id);
CREATE INDEX IF NOT EXISTS idx_clients_office_national_id ON clients(office_id, national_id) WHERE national_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_case_opponents_case ON case_opponents(case_id);
CREATE INDEX IF NOT EXISTS idx_case_opponents_office ON case_opponents(office_id);
CREATE INDEX IF NOT EXISTS idx_cases_office ON legal_cases(office_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_cases_court ON legal_cases(court_id);
CREATE INDEX IF NOT EXISTS idx_cases_status ON legal_cases(status);
CREATE INDEX IF NOT EXISTS idx_involves_case ON involves(case_id);
CREATE INDEX IF NOT EXISTS idx_assigned_to_case ON assigned_to(case_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_sent ON messages(receiver_user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_case ON messages(case_id);
CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(starts_at);
CREATE INDEX IF NOT EXISTS idx_appointments_user_start ON appointments(user_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_hearings_case_date ON hearings(case_id, hearing_at);
CREATE INDEX IF NOT EXISTS idx_hearings_court_date ON hearings(court_id, hearing_at);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_status ON tasks(assigned_to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_case ON tasks(case_id);
CREATE INDEX IF NOT EXISTS idx_tasks_private_owner ON tasks(created_by_user_id) WHERE is_private;
CREATE INDEX IF NOT EXISTS idx_documents_case ON documents(case_id);
CREATE INDEX IF NOT EXISTS idx_documents_client ON documents(client_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_office_created ON audit_logs(office_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_client ON contracts(client_id);
CREATE INDEX IF NOT EXISTS idx_contracts_case ON contracts(case_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_case ON invoices(case_id);
CREATE INDEX IF NOT EXISTS idx_invoices_office_issued ON invoices(office_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_case_notes_case_created ON case_notes(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_interactions_user_created ON ai_interactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_interactions_case ON ai_interactions(case_id);
CREATE INDEX IF NOT EXISTS idx_ai_interactions_document ON ai_interactions(document_id);
CREATE INDEX IF NOT EXISTS idx_ai_interaction_sources_reference ON ai_interaction_sources(reference_id);
CREATE INDEX IF NOT EXISTS idx_case_status_history_case_changed ON case_status_history(case_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_messages_status_created ON support_messages(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_powers_of_attorney_client ON powers_of_attorney(client_id);
CREATE INDEX IF NOT EXISTS idx_powers_of_attorney_office_expiry ON powers_of_attorney(office_id, expires_on)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_power_of_attorney_lawyers_user ON power_of_attorney_lawyers(user_id);
CREATE INDEX IF NOT EXISTS idx_power_of_attorney_cases_case ON power_of_attorney_cases(case_id);
CREATE INDEX IF NOT EXISTS idx_hearings_office_date ON hearings(office_id, hearing_at);
CREATE INDEX IF NOT EXISTS idx_court_notices_case ON court_notices(case_id, sent_on DESC);
CREATE INDEX IF NOT EXISTS idx_court_notices_office_sent ON court_notices(office_id, sent_on);
CREATE INDEX IF NOT EXISTS idx_reminder_deliveries_sent ON reminder_deliveries(sent_at);
CREATE INDEX IF NOT EXISTS idx_payments_account ON payments(account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_custodies_holder ON custodies(holder_user_id, status);
CREATE INDEX IF NOT EXISTS idx_custodies_office_issued ON custodies(office_id, issued_on DESC);
CREATE INDEX IF NOT EXISTS idx_office_expenses_office_spent ON office_expenses(office_id, spent_on DESC);
CREATE INDEX IF NOT EXISTS idx_office_expenses_custody ON office_expenses(custody_id) WHERE custody_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_office_expenses_case ON office_expenses(case_id) WHERE case_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_account_transfers_office_date ON account_transfers(office_id, transferred_on DESC);
CREATE INDEX IF NOT EXISTS idx_salary_advances_member ON salary_advances(office_id, user_id);
CREATE INDEX IF NOT EXISTS idx_payslips_office_period ON payslips(office_id, period);
CREATE INDEX IF NOT EXISTS idx_leave_requests_member ON leave_requests(office_id, user_id, starts_on DESC);
CREATE INDEX IF NOT EXISTS idx_leave_requests_office_dates ON leave_requests(office_id, starts_on, ends_on)
    WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS idx_consultation_requests_office ON consultation_requests(office_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consultation_requests_assignee ON consultation_requests(assigned_to_user_id)
    WHERE assigned_to_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_legal_laws_search ON legal_laws USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_legal_laws_browse ON legal_laws(jurisdiction, law_year DESC);
CREATE INDEX IF NOT EXISTS idx_legal_laws_gazette ON legal_laws(gazette_issue_id) WHERE gazette_issue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_legal_articles_search ON legal_articles USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_legal_articles_law_position ON legal_articles(law_id, position);
CREATE INDEX IF NOT EXISTS idx_legal_rulings_search ON legal_rulings USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_legal_rulings_browse ON legal_rulings(jurisdiction, decided_on DESC);
CREATE INDEX IF NOT EXISTS idx_legal_ruling_articles_article ON legal_ruling_articles(article_id);
CREATE INDEX IF NOT EXISTS idx_gazette_issues_published ON gazette_issues(published_on DESC);
CREATE INDEX IF NOT EXISTS idx_office_library_items_office ON office_library_items(office_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_office_legal_principles_office ON office_legal_principles(office_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_legal_references_case ON case_legal_references(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_ai_analyses_case ON case_ai_analyses(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_ai_analyses_office_month ON case_ai_analyses(office_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_interactions_office_created ON ai_interactions(office_id, created_at);
CREATE INDEX IF NOT EXISTS idx_document_templates_office ON document_templates(office_id, kind) WHERE NOT is_archived;
CREATE INDEX IF NOT EXISTS idx_case_drafts_case ON case_drafts(case_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_drafts_office_source ON case_drafts(office_id, created_at) WHERE source = 'ai';
CREATE INDEX IF NOT EXISTS idx_issued_documents_office ON issued_documents(office_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_issued_documents_draft ON issued_documents(draft_id) WHERE draft_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_clips_message ON voice_clips(message_id) WHERE message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_clips_note ON voice_clips(note_id) WHERE note_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_voice_clips_unattached ON voice_clips(office_id, created_at)
    WHERE message_id IS NULL AND note_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_shared_files_case_new ON shared_files(case_id, created_at DESC) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shared_files_client ON shared_files(client_id, created_at DESC) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shared_files_message ON shared_files(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shared_files_unattached ON shared_files(office_id, created_at)
    WHERE purpose = 'message' AND message_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_official_notices_case ON official_notices(case_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_official_notices_client ON official_notices(client_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notice_deliveries_notice ON notice_deliveries(notice_id, recorded_at);
