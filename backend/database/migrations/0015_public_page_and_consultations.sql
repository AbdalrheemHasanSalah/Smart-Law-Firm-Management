-- The office's public page and the consultation requests it receives.
--
-- A page is reached at /o/<slug> once the administrator publishes it. It shows the office's name
-- and contact details, what the administrator writes about it, and the lawyers they chose to list.
-- Visitors' consultation requests land in the office's inbox; the administrator may assign one to
-- a lawyer, and turns it into a client when the visitor becomes one.

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

ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS show_on_public_page BOOLEAN NOT NULL DEFAULT FALSE;

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

CREATE INDEX IF NOT EXISTS idx_consultation_requests_office ON consultation_requests(office_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consultation_requests_assignee ON consultation_requests(assigned_to_user_id)
    WHERE assigned_to_user_id IS NOT NULL;
