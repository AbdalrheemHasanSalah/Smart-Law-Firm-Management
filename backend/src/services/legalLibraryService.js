import { query } from '../config/db.js';
import { auditLater } from './auditService.js';
import { getCaseById } from './caseService.js';
import { normalizeArabic, quotedPenalties, quotedPeriods, searchWords, toPrefixQuery } from './legalText.js';
import { officeCondition } from './officeScope.js';

/**
 * Legal library (المكتبة القانونية).
 *
 *   platform-wide, read only   laws and their articles, rulings, Official Gazette issues, synonyms
 *   per office                 saved articles and rulings, the office's principles, case references
 *
 * Every member of an office's staff (admin, lawyer, assistant) searches and reads the library and
 * saves to the office's own collection; an item or principle is edited or removed by whoever
 * added it, or by the administrator. A case reference needs access to the case itself, exactly as
 * the case file does. Clients have no access.
 *
 * Text is always returned as stored: nothing here writes or rephrases law. Periods and penalties
 * are quoted from an article only when its text states them (see legalText.js), and a repealed
 * article or law is never returned as current: search leaves them out unless asked, and every
 * row carries its status.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF = ['admin', 'lawyer', 'assistant'];
const JURISDICTIONS = ['ps', 'jo', 'eg'];
const LAW_KINDS = ['law', 'decree_law', 'regulation', 'decree', 'decision', 'order', 'other'];
const STATUSES = ['in_force', 'amended', 'repealed'];
const SEARCH_TYPES = ['all', 'articles', 'rulings', 'laws'];
const RESULTS_PER_TYPE = 20;
const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 40;
const MAX_NOTE = 4000;
const RULING_PREVIEW = 400;

export class LegalLibraryError extends Error {
  constructor(status, message, publicCode) {
    super(message);
    this.name = 'LegalLibraryError';
    this.status = status;
    if (publicCode) this.publicCode = publicCode;
  }
}

const invalid = (message) => {
  throw new LegalLibraryError(400, message, 'VALIDATION');
};
const notFound = () => {
  throw new LegalLibraryError(404, 'Not found.', 'NOT_FOUND');
};
const forbidden = () => {
  throw new LegalLibraryError(403, 'You do not have permission to access this resource.', 'FORBIDDEN');
};

function assertStaff(actor) {
  if (!actor || !STAFF.includes(actor.role) || typeof actor.user_id !== 'string' || !UUID_PATTERN.test(actor.user_id)) {
    forbidden();
  }
}

/** Throws NO_ACTIVE_OFFICE when the session has no office, as every office query would. */
const requireOffice = (actor) => officeCondition(actor, [], 'office');

function uuid(value, field) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) invalid(`${field} must be a valid UUID.`);
  return value;
}

function optionalText(value, field, max) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') invalid(`${field} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) invalid(`${field} must be at most ${max} characters.`);
  return trimmed || null;
}

function requiredText(value, field, max) {
  const text = optionalText(value, field, max);
  if (!text) invalid(`${field} is required.`);
  return text;
}

function tagsOf(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_TAGS) invalid(`tags must be a list of at most ${MAX_TAGS}.`);
  const tags = new Set();
  for (const tag of value) {
    if (typeof tag !== 'string') invalid('Each tag must be text.');
    const trimmed = tag.trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_TAG_LENGTH) invalid(`Each tag must be at most ${MAX_TAG_LENGTH} characters.`);
    tags.add(trimmed);
  }
  return [...tags];
}

function assertBody(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('A JSON object is required.');
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length) invalid(`Unknown fields: ${unknown.join(', ')}.`);
}

function pageOf(parameters, maxSize = 50) {
  const page = parameters.page === undefined ? 1 : Number(parameters.page);
  const pageSize = parameters.pageSize === undefined ? 20 : Number(parameters.pageSize);
  if (!Number.isInteger(page) || page < 1) invalid('page must be a positive integer.');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > maxSize) invalid(`pageSize must be between 1 and ${maxSize}.`);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

const pagination = (page, pageSize, total) => ({ page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) });

function oneOf(value, allowed, field) {
  if (value === undefined || value === '') return undefined;
  if (!allowed.includes(value)) invalid(`${field} is not supported.`);
  return value;
}

/** Exactly one of an article or a ruling. */
function targetOf(body) {
  const articleId = body.article_id === undefined || body.article_id === null ? null : uuid(body.article_id, 'article_id');
  const rulingId = body.ruling_id === undefined || body.ruling_id === null ? null : uuid(body.ruling_id, 'ruling_id');
  if ((articleId === null) === (rulingId === null)) invalid('Give either article_id or ruling_id.');
  return { articleId, rulingId };
}

const isUniqueViolation = (error) => error?.code === '23505';
const isMissingReference = (error) => error?.code === '23503';

/* ───────────────────────── shapes ───────────────────────── */

