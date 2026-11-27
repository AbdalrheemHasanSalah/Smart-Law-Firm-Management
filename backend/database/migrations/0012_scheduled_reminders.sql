-- Scheduled reminders: hearings, tasks, appointments and expiring powers of attorney.
--
-- Every reminder has a key naming what it is about and when (for example
-- "hearing:<id>:day_before:<hearing time>"). A reminder is claimed by inserting its key for its
-- recipient before anything is sent, so a restart, an overlapping run or a second server never
-- sends it twice. A rescheduled hearing has a new time, hence a new key and new reminders.

CREATE TABLE IF NOT EXISTS reminder_deliveries (
    reminder_key VARCHAR(200) NOT NULL,
    user_id UUID NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
    office_id UUID NOT NULL REFERENCES law_offices(office_id) ON DELETE CASCADE,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (reminder_key, user_id)
);

CREATE INDEX IF NOT EXISTS idx_reminder_deliveries_sent ON reminder_deliveries(sent_at);

-- Each person may turn reminder emails off; the in-app notification is always kept.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email_reminders BOOLEAN NOT NULL DEFAULT TRUE;
