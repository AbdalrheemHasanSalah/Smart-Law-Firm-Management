import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');
const { normalizeArabic, quotedPenalties, quotedPeriods, searchWords, toPrefixQuery } = await import('../src/services/legalText.js');
const { validateImport } = await import('../src/services/legalLibraryImport.js');

const appUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const otherUserId = '7e0f5b8a-1c2d-4e3f-8a9b-0c1d2e3f4a5b';
const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const caseId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const itemId = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const articleId = 'c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f';
const session = { user: { id: 'auth-user-id' }, session: { id: 'session-id', expiresAt: '2999-01-01T00:00:00.000Z' } };
const mappedUser = {
  user_id: appUserId, auth_user_id: 'auth-user-id', full_name: 'Member', email: 'member@example.com',
  email_verified: true, status: 'active', role_id: 'role-id', office_id: officeId, role: 'lawyer', is_platform_admin: false,
};

let server;
let baseUrl;
before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

function setup(t, user, handler = async () => ({ rowCount: 0, rows: [] })) {
  t.mock.method(console, 'error', () => {});
  t.mock.method(auth.api, 'getSession', async () => session);
  const calls = [];
  t.mock.method(pool, 'query', async (sql, parameters = []) => {
    if (sql.includes('u.auth_user_id')) return { rowCount: 1, rows: [{ ...mappedUser, ...user }] };
    calls.push({ sql, parameters });
    return handler(sql, parameters);
  });
  return calls;
}

