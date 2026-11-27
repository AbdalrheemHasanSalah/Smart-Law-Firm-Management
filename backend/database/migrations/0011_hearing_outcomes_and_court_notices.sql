-- Hearing outcomes, court notices (أوراق المحضرين) and appointment types.
--
-- Each hearing row is one entry of the case's session log. Recording its outcome stores who
-- attended and, for a postponement, why; the next session it was postponed to is a new hearing
-- row, linked from the postponed one through next_hearing_id.

ALTER TABLE hearings ADD COLUMN IF NOT EXISTS attended_by_user_id UUID;
ALTER TABLE hearings ADD COLUMN IF NOT EXISTS postponement_reason TEXT;
ALTER TABLE hearings ADD COLUMN IF NOT EXISTS next_hearing_id UUID REFERENCES hearings(hearing_id) ON DELETE SET NULL;
ALTER TABLE hearings ADD COLUMN IF NOT EXISTS outcome_recorded_at TIMESTAMPTZ;
ALTER TABLE hearings ADD COLUMN IF NOT EXISTS outcome_recorded_by_user_id UUID REFERENCES app_users(user_id);

ALTER TABLE hearings DROP CONSTRAINT IF EXISTS hearings_attended_by_member_fkey;
ALTER TABLE hearings ADD CONSTRAINT hearings_attended_by_member_fkey
    FOREIGN KEY (office_id, attended_by_user_id) REFERENCES office_memberships(office_id, user_id);

CREATE INDEX IF NOT EXISTS idx_hearings_office_date ON hearings(office_id, hearing_at);

-- Appointments now have a type. A client meeting still needs a client; an expert session, a
-- court visit or anything else may have none.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS appointment_type VARCHAR(20) NOT NULL DEFAULT 'meeting';
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_type_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_type_check
    CHECK (appointment_type IN ('meeting', 'expert_session', 'court_visit', 'other'));
ALTER TABLE appointments ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_meeting_client_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_meeting_client_check
    CHECK (appointment_type <> 'meeting' OR client_id IS NOT NULL);

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

CREATE INDEX IF NOT EXISTS idx_court_notices_case ON court_notices(case_id, sent_on DESC);
CREATE INDEX IF NOT EXISTS idx_court_notices_office_sent ON court_notices(office_id, sent_on);