const ARTICLE_COLUMNS = `
  a.article_id, a.article_number, a.position, a.body, a.status, a.note,
  l.law_id, l.title AS law_title, l.law_number, l.law_year, l.law_kind, l.jurisdiction, l.status AS law_status`;

const lawSummary = (row) => ({
  law_id: row.law_id,
  title: row.law_title ?? row.title,
  law_number: row.law_number,
  law_year: row.law_year,
  law_kind: row.law_kind,
  jurisdiction: row.jurisdiction,
  status: row.law_status ?? row.status,
});

/** An article is current only when neither it nor its law is repealed. */
const publicArticle = (row) => ({
  article_id: row.article_id,
  article_number: row.article_number,
  body: row.body,
  status: row.status,
  note: row.note,
  current: row.status !== 'repealed' && row.law_status !== 'repealed',
  law: lawSummary(row),
  ruling_count: row.ruling_count ?? undefined,
  saved_item_id: row.saved_item_id ?? null,
});

const publicRuling = (row, { full = false } = {}) => ({
  ruling_id: row.ruling_id,
  jurisdiction: row.jurisdiction,
  court_level: row.court_level,
  court_name: row.court_name,
  case_number: row.case_number,
  ruling_year: row.ruling_year,
  decided_on: row.decided_on,
  subject: row.subject,
  summary: row.summary,
  ...(full ? { body: row.body } : { preview: row.summary ? null : String(row.body ?? '').slice(0, RULING_PREVIEW) }),
  applied_articles: row.applied_articles ?? [],
  saved_item_id: row.saved_item_id ?? null,
});

const publicLaw = (row) => ({
  law_id: row.law_id,
  title: row.title,
  law_number: row.law_number,
  law_year: row.law_year,
  law_kind: row.law_kind,
  jurisdiction: row.jurisdiction,
  status: row.status,
  status_note: row.status_note,
  published_on: row.published_on,
  source_url: row.source_url,
  article_count: row.article_count ?? undefined,
  gazette_issue: row.gazette_issue_id
    ? { issue_id: row.gazette_issue_id, issue_number: row.gazette_issue_number, published_on: row.gazette_published_on }
    : null,
});

/** The articles a ruling applied, as a JSON list, for SELECTs over rulings aliased r. */
const APPLIED_ARTICLES = `
  COALESCE((
    SELECT json_agg(json_build_object(
             'article_id', aa.article_id, 'article_number', aa.article_number,
             'law_id', al.law_id, 'law_title', al.title, 'status', aa.status, 'law_status', al.status
           ) ORDER BY al.title, aa.position)
      FROM legal_ruling_articles ra
      JOIN legal_articles aa ON aa.article_id = ra.article_id
      JOIN legal_laws al ON al.law_id = aa.law_id
     WHERE ra.ruling_id = r.ruling_id
  ), '[]'::json) AS applied_articles`;

/* ───────────────────────── search ───────────────────────── */

/**
 * Everyday wording found in the question, with the legal terms it maps to. Phrases are stored
 * normalized, so matching is on the normalized question.
 */
async function synonymsIn(question) {
  const result = await query(
    `SELECT phrase, terms FROM legal_synonyms
      WHERE strpos($1, phrase) > 0
      ORDER BY length(phrase) DESC
      LIMIT 10`,
    [normalizeArabic(question).toLowerCase()]
  );
  return result.rows;
}

function parseSearch(parameters) {
  const q = requiredText(parameters.q, 'q', 300);
  if (q.length < 2) invalid('q must be at least 2 characters.');
  return {
    q,
    jurisdiction: oneOf(parameters.jurisdiction, JURISDICTIONS, 'jurisdiction'),
    type: oneOf(parameters.type, SEARCH_TYPES, 'type') ?? 'all',
    includeRepealed: parameters.includeRepealed === 'true',
  };
}

/** Adds `value` to the parameters and returns its placeholder. */
const bind = (parameters, value) => {
  parameters.push(value);
  return `$${parameters.length}`;
};

