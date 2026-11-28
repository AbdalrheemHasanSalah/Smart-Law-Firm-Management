-- The professional directory and the communication center (المرحلة 7).
--
--   courts                         one shared list of courts kept by the platform admin; this adds
--                                  the city, phone, address and working hours to the existing table
--   court_office_notes             an office's own note on a court (a clerk's name, where to park…)
--   colleagues                     lawyers from other offices, kept by each office for itself
--   colleague_message_templates    the office's own message templates to colleagues; the ready ones
--                                  live in the code. Messages are never sent by the system: they
--                                  open prefilled in WhatsApp or the mail app.

ALTER TABLE courts ADD COLUMN IF NOT EXISTS city VARCHAR(80);
ALTER TABLE courts ADD COLUMN IF NOT EXISTS phone VARCHAR(40);
ALTER TABLE courts ADD COLUMN IF NOT EXISTS email VARCHAR(150);
ALTER TABLE courts ADD COLUMN IF NOT EXISTS working_hours VARCHAR(150);
ALTER TABLE courts ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE courts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE courts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS court_office_notes (
    office_id UUID NOT NULL REFERENCES law_offices(office_id) ON DELETE CASCADE,
    court_id UUID NOT NULL REFERENCES courts(court_id) ON DELETE CASCADE,
    note VARCHAR(1000) NOT NULL,
    updated_by_user_id UUID REFERENCES app_users(user_id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (office_id, court_id)
);

CREATE TABLE IF NOT EXISTS colleagues (
    colleague_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id) ON DELETE CASCADE,
    full_name VARCHAR(150) NOT NULL,
    bar_number VARCHAR(40),
    phone VARCHAR(40),
    email VARCHAR(150),
    city VARCHAR(80),
    office_name VARCHAR(150),
    notes VARCHAR(1000),
    created_by_user_id UUID REFERENCES app_users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS colleague_message_templates (
    template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id) ON DELETE CASCADE,
    title VARCHAR(120) NOT NULL,
    body VARCHAR(3000) NOT NULL,
    created_by_user_id UUID REFERENCES app_users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_courts_city ON courts(city, name);
CREATE INDEX IF NOT EXISTS idx_colleagues_office ON colleagues(office_id, full_name);
CREATE INDEX IF NOT EXISTS idx_colleague_templates_office ON colleague_message_templates(office_id, title);
