-- The office owner's personal email, optional. The office email (law_offices.email, also the
-- owner's sign-in address) stays the one the site writes to.
ALTER TABLE law_offices ADD COLUMN IF NOT EXISTS personal_email VARCHAR(254);
