-- Client portal upgrades (المرحلة 5).
--
--   shared_files        files a client sends to the office (from the portal or in a chat) and
--                       chat attachments from staff; staff move a client's file into the case
--                       documents with one click (a photo is wrapped in a PDF page)
--   push_subscriptions  each signed-in device that accepted push notifications
--   official_notices    a hearing date, a judgment or another notice sent to a client, which the
--                       client acknowledges in the portal
--   notice_deliveries   what happened on each channel of a notice: portal, push, email, WhatsApp

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

CREATE INDEX IF NOT EXISTS idx_shared_files_case_new ON shared_files(case_id, created_at DESC) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shared_files_client ON shared_files(client_id, created_at DESC) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shared_files_message ON shared_files(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shared_files_unattached ON shared_files(office_id, created_at)
    WHERE purpose = 'message' AND message_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_official_notices_case ON official_notices(case_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_official_notices_client ON official_notices(client_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notice_deliveries_notice ON notice_deliveries(notice_id, recorded_at);
