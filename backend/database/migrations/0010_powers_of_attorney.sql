-- Powers of attorney (التوكيلات): the authority a client gives the office's lawyers to act for them.
-- A power of attorney belongs to one client, names the lawyers it authorizes, and may cover one
-- or more of that client's cases. "Expired" is not stored: it follows from expires_on, so a
-- stored status is only ever 'active' or 'revoked'. The scan, when attached, lives in private
-- storage under a random key, like payment receipts.

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

CREATE INDEX IF NOT EXISTS idx_powers_of_attorney_client ON powers_of_attorney(client_id);
CREATE INDEX IF NOT EXISTS idx_powers_of_attorney_office_expiry ON powers_of_attorney(office_id, expires_on)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_power_of_attorney_lawyers_user ON power_of_attorney_lawyers(user_id);
CREATE INDEX IF NOT EXISTS idx_power_of_attorney_cases_case ON power_of_attorney_cases(case_id);
