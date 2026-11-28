-- Voice messages (الرسائل الصوتية): a recording uploaded first, then attached to one message or
-- one case note. Who may hear it follows that message or note. A recording never attached is
-- removed after a day. Audio lives in private storage under a random key, like receipts.

CREATE TABLE IF NOT EXISTS voice_clips (
    clip_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    owner_user_id UUID NOT NULL REFERENCES app_users(user_id),
    storage_key TEXT NOT NULL UNIQUE,
    mime_type VARCHAR(30) NOT NULL CHECK (mime_type IN ('audio/webm', 'audio/ogg', 'audio/mp4')),
    duration_seconds SMALLINT NOT NULL CHECK (duration_seconds BETWEEN 1 AND 120),
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
    message_id UUID REFERENCES messages(message_id) ON DELETE CASCADE,
    note_id UUID REFERENCES case_notes(note_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT voice_clips_one_place_check CHECK (message_id IS NULL OR note_id IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_clips_message ON voice_clips(message_id) WHERE message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_clips_note ON voice_clips(note_id) WHERE note_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_voice_clips_unattached ON voice_clips(office_id, created_at)
    WHERE message_id IS NULL AND note_id IS NULL;
