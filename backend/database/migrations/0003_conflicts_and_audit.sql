-- Conflict-of-interest checks and the office activity log.
--
-- * clients.national_id: the ID or company registration number, matched exactly by the check.
-- * case_opponents: the opposing parties of each case. A conflict check compares a new client
--   with these (and a new opponent with the office's clients).
-- * An index so an office reads its own activity log quickly. audit_logs itself already exists.
-- Like 0001 and 0002, this file has no IF NOT EXISTS clauses: re-running it fails instead of
-- silently skipping. Review it before applying (see README.md).

ALTER TABLE clients
    ADD COLUMN national_id VARCHAR(30);

CREATE INDEX idx_clients_office_national_id
    ON clients (office_id, national_id)
    WHERE national_id IS NOT NULL;

CREATE TABLE case_opponents (
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

CREATE INDEX idx_case_opponents_case
    ON case_opponents (case_id);

CREATE INDEX idx_case_opponents_office
    ON case_opponents (office_id);

CREATE INDEX idx_audit_logs_office_created
    ON audit_logs (office_id, created_at DESC);
