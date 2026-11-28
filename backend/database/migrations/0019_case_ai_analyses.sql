-- Case analysis tools (تحليل القضية): each run of an AI tool on a case and its verified result.
-- The result keeps the real names (restored on the server); `redaction` records how many names,
-- ID numbers, phones and emails were replaced before the text was sent. Rows also count toward
-- the office's monthly AI allowance. `tasks_created_at` marks minutes whose actions became tasks.

CREATE TABLE IF NOT EXISTS case_ai_analyses (
    analysis_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    case_id UUID NOT NULL,
    tool VARCHAR(30) NOT NULL CHECK (tool IN (
        'argument', 'legal_question', 'gaps_defenses', 'document', 'appeal_grounds',
        'contract_review', 'judgment', 'brief_check', 'minutes', 'translate'
    )),
    question TEXT,
    target_language VARCHAR(2) CHECK (target_language IS NULL OR target_language IN ('en', 'he', 'fr')),
    model_name VARCHAR(100),
    provider VARCHAR(20),
    result JSONB NOT NULL,
    redaction JSONB NOT NULL DEFAULT '{}'::jsonb,
    tasks_created_at TIMESTAMPTZ,
    created_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT case_ai_analyses_case_fkey FOREIGN KEY (office_id, case_id)
        REFERENCES legal_cases(office_id, case_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_case_ai_analyses_case ON case_ai_analyses(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_ai_analyses_office_month ON case_ai_analyses(office_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_interactions_office_created ON ai_interactions(office_id, created_at);
