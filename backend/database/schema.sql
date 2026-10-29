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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    role_id UUID NOT NULL REFERENCES roles(role_id)
);

-- 5. Law offices (tenants), memberships, and invitations
CREATE TABLE IF NOT EXISTS law_offices (
    office_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    email VARCHAR(254),
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
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
    client_id UUID NOT NULL REFERENCES clients(client_id),
    user_id UUID NOT NULL REFERENCES app_users(user_id),
    case_id UUID REFERENCES legal_cases(case_id),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    FOREIGN KEY (office_id, client_id) REFERENCES clients(office_id, client_id),
    FOREIGN KEY (office_id, user_id) REFERENCES office_memberships(office_id, user_id),
    FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id),
    CHECK (ends_at > starts_at)
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
    case_id UUID NOT NULL REFERENCES legal_cases(case_id),
    court_id UUID REFERENCES courts(court_id),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id)
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
    FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id),
    FOREIGN KEY (office_id, assigned_to_user_id) REFERENCES office_memberships(office_id, user_id),
    FOREIGN KEY (office_id, created_by_user_id) REFERENCES office_memberships(office_id, user_id),
    CHECK (status <> 'completed' OR completed_at IS NOT NULL)
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
    reference_number VARCHAR(100) UNIQUE,
    status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
    invoice_id UUID NOT NULL REFERENCES invoices(invoice_id),
    user_id UUID NOT NULL REFERENCES app_users(user_id),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    FOREIGN KEY (office_id, invoice_id) REFERENCES invoices(office_id, invoice_id)
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
CREATE INDEX IF NOT EXISTS idx_documents_case ON documents(case_id);
CREATE INDEX IF NOT EXISTS idx_documents_client ON documents(client_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_client ON contracts(client_id);
CREATE INDEX IF NOT EXISTS idx_contracts_case ON contracts(case_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_case ON invoices(case_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_case_notes_case_created ON case_notes(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_interactions_user_created ON ai_interactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_interactions_case ON ai_interactions(case_id);
CREATE INDEX IF NOT EXISTS idx_ai_interactions_document ON ai_interactions(document_id);
CREATE INDEX IF NOT EXISTS idx_ai_interaction_sources_reference ON ai_interaction_sources(reference_id);
CREATE INDEX IF NOT EXISTS idx_case_status_history_case_changed ON case_status_history(case_id, changed_at DESC);
