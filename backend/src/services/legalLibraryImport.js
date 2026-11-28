import { pool, query } from '../config/db.js';
import { normalizeArabic } from './legalText.js';

/**
 * Imports legislation, rulings, Official Gazette issues and synonyms into the shared legal
 * library, from a JSON file the platform admin uploads. The format is documented in
 * backend/database/legal-library-import.md, with an example next to it.
 *
 * - The whole file is checked first; any error rejects it with every problem listed by path
 *   ("laws[3].articles[12].number"), and nothing is written.
 * - The import runs in one transaction under an advisory lock: all of the file or none of it,
 *   one import at a time.
 * - Each law, ruling and issue has a stable `key`. Importing a key again updates that record;
 *   articles are matched by their number within the law. Articles already stored but missing
 *   from the file are kept (and counted), so saved items and case links never vanish.
 * - A dry run does all of it and rolls back, so the preview counts are what the import would do.
 * - A ruling's link to an article that is neither in the file nor stored is skipped with a
 *   warning, not an error.
 */

const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{1,119}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const JURISDICTIONS = ['ps', 'jo', 'eg'];
const LAW_KINDS = ['law', 'decree_law', 'regulation', 'decree', 'decision', 'order', 'other'];
const STATUSES = ['in_force', 'amended', 'repealed'];
const COURT_LEVELS = ['cassation', 'high', 'constitutional', 'appeal', 'first_instance', 'magistrate', 'other'];
const LIMITS = { laws: 2000, articlesPerLaw: 3000, rulings: 5000, gazette: 2000, itemsPerIssue: 500, synonyms: 5000, rulingArticles: 100 };
const MAX_ERRORS = 50;
const MAX_WARNINGS = 100;
const IMPORT_LOCK = 'legal_library_import';

export class LegalImportError extends Error {
  constructor(status, message, publicCode, errors) {
    super(message);
    this.name = 'LegalImportError';
    this.status = status;
    if (publicCode) this.publicCode = publicCode;
    if (errors) this.errors = errors;
  }
}

/* ───────────────────────── validation ───────────────────────── */

function createChecker() {
  const errors = [];
  const add = (path, message) => {
    if (errors.length < MAX_ERRORS) errors.push({ path, message });
  };
  const text = (value, path, { max, required = false }) => {
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      if (required) add(path, 'is required');
      return null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
    if (typeof value !== 'string') {
      add(path, 'must be text');
      return null;
    }
    const trimmed = value.trim();
    if (trimmed.length > max) add(path, `must be at most ${max} characters`);
    return trimmed;
  };
  const choice = (value, path, allowed, fallback) => {
    if (value === undefined || value === null) {
      if (fallback === undefined) add(path, `is required (${allowed.join(', ')})`);
      return fallback ?? null;
    }
    if (!allowed.includes(value)) add(path, `must be one of ${allowed.join(', ')}`);
    return value;
  };
  const date = (value, path) => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = typeof value === 'string' && DATE.test(value) ? new Date(`${value}T00:00:00Z`) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      add(path, 'must be a date as YYYY-MM-DD');
      return null;
    }
    return value;
  };
  const year = (value, path) => {
    if (value === undefined || value === null || value === '') return null;
    const number = typeof value === 'string' ? Number(value) : value;
    if (!Number.isInteger(number) || number < 1800 || number > 2200) {
      add(path, 'must be a year between 1800 and 2200');
      return null;
    }
    return number;
  };
  const key = (value, path) => {
    if (typeof value !== 'string' || !KEY.test(value)) {
      add(path, 'must be 2–120 letters, digits, dots, dashes or underscores');
      return null;
    }
    return value;
  };
  const list = (value, path, max, { required = false } = {}) => {
    if (value === undefined || value === null) {
      if (required) add(path, 'is required');
      return [];
    }
    if (!Array.isArray(value)) {
      add(path, 'must be a list');
      return [];
    }
    if (value.length > max) add(path, `must have at most ${max} entries`);
    return value.slice(0, max);
  };
  const object = (value, path) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      add(path, 'must be an object');
      return null;
    }
    return value;
  };
  return { errors, add, text, choice, date, year, key, list, object };
}

const unique = (check, seen, value, path, what) => {
  if (value === null) return;
  if (seen.has(value)) check.add(path, `repeats the ${what} "${value}"`);
  seen.add(value);
};

