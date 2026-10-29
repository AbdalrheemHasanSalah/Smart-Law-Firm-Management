-- 0001_multi_tenant_offices
--
-- Converts the single-office schema into a multi-tenant one: law offices, office memberships
-- and invitations, plus an office_id on every tenant-owned table.
--
-- Existing data is preserved by moving it into one "legacy" office owned by the earliest
-- admin account. Every existing app user becomes a member of that office with their current
-- role. Review this with the backend owner/DBA before applying; it has NOT been run against any
-- shared database.
--
-- Preflight (fail-closed):
--   * CREATE TABLE statements below have no IF NOT EXISTS, so a partially applied earlier
--     attempt stops the migration instead of being silently adopted.
--   * The legacy-office INSERT selects the earliest admin. If tenant tables already contain data
--     but no admin exists, the SET NOT NULL steps fail and the transaction rolls back.

ALTER TABLE app_users
    ADD COLUMN is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE roles SET description = 'Law office administrator' WHERE role_name = 'admin';

CREATE TABLE law_offices (
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

CREATE TABLE office_memberships (
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

CREATE UNIQUE INDEX office_memberships_one_owner
    ON office_memberships(office_id) WHERE is_owner;

-- Legacy office for the existing data, owned by the earliest admin account.
INSERT INTO law_offices (name, status, created_by_user_id, reviewed_at)
SELECT 'Legacy office', 'active', u.user_id, NOW()
  FROM app_users u
  JOIN roles r ON r.role_id = u.role_id
 WHERE r.role_name = 'admin'
 ORDER BY u.created_at ASC, u.user_id ASC
 LIMIT 1;

INSERT INTO office_memberships (office_id, user_id, role_id, status, is_owner)
SELECT office.office_id,
       u.user_id,
       u.role_id,
       CASE WHEN u.status = 'active' THEN 'active' ELSE 'suspended' END,
       u.user_id = office.created_by_user_id
  FROM app_users u
 CROSS JOIN law_offices office;

ALTER TABLE sessions
    ADD COLUMN active_office_id UUID REFERENCES law_offices(office_id) ON DELETE SET NULL;

-- clients: office ownership; one client record per (office, account) instead of per account.
ALTER TABLE clients ADD COLUMN office_id UUID REFERENCES law_offices(office_id);
UPDATE clients SET office_id = (SELECT office_id FROM law_offices LIMIT 1);
ALTER TABLE clients ALTER COLUMN office_id SET NOT NULL;
ALTER TABLE clients DROP CONSTRAINT clients_user_id_key;
ALTER TABLE clients ADD CONSTRAINT clients_office_client_key UNIQUE (office_id, client_id);
ALTER TABLE clients ADD CONSTRAINT clients_office_user_key UNIQUE (office_id, user_id);
ALTER TABLE clients ADD CONSTRAINT clients_office_member_fkey
    FOREIGN KEY (office_id, user_id) REFERENCES office_memberships(office_id, user_id);

CREATE TABLE office_invitations (
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

-- legal_cases: case numbers are unique per office.
ALTER TABLE legal_cases ADD COLUMN office_id UUID REFERENCES law_offices(office_id);
UPDATE legal_cases SET office_id = (SELECT office_id FROM law_offices LIMIT 1);
ALTER TABLE legal_cases ALTER COLUMN office_id SET NOT NULL;
ALTER TABLE legal_cases DROP CONSTRAINT legal_cases_case_number_key;
ALTER TABLE legal_cases ADD CONSTRAINT legal_cases_office_case_key UNIQUE (office_id, case_id);
ALTER TABLE legal_cases ADD CONSTRAINT legal_cases_office_number_key UNIQUE (office_id, case_number);

ALTER TABLE involves ADD COLUMN office_id UUID REFERENCES law_offices(office_id);
UPDATE involves SET office_id = (SELECT office_id FROM law_offices LIMIT 1);
ALTER TABLE involves ALTER COLUMN office_id SET NOT NULL;
ALTER TABLE involves ADD FOREIGN KEY (office_id, client_id) REFERENCES clients(office_id, client_id);
ALTER TABLE involves ADD FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id);

ALTER TABLE assigned_to ADD COLUMN office_id UUID REFERENCES law_offices(office_id);
UPDATE assigned_to SET office_id = (SELECT office_id FROM law_offices LIMIT 1);
ALTER TABLE assigned_to ALTER COLUMN office_id SET NOT NULL;
ALTER TABLE assigned_to ADD FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id);
ALTER TABLE assigned_to ADD FOREIGN KEY (office_id, user_id) REFERENCES office_memberships(office_id, user_id);

ALTER TABLE notifications ADD COLUMN office_id UUID REFERENCES law_offices(office_id);
UPDATE notifications SET office_id = (SELECT office_id FROM law_offices LIMIT 1);
ALTER TABLE notifications ALTER COLUMN office_id SET NOT NULL;
ALTER TABLE notifications ADD FOREIGN KEY (office_id, user_id) REFERENCES office_memberships(office_id, user_id);

ALTER TABLE messages ADD COLUMN office_id UUID REFERENCES law_offices(office_id);
UPDATE messages SET office_id = (SELECT office_id FROM law_offices LIMIT 1);
ALTER TABLE messages ALTER COLUMN office_id SET NOT NULL;
ALTER TABLE messages ADD FOREIGN KEY (office_id, sender_user_id) REFERENCES office_memberships(office_id, user_id);
ALTER TABLE messages ADD FOREIGN KEY (office_id, receiver_user_id) REFERENCES office_memberships(office_id, user_id);
ALTER TABLE messages ADD FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id);

