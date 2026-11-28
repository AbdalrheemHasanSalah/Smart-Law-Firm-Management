-- Security and roles (المرحلة 8).
--
--   roles                        three more office roles: accountant, data_entry, print_only
--   office_memberships           per-member permissions granted or revoked on top of the role
--   sign_in_lockouts             failed sign-ins per email address, and the temporary lock after
--                                five of them (by address, so locking says nothing about accounts)
--   audit_logs                   a hash chain per office: each entry keeps the hash of the one before,
--                                so a changed or removed entry breaks the chain. Entries written
--                                before this migration stay outside the chain. Rows can no longer be
--                                updated or deleted.

INSERT INTO roles (role_name, description) VALUES
    ('accountant', 'Office accountant: finance, read-only cases and clients'),
    ('data_entry', 'Data entry: clients, cases, documents and schedule, without finance or deleting'),
    ('print_only', 'Print only: reads cases and documents and prints them')
ON CONFLICT (role_name) DO NOTHING;

ALTER TABLE office_memberships ADD COLUMN IF NOT EXISTS permissions_granted TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE office_memberships ADD COLUMN IF NOT EXISTS permissions_revoked TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS sign_in_lockouts (
    email VARCHAR(255) PRIMARY KEY,
    failed_count INTEGER NOT NULL DEFAULT 0,
    lock_level INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_failed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS chain_seq BIGINT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS prev_hash CHAR(64);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entry_hash CHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_logs_chain ON audit_logs(office_id, chain_seq) WHERE chain_seq IS NOT NULL;

-- The hash of one entry: the previous hash and every field of the entry, in a fixed text form.
CREATE OR REPLACE FUNCTION audit_entry_hash(
    p_prev CHAR(64), p_seq BIGINT, p_office UUID, p_user UUID, p_action TEXT, p_entity_type TEXT,
    p_entity UUID, p_details JSONB, p_ip INET, p_created TIMESTAMPTZ
) RETURNS CHAR(64) AS $$
    SELECT encode(sha256(convert_to(concat_ws('|',
        p_prev, p_seq::text, COALESCE(p_office::text, ''), COALESCE(p_user::text, ''), p_action, p_entity_type,
        COALESCE(p_entity::text, ''), COALESCE(p_details::text, 'null'), COALESCE(host(p_ip), ''),
        to_char(p_created AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
    ), 'UTF8')), 'hex');
$$ LANGUAGE sql IMMUTABLE;

-- Every new entry joins its office's chain (the platform's entries, without an office, form one
-- chain of their own). The lock keeps two writers of the same office from taking the same place.
CREATE OR REPLACE FUNCTION audit_logs_chain() RETURNS trigger AS $$
DECLARE
    previous RECORD;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('audit_logs:' || COALESCE(NEW.office_id::text, 'platform'), 0));
    SELECT chain_seq, entry_hash INTO previous
      FROM audit_logs
     WHERE office_id IS NOT DISTINCT FROM NEW.office_id AND chain_seq IS NOT NULL
     ORDER BY chain_seq DESC
     LIMIT 1;
    NEW.created_at := COALESCE(NEW.created_at, NOW());
    NEW.chain_seq := COALESCE(previous.chain_seq, 0) + 1;
    NEW.prev_hash := COALESCE(previous.entry_hash, repeat('0', 64));
    NEW.entry_hash := audit_entry_hash(NEW.prev_hash, NEW.chain_seq, NEW.office_id, NEW.user_id, NEW.action,
        NEW.entity_type, NEW.entity_id, NEW.details, NEW.ip_address, NEW.created_at);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_chain ON audit_logs;
CREATE TRIGGER audit_logs_chain BEFORE INSERT ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_chain();

CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_no_change ON audit_logs;
CREATE TRIGGER audit_logs_no_change BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
