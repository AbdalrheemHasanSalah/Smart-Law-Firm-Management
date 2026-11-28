-- Legal library (المكتبة القانونية): legislation, rulings and the Palestinian Official Gazette
-- (الوقائع الفلسطينية), shared by every office and read only for them, plus each office's own
-- saved items, adopted principles and the references linked to its cases.
--
-- Reference rows are imported by the platform admin from files; nothing is written by hand.
-- Each imported record carries a stable `source_key` from its file, so importing the same file
-- again updates rows instead of duplicating them.
--
-- Search uses PostgreSQL full-text search with the 'simple' configuration over text normalized
-- by legal_normalize() (one spelling for hamza forms, taa marbuta, alef maqsura, Latin digits,
-- no diacritics or tatweel). The same rules are in backend/src/services/legalText.js. Each word is also indexed without its leading clitics (و ف ب ل ك ال), so
-- "والإيجار" and "إيجار" meet. No extension is needed.

CREATE OR REPLACE FUNCTION legal_normalize(input TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT regexp_replace(
        translate(COALESCE(input, ''), 'أإآٱىةؤئ٠١٢٣٤٥٦٧٨٩', 'اااايهوي0123456789'),
        '[ً-ْٰـ]', '', 'g'
    )
$$;

-- The normalized text, then each word again without its leading clitics when 3+ letters remain.
CREATE OR REPLACE FUNCTION legal_search_text(input TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT legal_normalize(input) || ' ' || regexp_replace(
        legal_normalize(input),
        '(^|[^ء-يa-zA-Z0-9])(وال|بال|كال|فال|لل|ال|و|ف|ب|ل|ك)([ء-ي]{3,})',
        '\1\3',
        'g'
    )
$$;

CREATE TABLE IF NOT EXISTS gazette_issues (
    issue_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key VARCHAR(120) NOT NULL UNIQUE,
    issue_number INTEGER NOT NULL CHECK (issue_number > 0),
    published_on DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS legal_laws (
    law_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key VARCHAR(120) NOT NULL UNIQUE,
    jurisdiction VARCHAR(2) NOT NULL CHECK (jurisdiction IN ('ps', 'jo', 'eg')),
    law_kind VARCHAR(20) NOT NULL
        CHECK (law_kind IN ('law', 'decree_law', 'regulation', 'decree', 'decision', 'order', 'other')),
    title VARCHAR(500) NOT NULL,
    law_number VARCHAR(40),
    law_year SMALLINT CHECK (law_year BETWEEN 1800 AND 2200),
    status VARCHAR(20) NOT NULL DEFAULT 'in_force' CHECK (status IN ('in_force', 'amended', 'repealed')),
    status_note TEXT,
    published_on DATE,
    gazette_issue_id UUID REFERENCES gazette_issues(issue_id) ON DELETE SET NULL,
    source_url TEXT,
    search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', legal_search_text(title))) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS legal_articles (
    article_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    law_id UUID NOT NULL REFERENCES legal_laws(law_id) ON DELETE CASCADE,
    article_number VARCHAR(40) NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    body TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'in_force' CHECK (status IN ('in_force', 'amended', 'repealed')),
    note TEXT,
    search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', legal_search_text(body))) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT legal_articles_law_number_key UNIQUE (law_id, article_number)
);

CREATE TABLE IF NOT EXISTS legal_rulings (
    ruling_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key VARCHAR(120) NOT NULL UNIQUE,
    jurisdiction VARCHAR(2) NOT NULL CHECK (jurisdiction IN ('ps', 'jo', 'eg')),
    court_level VARCHAR(20) NOT NULL
        CHECK (court_level IN ('cassation', 'high', 'constitutional', 'appeal', 'first_instance', 'magistrate', 'other')),
    court_name VARCHAR(200),
    case_number VARCHAR(60),
    ruling_year SMALLINT CHECK (ruling_year BETWEEN 1800 AND 2200),
    decided_on DATE,
    subject VARCHAR(500),
    summary TEXT,
    body TEXT NOT NULL,
    search_vector TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', legal_search_text(COALESCE(subject, '') || ' ' || COALESCE(summary, ''))), 'A')
        || setweight(to_tsvector('simple', legal_search_text(body)), 'D')
    ) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The articles a ruling applied.
CREATE TABLE IF NOT EXISTS legal_ruling_articles (
    ruling_id UUID NOT NULL REFERENCES legal_rulings(ruling_id) ON DELETE CASCADE,
    article_id UUID NOT NULL REFERENCES legal_articles(article_id) ON DELETE CASCADE,
    PRIMARY KEY (ruling_id, article_id)
);

-- What each Gazette issue published, in order. `law_id` links an item to an imported law.
CREATE TABLE IF NOT EXISTS gazette_issue_items (
    issue_id UUID NOT NULL REFERENCES gazette_issues(issue_id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    title VARCHAR(500) NOT NULL,
    law_id UUID REFERENCES legal_laws(law_id) ON DELETE SET NULL,
    PRIMARY KEY (issue_id, position)
);

-- Everyday wording mapped to legal terms: "انطرد من الشغل" → {"فصل تعسفي"}. Phrases are stored
-- normalized, so a search matches them however hamza or taa marbuta were typed.
CREATE TABLE IF NOT EXISTS legal_synonyms (
    phrase VARCHAR(200) PRIMARY KEY,
    terms TEXT[] NOT NULL CHECK (cardinality(terms) BETWEEN 1 AND 10),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per import run, dry runs excluded, for the platform admin's history.
CREATE TABLE IF NOT EXISTS legal_library_imports (
    import_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name VARCHAR(200),
    summary JSONB NOT NULL,
    imported_by_user_id UUID REFERENCES app_users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- An article or ruling an office saved, with its note and tags.
CREATE TABLE IF NOT EXISTS office_library_items (
    item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    article_id UUID REFERENCES legal_articles(article_id) ON DELETE CASCADE,
    ruling_id UUID REFERENCES legal_rulings(ruling_id) ON DELETE CASCADE,
    note TEXT,
    tags TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 10),
    created_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT office_library_items_office_key UNIQUE (office_id, item_id),
    CONSTRAINT office_library_items_target_check CHECK ((article_id IS NULL) <> (ruling_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_office_library_items_article
    ON office_library_items(office_id, article_id) WHERE article_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_office_library_items_ruling
    ON office_library_items(office_id, ruling_id) WHERE ruling_id IS NOT NULL;

-- Principles the office adopts, in its own words.
CREATE TABLE IF NOT EXISTS office_legal_principles (
    principle_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL REFERENCES law_offices(office_id),
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 10),
    created_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT office_legal_principles_office_key UNIQUE (office_id, principle_id)
);

-- An article or ruling linked to one of the office's cases.
CREATE TABLE IF NOT EXISTS case_legal_references (
    reference_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id UUID NOT NULL,
    case_id UUID NOT NULL,
    article_id UUID REFERENCES legal_articles(article_id) ON DELETE CASCADE,
    ruling_id UUID REFERENCES legal_rulings(ruling_id) ON DELETE CASCADE,
    note TEXT,
    linked_by_user_id UUID NOT NULL REFERENCES app_users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT case_legal_references_target_check CHECK ((article_id IS NULL) <> (ruling_id IS NULL)),
    CONSTRAINT case_legal_references_case_fkey FOREIGN KEY (office_id, case_id)
        REFERENCES legal_cases(office_id, case_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_case_legal_references_article
    ON case_legal_references(case_id, article_id) WHERE article_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_case_legal_references_ruling
    ON case_legal_references(case_id, ruling_id) WHERE ruling_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_legal_laws_search ON legal_laws USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_legal_laws_browse ON legal_laws(jurisdiction, law_year DESC);
CREATE INDEX IF NOT EXISTS idx_legal_laws_gazette ON legal_laws(gazette_issue_id) WHERE gazette_issue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_legal_articles_search ON legal_articles USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_legal_articles_law_position ON legal_articles(law_id, position);
CREATE INDEX IF NOT EXISTS idx_legal_rulings_search ON legal_rulings USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_legal_rulings_browse ON legal_rulings(jurisdiction, decided_on DESC);
CREATE INDEX IF NOT EXISTS idx_legal_ruling_articles_article ON legal_ruling_articles(article_id);
CREATE INDEX IF NOT EXISTS idx_gazette_issues_published ON gazette_issues(published_on DESC);
CREATE INDEX IF NOT EXISTS idx_office_library_items_office ON office_library_items(office_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_office_legal_principles_office ON office_legal_principles(office_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_legal_references_case ON case_legal_references(case_id, created_at DESC);
