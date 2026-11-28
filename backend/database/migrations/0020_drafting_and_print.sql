-- Drafting and the unified print engine (الصياغة والطباعة).
--
--   office_letterheads   what every printed page carries: logo, office lines, footer
--   document_templates   the office's own templates (built-in skeletons live in the code)
--   case_drafts          contracts, pleadings and letters drafted on a case; a finalized draft is
--                        frozen, fingerprinted and kept as one of the case's documents
--   issued_documents     every printed document's fingerprint and short verification code, so
--                        anyone holding the paper can check that the office issued it

CREATE TABLE IF NOT EXISTS office_letterheads (
    office_id UUID PRIMARY KEY REFERENCES law_offices(office_id),
    display_name VARCHAR(200),
    subtitle VARCHAR(200),
    address TEXT,
    phone VARCHAR(60),
    email VARCHAR(254),
    license_number VARCHAR(100),
    footer_text VARCHAR(500),
    logo_key TEXT UNIQUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_templates (
    template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('contract', 'pleading', 'letter', 'other')),
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT document_templates_office_key UNIQUE (office_id, template_id)
);

CREATE TABLE IF NOT EXISTS case_drafts (
    draft_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    case_id UUID NOT NULL,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('contract', 'pleading', 'letter', 'other')),
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    -- Where it started: a built-in skeleton, an office template, the AI, or a blank page.
    source VARCHAR(20) NOT NULL CHECK (source IN ('builtin', 'template', 'ai', 'blank')),
    source_ref VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final', 'revoked')),
    finalized_at TIMESTAMPTZ,
    finalized_by_user_id UUID REFERENCES app_users(user_id),
    revoked_at TIMESTAMPTZ,
    created_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT case_drafts_office_key UNIQUE (office_id, draft_id),
    CONSTRAINT case_drafts_case_fkey FOREIGN KEY (office_id, case_id)
        REFERENCES legal_cases(office_id, case_id) ON DELETE CASCADE,
    CONSTRAINT case_drafts_final_check CHECK ((status = 'draft') = (finalized_at IS NULL)),
    CONSTRAINT case_drafts_revoked_check CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

-- The verification code is short enough to type from paper: 10 characters with no 0/O or 1/I.
CREATE TABLE IF NOT EXISTS issued_documents (
    issued_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    code VARCHAR(12) NOT NULL UNIQUE,
    kind VARCHAR(30) NOT NULL CHECK (kind IN (
        'contract', 'pleading', 'letter', 'other', 'statement', 'hearing_prep', 'analysis', 'invoice', 'report'
    )),
    content_sha256 CHAR(64) NOT NULL,
    draft_id UUID,
    issued_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    CONSTRAINT issued_documents_draft_fkey FOREIGN KEY (office_id, draft_id)
        REFERENCES case_drafts(office_id, draft_id) ON DELETE SET NULL (draft_id)
);

CREATE INDEX IF NOT EXISTS idx_document_templates_office ON document_templates(office_id, kind) WHERE NOT is_archived;
CREATE INDEX IF NOT EXISTS idx_case_drafts_case ON case_drafts(case_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_drafts_office_source ON case_drafts(office_id, created_at) WHERE source = 'ai';
CREATE INDEX IF NOT EXISTS idx_issued_documents_office ON issued_documents(office_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_issued_documents_draft ON issued_documents(draft_id) WHERE draft_id IS NOT NULL;