async function searchArticles(actor, { any, legal, jurisdiction, includeRepealed }) {
  const parameters = [];
  const anyQuery = bind(parameters, any);
  const legalQuery = legal ? bind(parameters, legal) : null;
  const officeId = bind(parameters, actor.office_id);
  let filters = `a.search_vector @@ to_tsquery('simple', ${anyQuery})`;
  if (jurisdiction) filters += ` AND l.jurisdiction = ${bind(parameters, jurisdiction)}`;
  const current = `a.status <> 'repealed' AND l.status <> 'repealed'`;
  const rank = `ts_rank(a.search_vector, to_tsquery('simple', ${anyQuery}))${
    legalQuery ? ` + 2 * ts_rank(a.search_vector, to_tsquery('simple', ${legalQuery}))` : ''
  }`;
  const rows = await query(
    `SELECT ${ARTICLE_COLUMNS},
            (SELECT COUNT(*)::int FROM legal_ruling_articles ra WHERE ra.article_id = a.article_id) AS ruling_count,
            (SELECT s.item_id FROM office_library_items s WHERE s.article_id = a.article_id AND s.office_id = ${officeId}) AS saved_item_id
       FROM legal_articles a
       JOIN legal_laws l ON l.law_id = a.law_id
      WHERE ${filters}${includeRepealed ? '' : ` AND ${current}`}
      ORDER BY ${rank} DESC, l.law_year DESC NULLS LAST, a.position
      LIMIT ${RESULTS_PER_TYPE}`,
    parameters
  );
  let hiddenRepealed = 0;
  if (!includeRepealed) {
    const countParameters = [];
    const countQuery = bind(countParameters, any);
    const jurisdictionFilter = jurisdiction ? ` AND l.jurisdiction = ${bind(countParameters, jurisdiction)}` : '';
    const count = await query(
      `SELECT COUNT(*)::int AS total
         FROM legal_articles a JOIN legal_laws l ON l.law_id = a.law_id
        WHERE a.search_vector @@ to_tsquery('simple', ${countQuery})${jurisdictionFilter} AND NOT (${current})`,
      countParameters
    );
    hiddenRepealed = count.rows[0]?.total ?? 0;
  }
  return { articles: rows.rows.map(publicArticle), hiddenRepealed };
}

async function searchRulings(actor, { any, legal, jurisdiction }) {
  const parameters = [];
  const anyQuery = bind(parameters, any);
  const legalQuery = legal ? bind(parameters, legal) : null;
  const officeId = bind(parameters, actor.office_id);
  const jurisdictionFilter = jurisdiction ? ` AND r.jurisdiction = ${bind(parameters, jurisdiction)}` : '';
  const rank = `ts_rank(r.search_vector, to_tsquery('simple', ${anyQuery}))${
    legalQuery ? ` + 2 * ts_rank(r.search_vector, to_tsquery('simple', ${legalQuery}))` : ''
  }`;
  const rows = await query(
    `SELECT r.ruling_id, r.jurisdiction, r.court_level, r.court_name, r.case_number, r.ruling_year, to_char(r.decided_on, 'YYYY-MM-DD') AS decided_on,
            r.subject, r.summary, left(r.body, ${RULING_PREVIEW}) AS body, ${APPLIED_ARTICLES},
            (SELECT s.item_id FROM office_library_items s WHERE s.ruling_id = r.ruling_id AND s.office_id = ${officeId}) AS saved_item_id
       FROM legal_rulings r
      WHERE r.search_vector @@ to_tsquery('simple', ${anyQuery})${jurisdictionFilter}
      ORDER BY ${rank} DESC, r.decided_on DESC NULLS LAST
      LIMIT ${RESULTS_PER_TYPE}`,
    parameters
  );
  return rows.rows.map((row) => publicRuling(row));
}

async function searchLaws({ any, jurisdiction }) {
  const parameters = [];
  const anyQuery = bind(parameters, any);
  const jurisdictionFilter = jurisdiction ? ` AND l.jurisdiction = ${bind(parameters, jurisdiction)}` : '';
  const rows = await query(
    `SELECT l.law_id, l.title, l.law_number, l.law_year, l.law_kind, l.jurisdiction, l.status, l.status_note,
            to_char(l.published_on, 'YYYY-MM-DD') AS published_on, l.source_url, l.gazette_issue_id,
            (SELECT COUNT(*)::int FROM legal_articles a WHERE a.law_id = l.law_id) AS article_count
       FROM legal_laws l
      WHERE l.search_vector @@ to_tsquery('simple', ${anyQuery})${jurisdictionFilter}
      ORDER BY ts_rank(l.search_vector, to_tsquery('simple', ${anyQuery})) DESC, l.law_year DESC NULLS LAST
      LIMIT ${RESULTS_PER_TYPE}`,
    parameters
  );
  return rows.rows.map(publicLaw);
}

/**
 * Searches articles, rulings and law titles with the user's words and the legal terms their
 * wording maps to. Repealed articles (or articles of repealed laws) are left out unless
 * includeRepealed=true; how many were left out is returned so the screen can say so.
 */
export async function searchLibrary(actor, parameters = {}) {
  assertStaff(actor);
  requireOffice(actor);
  const { q, jurisdiction, type, includeRepealed } = parseSearch(parameters);
  const synonyms = await synonymsIn(q);
  const userWords = searchWords(q);
  const legalWords = searchWords(synonyms.flatMap((row) => row.terms).join(' ')).filter((word) => !userWords.includes(word));
  const any = toPrefixQuery([...legalWords, ...userWords]);
  const empty = { query: q, mapped_terms: synonyms.map((row) => ({ phrase: row.phrase, terms: row.terms })), articles: [], rulings: [], laws: [], hidden_repealed: 0 };
  if (!any) return empty;
  const legal = toPrefixQuery(legalWords);
  const options = { any, legal, jurisdiction, includeRepealed };
  const [articles, rulings, laws] = await Promise.all([
    type === 'all' || type === 'articles' ? searchArticles(actor, options) : { articles: [], hiddenRepealed: 0 },
    type === 'all' || type === 'rulings' ? searchRulings(actor, options) : [],
    type === 'all' || type === 'laws' ? searchLaws(options) : [],
  ]);
  return { ...empty, articles: articles.articles, rulings, laws, hidden_repealed: articles.hiddenRepealed };
}