const send = (route, { method = 'GET', body } = {}) =>
  fetch(`${baseUrl}${route}`, {
    method,
    headers: { cookie: 'better-auth.session_token=test', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** Each statement is sent exactly the values it uses, numbered $1…$n with no gaps. */
function assertWellFormed(calls) {
  for (const { sql, parameters } of calls) {
    const used = [...new Set([...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])))].sort((a, b) => a - b);
    assert.deepEqual(used, used.map((_, index) => index + 1), `placeholders are $1…$n in: ${sql.slice(0, 80)}`);
    assert.equal(parameters.length, used.length, `each value is used in: ${sql.slice(0, 80)}`);
  }
}

/* ───────────────────────── text rules ───────────────────────── */

test('Arabic normalization matches legal_normalize() in the migration', () => {
  // Same input and output as the PostgreSQL function, checked on a real database.
  assert.equal(normalizeArabic('أُجْرَةٌ إيجار ٢٠٠١ مستشفى'), 'اجره ايجار 2001 مستشفي');
  assert.equal(normalizeArabic('آلة ؤ ئ ٱ'), 'اله و ي ا');
  assert.equal(normalizeArabic('قانـــون'), 'قانون');
});

test('search words drop stopwords and leading clitics, and the query is plain tsquery syntax', () => {
  assert.deepEqual(searchWords('هل والإيجار في بالأجرة للمستأجر؟'), ['ايجار', 'اجره', 'مستاجر']);
  assert.deepEqual(searchWords('بيع'), ['بيع'], 'a three-letter word keeps its first letter');
  assert.equal(toPrefixQuery(['ايجار', 'اجره']), 'ايجار:* | اجره:*');
  assert.equal(toPrefixQuery(searchWords("'); DROP TABLE x; -- & | ! :*")), 'drop:* | table:*');
  assert.equal(toPrefixQuery(searchWords('من في على')), null);
});

test('periods and penalties are quoted from the text, never computed', () => {
  const text = 'تُقدَّم الدعوى خلال ستين يوماً من تاريخ الإنذار. ويجوز للمحكمة النظر فيها. يعاقب بغرامة كل من خالف ذلك.';
  assert.deepEqual(quotedPeriods(text), ['تُقدَّم الدعوى خلال ستين يوماً من تاريخ الإنذار.']);
  assert.deepEqual(quotedPenalties(text), ['يعاقب بغرامة كل من خالف ذلك.']);
  assert.deepEqual(quotedPeriods('للمحكمة أن تقرر ما تراه مناسباً.'), []);
  assert.deepEqual(quotedPeriods('مدة الاستئناف 30 يوماً'), ['مدة الاستئناف 30 يوماً']);
});

/* ───────────────────────── access ───────────────────────── */

test('clients have no library, and the import is for platform admins only', async (t) => {
  const calls = setup(t, { role: 'client' });
  for (const route of ['/api/library/search?q=ايجار', '/api/library/stats', '/api/library/saved', '/api/library/principles']) {
    assert.equal((await send(route)).status, 403, route);
  }
  t.mock.restoreAll();
  const adminCalls = setup(t, { role: 'admin' });
  assert.equal((await send('/api/platform/library/import', { method: 'POST', body: { laws: [] } })).status, 403);
  assert.equal((await send('/api/platform/library/imports')).status, 403);
  assert.equal(calls.length + adminCalls.length, 0, 'nothing was read');
});

/* ───────────────────────── search ───────────────────────── */

test('search binds the words, uses the mapped legal terms, and leaves repealed articles out', async (t) => {
  const calls = setup(t, {}, async (sql) => {
    if (sql.includes('FROM legal_synonyms')) return { rowCount: 1, rows: [{ phrase: 'ما دفع الايجار', terms: ['التخلف عن دفع الأجرة'] }] };
    if (sql.includes('COUNT(*)::int AS total')) return { rowCount: 1, rows: [{ total: 2 }] };
    return { rowCount: 0, rows: [] };
  });
  const response = await send(`/api/library/search?q=${encodeURIComponent("المستأجر ما دفع الإيجار'; --")}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.mapped_terms, [{ phrase: 'ما دفع الايجار', terms: ['التخلف عن دفع الأجرة'] }]);
  assert.equal(body.hidden_repealed, 2);
  assertWellFormed(calls);
  const synonyms = calls.find((call) => call.sql.includes('FROM legal_synonyms'));
  assert.equal(synonyms.parameters[0], normalizeArabic("المستأجر ما دفع الإيجار'; --"));
  const articles = calls.find((call) => call.sql.includes('FROM legal_articles a') && call.sql.includes('LIMIT 20'));
  assert.match(articles.sql, /a\.status <> 'repealed' AND l\.status <> 'repealed'/);
  assert.ok(articles.parameters[0].startsWith('تخلف:* | اجره:* | '), 'legal terms first');
  assert.ok(articles.parameters.includes(officeId), 'saved flags are for this office only');
  for (const call of calls) assert.doesNotMatch(call.sql, /المستأجر|--/, 'the question is never part of the SQL');
});

test('includeRepealed shows repealed articles, and filters are validated', async (t) => {
  const calls = setup(t);
  assert.equal((await send('/api/library/search?q=اجره&includeRepealed=true&jurisdiction=ps&type=articles')).status, 200);
  const articles = calls.find((call) => call.sql.includes('FROM legal_articles a'));
  assert.doesNotMatch(articles.sql, /status <> 'repealed'/);
  assert.ok(articles.parameters.includes('ps'));
  assert.equal(calls.filter((call) => call.sql.includes('FROM legal_rulings')).length, 0, 'type=articles reads articles only');
  assertWellFormed(calls);
  for (const query of ['q=a', 'q=', 'q=اجره&jurisdiction=fr', 'q=اجره&type=other']) {
    assert.equal((await send(`/api/library/search?${query}`)).status, 400, query);
  }
});

/* ───────────────────────── office collection ───────────────────────── */

test('saved items belong to the office, and only their author or the admin changes them', async (t) => {
  const savedRow = { item_id: itemId, note: null, tags: [], created_by_user_id: otherUserId, created_by_name: 'Other', article_id: articleId };
  const calls = setup(t, {}, async (sql) => (sql.includes('FROM office_library_items s') ? { rowCount: 1, rows: [savedRow] } : { rowCount: 0, rows: [] }));
  assert.equal((await send(`/api/library/saved/${itemId}`, { method: 'PATCH', body: { note: 'x' } })).status, 403);
  assert.equal((await send(`/api/library/saved/${itemId}`, { method: 'DELETE' })).status, 403);
  assert.equal(calls.filter((call) => /^\s*(UPDATE|DELETE)/.test(call.sql)).length, 0, 'nothing changed');
  for (const call of calls) assert.ok(call.parameters.includes(officeId), 'every read is scoped to the office');
  assertWellFormed(calls);

  t.mock.restoreAll();
  const adminCalls = setup(t, { role: 'admin' }, async (sql) => (sql.includes('FROM office_library_items s') ? { rowCount: 1, rows: [savedRow] } : { rowCount: 1, rows: [] }));
  assert.equal((await send(`/api/library/saved/${itemId}`, { method: 'DELETE' })).status, 200);
  const deleted = adminCalls.find((call) => call.sql.startsWith('DELETE'));
  assert.deepEqual(deleted.parameters, [itemId, officeId]);
});

test('saving writes the office of the session, and a repeat is a conflict', async (t) => {
  const calls = setup(t, {}, async (sql) => {
    if (sql.includes('INSERT INTO office_library_items')) throw Object.assign(new Error('duplicate'), { code: '23505' });
    return { rowCount: 0, rows: [] };
  });
  const response = await send('/api/library/saved', { method: 'POST', body: { article_id: articleId, tags: ['إيجار'] } });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'ALREADY_SAVED');
  const insert = calls.find((call) => call.sql.includes('INSERT INTO office_library_items'));
  assert.equal(insert.parameters[0], officeId);
  assert.equal(insert.parameters[5], appUserId);
  for (const body of [{}, { article_id: articleId, ruling_id: articleId }, { article_id: 'x' }, { article_id: articleId, office_id: officeId }]) {
    assert.equal((await send('/api/library/saved', { method: 'POST', body })).status, 400, JSON.stringify(body));
  }
});

test('a case reference needs access to the case', async (t) => {
  const calls = setup(t, {}, async () => ({ rowCount: 0, rows: [] }));
  assert.equal((await send(`/api/library/cases/${caseId}/references`, { method: 'POST', body: { article_id: articleId } })).status, 404);
  assert.equal((await send(`/api/library/cases/${caseId}/references`)).status, 404);
  assert.equal(calls.filter((call) => call.sql.includes('case_legal_references')).length, 0, 'nothing about the case was read or written');
  assert.ok(calls.some((call) => call.sql.includes('FROM legal_cases lc')), 'the case was looked up with the case-file rules');
});

/* ───────────────────────── import ───────────────────────── */

test('an import file with errors is rejected with every problem, before any write', async (t) => {
  const connect = t.mock.method(pool, 'connect', async () => assert.fail('no connection for an invalid file'));
  const calls = setup(t, { is_platform_admin: true, office_id: null, role: null });
  const response = await send('/api/platform/library/import', {
    method: 'POST',
    body: { laws: [{ key: 'a', jurisdiction: 'xx', title: '', articles: [{ number: '1', text: 'x' }, { number: '1', text: 'y' }] }], stray: [] },
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, 'IMPORT_INVALID');
  assert.deepEqual(body.errors.map((error) => error.path), ['stray', 'laws[0].key', 'laws[0].jurisdiction', 'laws[0].title', 'laws[0].articles[1].number']);
  assert.equal(connect.mock.callCount(), 0);
  assert.equal(calls.length, 0);
});

test('a dry run imports inside a transaction and rolls it back', async (t) => {
  const statements = [];
  const client = {
    query: async (sql) => {
      statements.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
      if (sql.includes('RETURNING issue_id') || sql.includes('RETURNING law_id') || sql.includes('RETURNING ruling_id')) {
        return { rowCount: 1, rows: [{ issue_id: 'i', law_id: 'l', ruling_id: 'r', inserted: true }] };
      }
      if (sql.includes('RETURNING (xmax = 0)')) return { rowCount: 1, rows: [{ inserted: true }] };
      if (sql.includes('AS kept')) return { rowCount: 1, rows: [{ kept: 0 }] };
      return { rowCount: 0, rows: [] };
    },
    release: () => {},
  };
  t.mock.method(pool, 'connect', async () => client);
  setup(t, { is_platform_admin: true, office_id: null, role: null });
  const file = {
    laws: [{ key: 'law-1', jurisdiction: 'ps', title: 'قانون', articles: [{ number: '1', text: 'نص' }] }],
    synonyms: [{ phrase: 'ما دفع', terms: ['تخلف'] }],
  };
  const response = await send('/api/platform/library/import?dryRun=true', { method: 'POST', body: file });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.dry_run, true);
  assert.deepEqual(body.summary.laws, { added: 1, updated: 0 });
  assert.deepEqual(body.summary.articles, { added: 1, updated: 0 });
  assert.equal(statements[0], 'BEGIN');
  assert.ok(statements[1].startsWith('SELECT pg_advisory_xact_lock'));
  assert.equal(statements.at(-1), 'ROLLBACK');
  assert.ok(!statements.includes('COMMIT'));
  assert.ok(!statements.some((statement) => statement.includes('legal_library_imports')), 'a dry run is not logged');
});

test('the import format accepts a complete record and keeps only known values', () => {
  const data = validateImport({
    format: 'qadiyati-legal-library/1',
    gazette: [{ key: 'g-1', number: 3, publishedOn: '2020-01-15', items: [{ title: 'بند', law: 'law-1' }] }],
    laws: [{ key: 'law-1', jurisdiction: 'ps', kind: 'decree_law', title: ' قرار بقانون ', number: 7, year: '2020', gazetteIssue: 'g-1', articles: [{ number: '1', text: 'نص' }] }],
    rulings: [{ key: 'r-1', jurisdiction: 'ps', court: 'cassation', text: 'نص الحكم', articles: [{ law: 'law-1', number: '1' }] }],
    synonyms: [{ phrase: 'طلّعه من البيت', terms: ['الإخلاء'] }],
  });
  assert.equal(data.laws[0].title, 'قرار بقانون');
  assert.equal(data.laws[0].number, '7');
  assert.equal(data.laws[0].year, 2020);
  assert.equal(data.laws[0].status, 'in_force');
  assert.equal(data.synonyms[0].phrase, normalizeArabic('طلّعه من البيت'));
  assert.throws(() => validateImport({}), (error) => error.errors[0].message === 'has nothing to import');
  assert.throws(() => validateImport({ gazette: [{ key: 'g-1', number: 1, publishedOn: '2020-02-30' }] }), (error) => error.errors[0].path === 'gazette[0].publishedOn');
});
