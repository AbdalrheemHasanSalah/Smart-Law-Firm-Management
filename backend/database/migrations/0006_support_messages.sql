-- Messages to the platform's management, sent from the site's support chat by visitors and users.
--
-- A message keeps the chat that led to it (transcript), who sent it (and their account and office
-- when they were signed in), and the platform owner's handling: status and reply.
-- Like the earlier migrations, this file has no IF NOT EXISTS clauses. Review it before applying.

CREATE TABLE support_messages (
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

CREATE INDEX idx_support_messages_status_created
    ON support_messages (status, created_at DESC);
