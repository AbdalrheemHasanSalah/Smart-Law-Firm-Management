-- Marks when a platform administrator first opened an office's registration request, so the
-- platform's "new requests" count drops as requests are read, not only when they are decided.
-- Offices that already have a decision count as seen.

ALTER TABLE law_offices
    ADD COLUMN IF NOT EXISTS platform_seen_at TIMESTAMPTZ;

UPDATE law_offices
   SET platform_seen_at = COALESCE(reviewed_at, NOW())
 WHERE status <> 'pending';