/* ───────────────────────── reading ───────────────────────── */

/** The library's size, for the page header. */
export async function libraryStats() {
  const result = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM legal_laws WHERE jurisdiction = 'ps') AS ps_laws,
       (SELECT COUNT(*)::int FROM legal_rulings WHERE jurisdiction = 'ps') AS ps_rulings,
       (SELECT COUNT(*)::int FROM gazette_issues) AS gazette_issues,
       (SELECT COUNT(*)::int FROM legal_laws WHERE jurisdiction <> 'ps')
         + (SELECT COUNT(*)::int FROM legal_rulings WHERE jurisdiction <> 'ps') AS comparative,
       (SELECT COUNT(*)::int FROM legal_articles) AS articles`
  );
  return { stats: result.rows[0] };
}

export async function libraryStatsForStaff(actor) {
  assertStaff(actor);
  return libraryStats();
}

/** Browses laws: by country, kind, status and words in the title. */
export async function listLaws(actor, parameters = {}) {
  assertStaff(actor);
  const { page, pageSize, offset } = pageOf(parameters);
  const values = [];
  const filters = ['TRUE'];
  const jurisdiction = oneOf(parameters.jurisdiction, JURISDICTIONS, 'jurisdiction');
  const kind = oneOf(parameters.kind, LAW_KINDS, 'kind');
  const status = oneOf(parameters.status, STATUSES, 'status');
  if (jurisdiction) filters.push(`l.jurisdiction = ${bind(values, jurisdiction)}`);
  if (kind) filters.push(`l.law_kind = ${bind(values, kind)}`);
  if (status) filters.push(`l.status = ${bind(values, status)}`);
  const search = optionalText(parameters.search, 'search', 200);
  if (search) {
    const words = toPrefixQuery(searchWords(search));
    if (!words) return { laws: [], pagination: pagination(page, pageSize, 0) };
    // Every word must appear in the title when browsing, unlike the free search.
    filters.push(`l.search_vector @@ to_tsquery('simple', ${bind(values, words.replaceAll(' | ', ' & '))})`);
  }
  const where = filters.join(' AND ');
  const count = await query(`SELECT COUNT(*)::int AS total FROM legal_laws l WHERE ${where}`, values);
  const total = count.rows[0]?.total ?? 0;
  const pageValues = [...values];
  const limit = bind(pageValues, pageSize);
  const skip = bind(pageValues, offset);
  const result = await query(
    `SELECT l.law_id, l.title, l.law_number, l.law_year, l.law_kind, l.jurisdiction, l.status, l.status_note,
            to_char(l.published_on, 'YYYY-MM-DD') AS published_on, l.source_url, l.gazette_issue_id,
            (SELECT COUNT(*)::int FROM legal_articles a WHERE a.law_id = l.law_id) AS article_count
       FROM legal_laws l
      WHERE ${where}
      ORDER BY l.law_year DESC NULLS LAST, l.title, l.law_id
      LIMIT ${limit} OFFSET ${skip}`,
    pageValues
  );
  return { laws: result.rows.map(publicLaw), pagination: pagination(page, pageSize, total) };
}

/** A law with all its articles in order, and which of them the office saved. */
export async function getLaw(actor, lawId) {
  assertStaff(actor);
  uuid(lawId, 'lawId');
  const law = await query(
    `SELECT l.law_id, l.title, l.law_number, l.law_year, l.law_kind, l.jurisdiction, l.status, l.status_note,
            to_char(l.published_on, 'YYYY-MM-DD') AS published_on, l.source_url, l.gazette_issue_id,
            g.issue_number AS gazette_issue_number, to_char(g.published_on, 'YYYY-MM-DD') AS gazette_published_on
       FROM legal_laws l LEFT JOIN gazette_issues g ON g.issue_id = l.gazette_issue_id
      WHERE l.law_id = $1`,
    [lawId]
  );
  if (!law.rowCount) notFound();
  const parameters = [lawId];
  const officeId = officeCondition(actor, parameters, 's');
  const articles = await query(
    `SELECT ${ARTICLE_COLUMNS},
            (SELECT COUNT(*)::int FROM legal_ruling_articles ra WHERE ra.article_id = a.article_id) AS ruling_count,
            (SELECT s.item_id FROM office_library_items s WHERE s.article_id = a.article_id AND ${officeId}) AS saved_item_id
       FROM legal_articles a JOIN legal_laws l ON l.law_id = a.law_id
      WHERE a.law_id = $1
      ORDER BY a.position, a.article_number`,
    parameters
  );
  return { law: publicLaw(law.rows[0]), articles: articles.rows.map(publicArticle) };
}

/** An article with its law, the rulings that applied it, and the periods and penalties it states. */
export async function getArticle(actor, articleId) {
  assertStaff(actor);
  uuid(articleId, 'articleId');
  const parameters = [articleId];
  const officeId = officeCondition(actor, parameters, 's');
  const article = await query(
    `SELECT ${ARTICLE_COLUMNS},
            (SELECT s.item_id FROM office_library_items s WHERE s.article_id = a.article_id AND ${officeId}) AS saved_item_id
       FROM legal_articles a JOIN legal_laws l ON l.law_id = a.law_id
      WHERE a.article_id = $1`,
    parameters
  );
  if (!article.rowCount) notFound();
  const rulings = await query(
    `SELECT r.ruling_id, r.jurisdiction, r.court_level, r.court_name, r.case_number, r.ruling_year, to_char(r.decided_on, 'YYYY-MM-DD') AS decided_on,
            r.subject, r.summary, left(r.body, ${RULING_PREVIEW}) AS body
       FROM legal_ruling_articles ra JOIN legal_rulings r ON r.ruling_id = ra.ruling_id
      WHERE ra.article_id = $1
      ORDER BY r.decided_on DESC NULLS LAST, r.ruling_id
      LIMIT 50`,
    [articleId]
  );
  const row = article.rows[0];
  return {
    article: {
      ...publicArticle(row),
      quoted_periods: quotedPeriods(row.body),
      quoted_penalties: quotedPenalties(row.body),
    },
    rulings: rulings.rows.map((entry) => publicRuling(entry)),
  };
}

export async function getRuling(actor, rulingId) {
  assertStaff(actor);
  uuid(rulingId, 'rulingId');
  const parameters = [rulingId];
  const officeId = officeCondition(actor, parameters, 's');
  const result = await query(
    `SELECT r.ruling_id, r.jurisdiction, r.court_level, r.court_name, r.case_number, r.ruling_year,
            to_char(r.decided_on, 'YYYY-MM-DD') AS decided_on, r.subject, r.summary, r.body, ${APPLIED_ARTICLES},
            (SELECT s.item_id FROM office_library_items s WHERE s.ruling_id = r.ruling_id AND ${officeId}) AS saved_item_id
       FROM legal_rulings r
      WHERE r.ruling_id = $1`,
    parameters
  );
  if (!result.rowCount) notFound();
  return { ruling: publicRuling(result.rows[0], { full: true }) };
}

/** Gazette issues of one year (the latest year with issues by default), and the years there are. */
export async function listGazette(actor, parameters = {}) {
  assertStaff(actor);
  const years = await query(
    `SELECT DISTINCT EXTRACT(YEAR FROM published_on)::int AS year
       FROM gazette_issues WHERE published_on IS NOT NULL
      ORDER BY year DESC`
  );
  const available = years.rows.map((row) => row.year);
  let year = available[0] ?? null;
  if (parameters.year !== undefined) {
    year = Number(parameters.year);
    if (!Number.isInteger(year) || year < 1800 || year > 2200) invalid('year is not valid.');
  }
  if (year === null) return { years: available, year: null, issues: [] };
  const issues = await query(
    `SELECT g.issue_id, g.issue_number, to_char(g.published_on, 'YYYY-MM-DD') AS published_on,
            (SELECT COUNT(*)::int FROM gazette_issue_items i WHERE i.issue_id = g.issue_id) AS item_count
       FROM gazette_issues g
      WHERE EXTRACT(YEAR FROM g.published_on) = $1
      ORDER BY g.published_on DESC, g.issue_number DESC`,
    [year]
  );
  return { years: available, year, issues: issues.rows };
}

export async function getGazetteIssue(actor, issueId) {
  assertStaff(actor);
  uuid(issueId, 'issueId');
  const issue = await query(
    `SELECT issue_id, issue_number, to_char(published_on, 'YYYY-MM-DD') AS published_on FROM gazette_issues WHERE issue_id = $1`,
    [issueId]
  );
  if (!issue.rowCount) notFound();
  const items = await query(
    `SELECT i.position, i.title, l.law_id, l.status AS law_status
       FROM gazette_issue_items i LEFT JOIN legal_laws l ON l.law_id = i.law_id
      WHERE i.issue_id = $1
      ORDER BY i.position`,
    [issueId]
  );
  return { issue: { ...issue.rows[0], items: items.rows } };
}

/* ───────────────────────── the office's saved items ───────────────────────── */

const SAVED_SELECT = (officeFilter) => `
  SELECT s.item_id, s.note, s.tags, s.created_at, s.updated_at, s.created_by_user_id, u.full_name AS created_by_name,
         s.article_id, a.article_number, left(a.body, 600) AS article_body, a.status AS article_status,
         l.law_id, l.title AS law_title, l.law_number, l.law_year, l.status AS law_status, l.jurisdiction AS law_jurisdiction,
         s.ruling_id, r.court_level, r.court_name, r.case_number, r.ruling_year, to_char(r.decided_on, 'YYYY-MM-DD') AS decided_on, r.subject AS ruling_subject,
         r.jurisdiction AS ruling_jurisdiction
    FROM office_library_items s
    JOIN app_users u ON u.user_id = s.created_by_user_id
    LEFT JOIN legal_articles a ON a.article_id = s.article_id
    LEFT JOIN legal_laws l ON l.law_id = a.law_id
    LEFT JOIN legal_rulings r ON r.ruling_id = s.ruling_id
   WHERE ${officeFilter}`;

const publicSaved = (row) => ({
  item_id: row.item_id,
  note: row.note,
  tags: row.tags ?? [],
  created_at: row.created_at,
  updated_at: row.updated_at,
  created_by: { user_id: row.created_by_user_id, full_name: row.created_by_name },
  article: row.article_id
    ? {
        article_id: row.article_id,
        article_number: row.article_number,
        body: row.article_body,
        status: row.article_status,
        current: row.article_status !== 'repealed' && row.law_status !== 'repealed',
        law: { law_id: row.law_id, title: row.law_title, law_number: row.law_number, law_year: row.law_year, status: row.law_status, jurisdiction: row.law_jurisdiction },
      }
    : null,
  ruling: row.ruling_id
    ? {
        ruling_id: row.ruling_id,
        court_level: row.court_level,
        court_name: row.court_name,
        case_number: row.case_number,
        ruling_year: row.ruling_year,
        decided_on: row.decided_on,
        subject: row.ruling_subject,
        jurisdiction: row.ruling_jurisdiction,
      }
    : null,
});

export async function listSavedItems(actor, parameters = {}) {
  assertStaff(actor);
  const values = [];
  let filters = officeCondition(actor, values, 's');
  const type = oneOf(parameters.type, ['articles', 'rulings'], 'type');
  if (type === 'articles') filters += ' AND s.article_id IS NOT NULL';
  if (type === 'rulings') filters += ' AND s.ruling_id IS NOT NULL';
  const tag = optionalText(parameters.tag, 'tag', MAX_TAG_LENGTH);
  if (tag) filters += ` AND ${bind(values, tag)} = ANY(s.tags)`;
  const result = await query(`${SAVED_SELECT(filters)} ORDER BY s.created_at DESC, s.item_id LIMIT 500`, values);
  const tagValues = [];
  const tags = await query(
    `SELECT DISTINCT unnest(s.tags) AS tag FROM office_library_items s WHERE ${officeCondition(actor, tagValues, 's')} ORDER BY tag`,
    tagValues
  );
  return { items: result.rows.map(publicSaved), tags: tags.rows.map((row) => row.tag) };
}

async function findSaved(actor, itemId) {
  uuid(itemId, 'itemId');
  const values = [itemId];
  const filters = `s.item_id = $1 AND ${officeCondition(actor, values, 's')}`;
  const result = await query(`${SAVED_SELECT(filters)} LIMIT 1`, values);
  if (!result.rowCount) notFound();
  return result.rows[0];
}

const canChange = (actor, ownerId) => actor.role === 'admin' || actor.user_id === ownerId;

export async function saveItem(actor, body) {
  assertStaff(actor);
  assertBody(body, ['article_id', 'ruling_id', 'note', 'tags']);
  const { articleId, rulingId } = targetOf(body);
  const note = optionalText(body.note, 'note', MAX_NOTE);
  const tags = tagsOf(body.tags);
  requireOffice(actor);
  let inserted;
  try {
    inserted = await query(
      `INSERT INTO office_library_items (office_id, article_id, ruling_id, note, tags, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5::text[], $6)
       RETURNING item_id`,
      [actor.office_id, articleId, rulingId, note, tags, actor.user_id]
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new LegalLibraryError(409, 'Already saved.', 'ALREADY_SAVED');
    if (isMissingReference(error)) notFound();
    throw error;
  }
  const itemId = inserted.rows[0].item_id;
  auditLater(actor, { action: 'library_item.saved', entityType: 'library_item', entityId: itemId, details: { article_id: articleId, ruling_id: rulingId } });
  return { item: publicSaved(await findSaved(actor, itemId)) };
}

export async function updateSavedItem(actor, itemId, body) {
  assertStaff(actor);
  assertBody(body, ['note', 'tags']);
  const current = await findSaved(actor, itemId);
  if (!canChange(actor, current.created_by_user_id)) forbidden();
  const note = body.note === undefined ? current.note : optionalText(body.note, 'note', MAX_NOTE);
  const tags = body.tags === undefined ? current.tags : tagsOf(body.tags);
  const values = [itemId, note, tags];
  const officeFilter = officeCondition(actor, values, 'office_library_items');
  await query(
    `UPDATE office_library_items SET note = $2, tags = $3::text[], updated_at = NOW()
      WHERE item_id = $1 AND ${officeFilter}`,
    values
  );
  auditLater(actor, { action: 'library_item.updated', entityType: 'library_item', entityId: itemId, details: {} });
  return { item: publicSaved(await findSaved(actor, itemId)) };
}

export async function removeSavedItem(actor, itemId) {
  assertStaff(actor);
  const current = await findSaved(actor, itemId);
  if (!canChange(actor, current.created_by_user_id)) forbidden();
  const values = [itemId];
  await query(`DELETE FROM office_library_items WHERE item_id = $1 AND ${officeCondition(actor, values, 'office_library_items')}`, values);
  auditLater(actor, { action: 'library_item.removed', entityType: 'library_item', entityId: itemId, details: {} });
  return { removed: true };
}

/* ───────────────────────── the office's principles ───────────────────────── */

const PRINCIPLE_SELECT = (officeFilter) => `
  SELECT p.principle_id, p.title, p.body, p.tags, p.created_at, p.updated_at, p.created_by_user_id, u.full_name AS created_by_name
    FROM office_legal_principles p
    JOIN app_users u ON u.user_id = p.created_by_user_id
   WHERE ${officeFilter}`;

const publicPrinciple = (row) => ({
  principle_id: row.principle_id,
  title: row.title,
  body: row.body,
  tags: row.tags ?? [],
  created_at: row.created_at,
  updated_at: row.updated_at,
  created_by: { user_id: row.created_by_user_id, full_name: row.created_by_name },
});

export async function listPrinciples(actor, parameters = {}) {
  assertStaff(actor);
  const values = [];
  let filters = officeCondition(actor, values, 'p');
  const search = optionalText(parameters.search, 'search', 100);
  if (search) {
    const pattern = bind(values, `%${search.replace(/[\\%_]/g, '\\$&')}%`);
    filters += ` AND (p.title ILIKE ${pattern} ESCAPE E'\\\\' OR p.body ILIKE ${pattern} ESCAPE E'\\\\')`;
  }
  const result = await query(`${PRINCIPLE_SELECT(filters)} ORDER BY p.updated_at DESC, p.principle_id LIMIT 500`, values);
  return { principles: result.rows.map(publicPrinciple) };
}

async function findPrinciple(actor, principleId) {
  uuid(principleId, 'principleId');
  const values = [principleId];
  const result = await query(`${PRINCIPLE_SELECT(`p.principle_id = $1 AND ${officeCondition(actor, values, 'p')}`)} LIMIT 1`, values);
  if (!result.rowCount) notFound();
  return result.rows[0];
}

export async function createPrinciple(actor, body) {
  assertStaff(actor);
  assertBody(body, ['title', 'body', 'tags']);
  const title = requiredText(body.title, 'title', 200);
  const text = requiredText(body.body, 'body', 20000);
  const tags = tagsOf(body.tags);
  requireOffice(actor);
  const inserted = await query(
    `INSERT INTO office_legal_principles (office_id, title, body, tags, created_by_user_id)
     VALUES ($1, $2, $3, $4::text[], $5)
     RETURNING principle_id`,
    [actor.office_id, title, text, tags, actor.user_id]
  );
  const principleId = inserted.rows[0].principle_id;
  auditLater(actor, { action: 'principle.created', entityType: 'legal_principle', entityId: principleId, details: { title } });
  return { principle: publicPrinciple(await findPrinciple(actor, principleId)) };
}

export async function updatePrinciple(actor, principleId, body) {
  assertStaff(actor);
  assertBody(body, ['title', 'body', 'tags']);
  const current = await findPrinciple(actor, principleId);
  if (!canChange(actor, current.created_by_user_id)) forbidden();
  const title = body.title === undefined ? current.title : requiredText(body.title, 'title', 200);
  const text = body.body === undefined ? current.body : requiredText(body.body, 'body', 20000);
  const tags = body.tags === undefined ? current.tags : tagsOf(body.tags);
  const values = [principleId, title, text, tags];
  await query(
    `UPDATE office_legal_principles SET title = $2, body = $3, tags = $4::text[], updated_at = NOW()
      WHERE principle_id = $1 AND ${officeCondition(actor, values, 'office_legal_principles')}`,
    values
  );
  auditLater(actor, { action: 'principle.updated', entityType: 'legal_principle', entityId: principleId, details: {} });
  return { principle: publicPrinciple(await findPrinciple(actor, principleId)) };
}

export async function removePrinciple(actor, principleId) {
  assertStaff(actor);
  const current = await findPrinciple(actor, principleId);
  if (!canChange(actor, current.created_by_user_id)) forbidden();
  const values = [principleId];
  await query(`DELETE FROM office_legal_principles WHERE principle_id = $1 AND ${officeCondition(actor, values, 'office_legal_principles')}`, values);
  auditLater(actor, { action: 'principle.removed', entityType: 'legal_principle', entityId: principleId, details: { title: current.title } });
  return { removed: true };
}

/* ───────────────────────── case references ───────────────────────── */

/** Access to a case follows the case file itself: getCaseById answers 404 for a case out of reach. */
async function assertCaseAccess(actor, caseId) {
  uuid(caseId, 'caseId');
  try {
    await getCaseById(actor, caseId);
  } catch (error) {
    if (error?.status === 404 || error?.status === 403) notFound();
    throw error;
  }
}

const REFERENCE_SELECT = (filters) => `
  SELECT c.reference_id, c.note, c.created_at, c.linked_by_user_id, u.full_name AS linked_by_name,
         c.article_id, a.article_number, left(a.body, 600) AS article_body, a.status AS article_status,
         l.law_id, l.title AS law_title, l.law_number, l.law_year, l.status AS law_status,
         c.ruling_id, r.court_level, r.court_name, r.case_number, r.ruling_year, to_char(r.decided_on, 'YYYY-MM-DD') AS decided_on, r.subject AS ruling_subject
    FROM case_legal_references c
    JOIN app_users u ON u.user_id = c.linked_by_user_id
    LEFT JOIN legal_articles a ON a.article_id = c.article_id
    LEFT JOIN legal_laws l ON l.law_id = a.law_id
    LEFT JOIN legal_rulings r ON r.ruling_id = c.ruling_id
   WHERE ${filters}`;

const publicReference = (row) => ({
  reference_id: row.reference_id,
  note: row.note,
  created_at: row.created_at,
  linked_by: { user_id: row.linked_by_user_id, full_name: row.linked_by_name },
  article: row.article_id
    ? {
        article_id: row.article_id,
        article_number: row.article_number,
        body: row.article_body,
        status: row.article_status,
        current: row.article_status !== 'repealed' && row.law_status !== 'repealed',
        law: { law_id: row.law_id, title: row.law_title, law_number: row.law_number, law_year: row.law_year, status: row.law_status },
      }
    : null,
  ruling: row.ruling_id
    ? {
        ruling_id: row.ruling_id,
        court_level: row.court_level,
        court_name: row.court_name,
        case_number: row.case_number,
        ruling_year: row.ruling_year,
        decided_on: row.decided_on,
        subject: row.ruling_subject,
      }
    : null,
});

export async function listCaseReferences(actor, caseId) {
  assertStaff(actor);
  await assertCaseAccess(actor, caseId);
  const values = [caseId];
  const filters = `c.case_id = $1 AND ${officeCondition(actor, values, 'c')}`;
  const result = await query(`${REFERENCE_SELECT(filters)} ORDER BY c.created_at DESC, c.reference_id`, values);
  return { references: result.rows.map(publicReference) };
}

export async function linkToCase(actor, caseId, body) {
  assertStaff(actor);
  assertBody(body, ['article_id', 'ruling_id', 'note']);
  const { articleId, rulingId } = targetOf(body);
  const note = optionalText(body.note, 'note', MAX_NOTE);
  await assertCaseAccess(actor, caseId);
  requireOffice(actor);
  let inserted;
  try {
    inserted = await query(
      `INSERT INTO case_legal_references (office_id, case_id, article_id, ruling_id, note, linked_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING reference_id`,
      [actor.office_id, caseId, articleId, rulingId, note, actor.user_id]
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new LegalLibraryError(409, 'Already linked to this case.', 'ALREADY_LINKED');
    if (isMissingReference(error)) notFound();
    throw error;
  }
  const referenceId = inserted.rows[0].reference_id;
  auditLater(actor, { action: 'case_reference.linked', entityType: 'case', entityId: caseId, details: { reference_id: referenceId, article_id: articleId, ruling_id: rulingId } });
  const values = [referenceId];
  const result = await query(`${REFERENCE_SELECT(`c.reference_id = $1 AND ${officeCondition(actor, values, 'c')}`)}`, values);
  return { reference: publicReference(result.rows[0]) };
}

export async function unlinkFromCase(actor, caseId, referenceId) {
  assertStaff(actor);
  uuid(referenceId, 'referenceId');
  await assertCaseAccess(actor, caseId);
  const values = [referenceId, caseId];
  const removed = await query(
    `DELETE FROM case_legal_references
      WHERE reference_id = $1 AND case_id = $2 AND ${officeCondition(actor, values, 'case_legal_references')}
      RETURNING reference_id`,
    values
  );
  if (!removed.rowCount) notFound();
  auditLater(actor, { action: 'case_reference.unlinked', entityType: 'case', entityId: caseId, details: { reference_id: referenceId } });
  return { removed: true };
}
