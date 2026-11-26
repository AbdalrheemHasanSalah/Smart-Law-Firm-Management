-- Private tasks: a staff member's own to-do items, kept apart from the tasks the office assigns.
-- A private task belongs to the person who wrote it, is assigned to them alone, and is tied to no
-- case, so it never shows up in a case file, a hearing-preparation sheet, or anyone else's list.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_private_owner_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_private_owner_check
    CHECK (NOT is_private OR (assigned_to_user_id = created_by_user_id AND case_id IS NULL));

CREATE INDEX IF NOT EXISTS idx_tasks_private_owner ON tasks(created_by_user_id) WHERE is_private;