/** Checks the whole file and returns it in a clean shape; throws with every problem found. */
export function validateImport(payload) {
  const check = createChecker();
  const root = check.object(payload, '$');
  if (!root) throw new LegalImportError(400, 'The file is not a valid import.', 'IMPORT_INVALID', check.errors);
  const allowed = ['laws', 'rulings', 'gazette', 'synonyms', 'format'];
  for (const field of Object.keys(root)) if (!allowed.includes(field)) check.add(field, 'is not a known section');

  const gazetteKeys = new Set();
  const gazette = check.list(root.gazette, 'gazette', LIMITS.gazette).map((entry, index) => {
    const path = `gazette[${index}]`;
    const issue = check.object(entry, path) ?? {};
    const issueKey = check.key(issue.key, `${path}.key`);
    unique(check, gazetteKeys, issueKey, `${path}.key`, 'key');
    const number = Number(issue.number);
    if (!Number.isInteger(number) || number < 1) check.add(`${path}.number`, 'must be a positive whole number');
    return {
      key: issueKey,
      number,
      publishedOn: check.date(issue.publishedOn, `${path}.publishedOn`),
      items: check.list(issue.items, `${path}.items`, LIMITS.itemsPerIssue).map((raw, itemIndex) => {
        const itemPath = `${path}.items[${itemIndex}]`;
        const item = check.object(raw, itemPath) ?? {};
        return {
          title: check.text(item.title, `${itemPath}.title`, { max: 500, required: true }),
          law: item.law === undefined || item.law === null ? null : check.key(item.law, `${itemPath}.law`),
        };
      }),
    };
  });

  const lawKeys = new Set();
  const laws = check.list(root.laws, 'laws', LIMITS.laws).map((entry, index) => {
    const path = `laws[${index}]`;
    const law = check.object(entry, path) ?? {};
    const lawKey = check.key(law.key, `${path}.key`);
    unique(check, lawKeys, lawKey, `${path}.key`, 'key');
    const numbers = new Set();
    const sourceUrl = check.text(law.sourceUrl, `${path}.sourceUrl`, { max: 1000 });
    if (sourceUrl && !/^https?:\/\/\S+$/i.test(sourceUrl)) check.add(`${path}.sourceUrl`, 'must be an http(s) address');
    return {
      key: lawKey,
      jurisdiction: check.choice(law.jurisdiction, `${path}.jurisdiction`, JURISDICTIONS),
      kind: check.choice(law.kind, `${path}.kind`, LAW_KINDS, 'law'),
      title: check.text(law.title, `${path}.title`, { max: 500, required: true }),
      number: check.text(law.number, `${path}.number`, { max: 40 }),
      year: check.year(law.year, `${path}.year`),
      status: check.choice(law.status, `${path}.status`, STATUSES, 'in_force'),
      statusNote: check.text(law.statusNote, `${path}.statusNote`, { max: 2000 }),
      publishedOn: check.date(law.publishedOn, `${path}.publishedOn`),
      gazetteIssue: law.gazetteIssue === undefined || law.gazetteIssue === null ? null : check.key(law.gazetteIssue, `${path}.gazetteIssue`),
      sourceUrl,
      articles: check.list(law.articles, `${path}.articles`, LIMITS.articlesPerLaw).map((raw, articleIndex) => {
        const articlePath = `${path}.articles[${articleIndex}]`;
        const article = check.object(raw, articlePath) ?? {};
        const number = check.text(article.number, `${articlePath}.number`, { max: 40, required: true });
        unique(check, numbers, number, `${articlePath}.number`, 'article number');
        return {
          number,
          position: articleIndex,
          text: check.text(article.text, `${articlePath}.text`, { max: 100_000, required: true }),
          status: check.choice(article.status, `${articlePath}.status`, STATUSES, 'in_force'),
          note: check.text(article.note, `${articlePath}.note`, { max: 2000 }),
        };
      }),
    };
  });

  const rulingKeys = new Set();
  const rulings = check.list(root.rulings, 'rulings', LIMITS.rulings).map((entry, index) => {
    const path = `rulings[${index}]`;
    const ruling = check.object(entry, path) ?? {};
    const rulingKey = check.key(ruling.key, `${path}.key`);
    unique(check, rulingKeys, rulingKey, `${path}.key`, 'key');
    return {
      key: rulingKey,
      jurisdiction: check.choice(ruling.jurisdiction, `${path}.jurisdiction`, JURISDICTIONS),
      court: check.choice(ruling.court, `${path}.court`, COURT_LEVELS),
      courtName: check.text(ruling.courtName, `${path}.courtName`, { max: 200 }),
      caseNumber: check.text(ruling.caseNumber, `${path}.caseNumber`, { max: 60 }),
      year: check.year(ruling.year, `${path}.year`),
      decidedOn: check.date(ruling.decidedOn, `${path}.decidedOn`),
      subject: check.text(ruling.subject, `${path}.subject`, { max: 500 }),
      summary: check.text(ruling.summary, `${path}.summary`, { max: 20_000 }),
      text: check.text(ruling.text, `${path}.text`, { max: 500_000, required: true }),
      articles: check.list(ruling.articles, `${path}.articles`, LIMITS.rulingArticles).map((raw, refIndex) => {
        const refPath = `${path}.articles[${refIndex}]`;
        const ref = check.object(raw, refPath) ?? {};
        return { law: check.key(ref.law, `${refPath}.law`), number: check.text(ref.number, `${refPath}.number`, { max: 40, required: true }) };
      }),
    };
  });

  const phrases = new Set();
  const synonyms = check.list(root.synonyms, 'synonyms', LIMITS.synonyms).map((entry, index) => {
    const path = `synonyms[${index}]`;
    const synonym = check.object(entry, path) ?? {};
    const raw = check.text(synonym.phrase, `${path}.phrase`, { max: 200, required: true });
    const phrase = raw ? normalizeArabic(raw).toLowerCase() : null;
    if (phrase !== null && phrase.length < 2) check.add(`${path}.phrase`, 'must be at least 2 characters');
    unique(check, phrases, phrase, `${path}.phrase`, 'phrase');
    const terms = check.list(synonym.terms, `${path}.terms`, 10, { required: true })
      .map((term, termIndex) => check.text(term, `${path}.terms[${termIndex}]`, { max: 200, required: true }))
      .filter(Boolean);
    if (terms.length === 0 && Array.isArray(synonym.terms)) check.add(`${path}.terms`, 'must have at least one term');
    return { phrase, terms };
  });

  if (laws.length + rulings.length + gazette.length + synonyms.length === 0) check.add('$', 'has nothing to import');
  if (check.errors.length) throw new LegalImportError(400, 'The file has errors.', 'IMPORT_INVALID', check.errors);
  return { laws, rulings, gazette, synonyms };
}