ALTER TABLE appointments ADD COLUMN office_id UUID REFERENCES law_offices(office_id);
UPDATE appointments SET office_id = (SELECT office_id FROM law_offices LIMIT 1);
ALTER TABLE appointments ALTER COLUMN office_id SET NOT NULL;
ALTER TABLE appointments ADD FOREIGN KEY (office_id, client_id) REFERENCES clients(office_id, client_id);
ALTER TABLE appointments ADD FOREIGN KEY (office_id, user_id) REFERENCES office_memberships(office_id, user_id);
ALTER TABLE appointments ADD FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id);

ALTER TABLE hearings ADD COLUMN office_id UUID REFERENCES law_offices(office_id);
UPDATE hearings SET office_id = (SELECT office_id FROM law_offices LIMIT 1);
ALTER TABLE hearings ALTER COLUMN office_id SET NOT NULL;
ALTER TABLE hearings ADD FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id);

ALTER TABLE tasks ADD COLUMN office_id UUID REFERENCES law_offices(office_id);
UPDATE tasks SET office_id = (SELECT office_id FROM law_offices LIMIT 1);
ALTER TABLE tasks ALTER COLUMN office_id SET NOT NULL;
ALTER TABLE tasks ADD FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id);
ALTER TABLE tasks ADD FOREIGN KEY (office_id, assigned_to_user_id) REFERENCES office_memberships(office_id, user_id);
ALTER TABLE tasks ADD FOREIGN KEY (office_id, created_by_user_id) REFERENCES office_memberships(office_id, user_id);

ALTER TABLE documents ADD COLUMN office_id UUID REFERENCES law_offices(office_id);
UPDATE documents SET office_id = (SELECT office_id FROM law_offices LIMIT 1);
ALTER TABLE documents ALTER COLUMN office_id SET NOT NULL;
ALTER TABLE documents ADD CONSTRAINT documents_office_document_key UNIQUE (office_id, document_id);
ALTER TABLE documents ADD FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id);
ALTER TABLE documents ADD FOREIGN KEY (office_id, client_id) REFERENCES clients(office_id, client_id);

ALTER TABLE audit_logs ADD COLUMN office_id UUID REFERENCES law_offices(office_id);
UPDATE audit_logs SET office_id = (SELECT office_id FROM law_offices LIMIT 1);

ALTER TABLE contracts ADD COLUMN office_id UUID REFERENCES law_offices(office_id);
UPDATE contracts SET office_id = (SELECT office_id FROM law_offices LIMIT 1);
ALTER TABLE contracts ALTER COLUMN office_id SET NOT NULL;
ALTER TABLE contracts ADD FOREIGN KEY (office_id, client_id) REFERENCES clients(office_id, client_id);
ALTER TABLE contracts ADD FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id);

-- invoices: invoice numbers are unique per office.
ALTER TABLE invoices ADD COLUMN office_id UUID REFERENCES law_offices(office_id);
UPDATE invoices SET office_id = (SELECT office_id FROM law_offices LIMIT 1);
ALTER TABLE invoices ALTER COLUMN office_id SET NOT NULL;
ALTER TABLE invoices DROP CONSTRAINT invoices_invoice_number_key;
ALTER TABLE invoices ADD CONSTRAINT invoices_office_invoice_key UNIQUE (office_id, invoice_id);
ALTER TABLE invoices ADD CONSTRAINT invoices_office_number_key UNIQUE (office_id, invoice_number);
ALTER TABLE invoices ADD FOREIGN KEY (office_id, client_id) REFERENCES clients(office_id, client_id);
ALTER TABLE invoices ADD FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id);

ALTER TABLE payments ADD COLUMN office_id UUID REFERENCES law_offices(office_id);
UPDATE payments SET office_id = (SELECT office_id FROM law_offices LIMIT 1);
ALTER TABLE payments ALTER COLUMN office_id SET NOT NULL;
ALTER TABLE payments ADD FOREIGN KEY (office_id, invoice_id) REFERENCES invoices(office_id, invoice_id);

ALTER TABLE case_notes ADD COLUMN office_id UUID REFERENCES law_offices(office_id);
UPDATE case_notes SET office_id = (SELECT office_id FROM law_offices LIMIT 1);
ALTER TABLE case_notes ALTER COLUMN office_id SET NOT NULL;
ALTER TABLE case_notes ADD FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id);

ALTER TABLE ai_interactions ADD COLUMN office_id UUID REFERENCES law_offices(office_id);
UPDATE ai_interactions SET office_id = (SELECT office_id FROM law_offices LIMIT 1);
ALTER TABLE ai_interactions ALTER COLUMN office_id SET NOT NULL;
ALTER TABLE ai_interactions ADD FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id);
ALTER TABLE ai_interactions ADD FOREIGN KEY (office_id, document_id) REFERENCES documents(office_id, document_id);

ALTER TABLE case_status_history ADD COLUMN office_id UUID REFERENCES law_offices(office_id);
UPDATE case_status_history SET office_id = (SELECT office_id FROM law_offices LIMIT 1);
ALTER TABLE case_status_history ALTER COLUMN office_id SET NOT NULL;
ALTER TABLE case_status_history ADD FOREIGN KEY (office_id, case_id) REFERENCES legal_cases(office_id, case_id);

CREATE INDEX idx_law_offices_status ON law_offices(status, created_at DESC);
CREATE INDEX idx_office_memberships_user ON office_memberships(user_id);
CREATE INDEX idx_office_invitations_office ON office_invitations(office_id, created_at DESC);
CREATE INDEX idx_office_invitations_email ON office_invitations(lower(email));
CREATE INDEX idx_clients_office ON clients(office_id);
CREATE INDEX idx_cases_office ON legal_cases(office_id, opened_at DESC);