/* ───────────────────────── import ───────────────────────── */

const counter = () => ({ added: 0, updated: 0 });
const tally = (count, rows) => {
  for (const row of rows) count[row.inserted ? 'added' : 'updated'] += 1;
};

/** Record ids for keys: from this file first, then from what is stored. */
async function idsByKey(db, table, idColumn, keys, known) {
  const missing = [...new Set(keys)].filter((key) => key && !known.has(key));
  if (missing.length) {
    const found = await db.query(`SELECT source_key, ${idColumn} AS id FROM ${table} WHERE source_key = ANY($1::text[])`, [missing]);
    for (const row of found.rows) known.set(row.source_key, row.id);
  }
  return known;
}

async function importGazette(db, issues, summary) {
  const ids = new Map();
  for (const issue of issues) {
    const result = await db.query(
      `INSERT INTO gazette_issues (source_key, issue_number, published_on)
       VALUES ($1, $2, $3)
       ON CONFLICT (source_key) DO UPDATE
         SET issue_number = EXCLUDED.issue_number, published_on = EXCLUDED.published_on, updated_at = NOW()
       RETURNING issue_id, (xmax = 0) AS inserted`,
      [issue.key, issue.number, issue.publishedOn]
    );
    ids.set(issue.key, result.rows[0].issue_id);
    tally(summary.gazette, result.rows);
  }
  return ids;
}

async function importLaws(db, laws, gazetteIds, summary, warn) {
  const ids = new Map();
  await idsByKey(db, 'gazette_issues', 'issue_id', laws.map((law) => law.gazetteIssue), gazetteIds);
  for (const law of laws) {
    let gazetteId = null;
    if (law.gazetteIssue) {
      gazetteId = gazetteIds.get(law.gazetteIssue) ?? null;
      if (!gazetteId) warn(`Law "${law.key}": Gazette issue "${law.gazetteIssue}" was not found; the law is imported without it.`);
    }
    const result = await db.query(
      `INSERT INTO legal_laws (source_key, jurisdiction, law_kind, title, law_number, law_year, status, status_note,
                               published_on, gazette_issue_id, source_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (source_key) DO UPDATE
         SET jurisdiction = EXCLUDED.jurisdiction, law_kind = EXCLUDED.law_kind, title = EXCLUDED.title,
             law_number = EXCLUDED.law_number, law_year = EXCLUDED.law_year, status = EXCLUDED.status,
             status_note = EXCLUDED.status_note, published_on = EXCLUDED.published_on,
             gazette_issue_id = EXCLUDED.gazette_issue_id, source_url = EXCLUDED.source_url, updated_at = NOW()
       RETURNING law_id, (xmax = 0) AS inserted`,
      [law.key, law.jurisdiction, law.kind, law.title, law.number, law.year, law.status, law.statusNote,
        law.publishedOn, gazetteId, law.sourceUrl]
    );
    const lawId = result.rows[0].law_id;
    ids.set(law.key, lawId);
    tally(summary.laws, result.rows);
    if (law.articles.length === 0) continue;
    const articles = await db.query(
      `INSERT INTO legal_articles (law_id, article_number, position, body, status, note)
       SELECT $1, number, position, body, status, note
         FROM unnest($2::text[], $3::int[], $4::text[], $5::text[], $6::text[]) AS t(number, position, body, status, note)
       ON CONFLICT (law_id, article_number) DO UPDATE
         SET position = EXCLUDED.position, body = EXCLUDED.body, status = EXCLUDED.status, note = EXCLUDED.note,
             updated_at = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [
        lawId,
        law.articles.map((article) => article.number),
        law.articles.map((article) => article.position),
        law.articles.map((article) => article.text),
        law.articles.map((article) => article.status),
        law.articles.map((article) => article.note),
      ]
    );
    tally(summary.articles, articles.rows);
    const kept = await db.query(
      'SELECT COUNT(*)::int AS kept FROM legal_articles WHERE law_id = $1 AND NOT (article_number = ANY($2::text[]))',
      [lawId, law.articles.map((article) => article.number)]
    );
    summary.articles_kept_not_in_file += kept.rows[0]?.kept ?? 0;
  }
  return ids;
}

async function importGazetteItems(db, issues, gazetteIds, lawIds, warn) {
  await idsByKey(db, 'legal_laws', 'law_id', issues.flatMap((issue) => issue.items.map((item) => item.law)), lawIds);
  for (const issue of issues) {
    const issueId = gazetteIds.get(issue.key);
    await db.query('DELETE FROM gazette_issue_items WHERE issue_id = $1', [issueId]);
    if (issue.items.length === 0) continue;
    const lawsOfItems = issue.items.map((item) => {
      if (!item.law) return null;
      const lawId = lawIds.get(item.law) ?? null;
      if (!lawId) warn(`Gazette issue "${issue.key}": law "${item.law}" was not found; the item is listed without a link.`);
      return lawId;
    });
    await db.query(
      `INSERT INTO gazette_issue_items (issue_id, position, title, law_id)
       SELECT $1, position, title, law_id FROM unnest($2::int[], $3::text[], $4::uuid[]) AS t(position, title, law_id)`,
      [issueId, issue.items.map((_, index) => index), issue.items.map((item) => item.title), lawsOfItems]
    );
  }
}

async function importRulings(db, rulings, summary, warn) {
  for (const ruling of rulings) {
    const result = await db.query(
      `INSERT INTO legal_rulings (source_key, jurisdiction, court_level, court_name, case_number, ruling_year, decided_on,
                                  subject, summary, body)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (source_key) DO UPDATE
         SET jurisdiction = EXCLUDED.jurisdiction, court_level = EXCLUDED.court_level, court_name = EXCLUDED.court_name,
             case_number = EXCLUDED.case_number, ruling_year = EXCLUDED.ruling_year, decided_on = EXCLUDED.decided_on,
             subject = EXCLUDED.subject, summary = EXCLUDED.summary, body = EXCLUDED.body, updated_at = NOW()
       RETURNING ruling_id, (xmax = 0) AS inserted`,
      [ruling.key, ruling.jurisdiction, ruling.court, ruling.courtName, ruling.caseNumber, ruling.year, ruling.decidedOn,
        ruling.subject, ruling.summary, ruling.text]
    );
    const rulingId = result.rows[0].ruling_id;
    tally(summary.rulings, result.rows);
    await db.query('DELETE FROM legal_ruling_articles WHERE ruling_id = $1', [rulingId]);
    if (ruling.articles.length === 0) continue;
    const linked = await db.query(
      `INSERT INTO legal_ruling_articles (ruling_id, article_id)
       SELECT DISTINCT $1::uuid, a.article_id
         FROM unnest($2::text[], $3::text[]) AS ref(law_key, article_number)
         JOIN legal_laws l ON l.source_key = ref.law_key
         JOIN legal_articles a ON a.law_id = l.law_id AND a.article_number = ref.article_number
       RETURNING article_id`,
      [rulingId, ruling.articles.map((ref) => ref.law), ruling.articles.map((ref) => ref.number)]
    );
    summary.ruling_links += linked.rowCount;
    const missing = ruling.articles.length - linked.rowCount;
    if (missing > 0) warn(`Ruling "${ruling.key}": ${missing} referenced article(s) were not found and were not linked.`);
  }
}

async function importSynonyms(db, synonyms, summary) {
  if (synonyms.length === 0) return;
  const result = await db.query(
    `INSERT INTO legal_synonyms (phrase, terms)
     SELECT phrase, string_to_array(terms, E'\\x1F')
       FROM unnest($1::text[], $2::text[]) AS t(phrase, terms)
     ON CONFLICT (phrase) DO UPDATE SET terms = EXCLUDED.terms, updated_at = NOW()
     RETURNING (xmax = 0) AS inserted`,
    [synonyms.map((entry) => entry.phrase), synonyms.map((entry) => entry.terms.join('\x1F'))]
  );
  tally(summary.synonyms, result.rows);
}

/**
 * Validates and imports a file. With dryRun the transaction is rolled back and the summary is
 * the preview. Returns { dry_run, summary }.
 */
export async function importLibrary(actor, payload, { dryRun = false, fileName = null } = {}) {
  if (actor?.is_platform_admin !== true) throw new LegalImportError(403, 'Platform administrators only.', 'FORBIDDEN');
  const data = validateImport(payload);
  const summary = {
    gazette: counter(), laws: counter(), articles: counter(), rulings: counter(), synonyms: counter(),
    articles_kept_not_in_file: 0, ruling_links: 0, warnings: [],
  };
  const warn = (message) => {
    if (summary.warnings.length < MAX_WARNINGS) summary.warnings.push(message);
  };
  const client = await pool.connect();
  let releaseError;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [IMPORT_LOCK]);
    const gazetteIds = await importGazette(client, data.gazette, summary);
    const lawIds = await importLaws(client, data.laws, gazetteIds, summary, warn);
    await importGazetteItems(client, data.gazette, gazetteIds, lawIds, warn);
    await importRulings(client, data.rulings, summary, warn);
    await importSynonyms(client, data.synonyms, summary);
    if (dryRun) {
      await client.query('ROLLBACK');
    } else {
      await client.query(
        'INSERT INTO legal_library_imports (file_name, summary, imported_by_user_id) VALUES ($1, $2::jsonb, $3)',
        [fileName, JSON.stringify(summary), actor.user_id ?? null]
      );
      await client.query('COMMIT');
    }
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      releaseError = rollbackError;
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
  return { dry_run: dryRun, summary };
}

export async function listImports(actor) {
  if (actor?.is_platform_admin !== true) throw new LegalImportError(403, 'Platform administrators only.', 'FORBIDDEN');
  const result = await query(
    `SELECT i.import_id, i.file_name, i.summary, i.created_at, u.full_name AS imported_by_name
       FROM legal_library_imports i LEFT JOIN app_users u ON u.user_id = i.imported_by_user_id
      ORDER BY i.created_at DESC
      LIMIT 50`
  );
  return { imports: result.rows };
}
