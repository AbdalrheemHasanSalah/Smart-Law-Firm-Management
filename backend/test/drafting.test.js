import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';
for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GEMINI_API_KEY', 'AI_PROVIDER', 'AI_MONTHLY_ANALYSES_PER_LAWYER']) delete process.env[name];

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');
const { setAiClientForTests } = await import('../src/services/aiProvider.js');
const { BUILTIN_TEMPLATES, fillTemplate } = await import('../src/services/builtinTemplates.js');
const { fingerprintOf } = await import('../src/services/printService.js');
const { canonicalDraft } = await import('../src/services/draftingService.js');

const appUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const caseId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const draftId = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const session = { user: { id: 'auth-user-id' }, session: { id: 'session-id', expiresAt: '2999-01-01T00:00:00.000Z' } };
const mappedUser = {
  user_id: appUserId, auth_user_id: 'auth-user-id', full_name: 'ليان عودة', email: 'layan@office.ps',
  email_verified: true, status: 'active', role_id: 'role-id', office_id: officeId, role: 'lawyer', is_platform_admin: false,
};
const caseRow = { case_id: caseId, case_number: '2026/114', title: 'مطالبة', case_type: 'civil', status: 'open', priority: 'high', opened_at: '2026-01-01T00:00:00.000Z', closed_at: null, description: null, court_id: null };
const draftRow = (status) => ({ draft_id: draftId, case_id: caseId, kind: 'contract', title: 'عقد', body: 'المادة (1): …', source: 'blank', status, created_by_user_id: appUserId, created_by_name: 'ليان عودة' });

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
afterEach(() => setAiClientForTests(null));

function setup(t, role = 'lawyer', handler = async () => ({ rowCount: 0, rows: [] })) {
  t.mock.method(console, 'error', () => {});
  t.mock.method(auth.api, 'getSession', async () => session);
  const calls = [];
  t.mock.method(pool, 'query', async (sql, parameters = []) => {
    if (sql.includes('u.auth_user_id')) return { rowCount: 1, rows: [{ ...mappedUser, role }] };
    calls.push({ sql, parameters });
    if (sql.includes('FROM legal_cases lc') && sql.includes('LIMIT 1')) return { rowCount: 1, rows: [caseRow] };
    return handler(sql, parameters);
  });
  return calls;
}

const send = (method, path, body) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { cookie: 'better-auth.session_token=test', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

test('built-in skeletons hold structure and fields only, and filling leaves gaps visible', () => {
  assert.ok(BUILTIN_TEMPLATES.length >= 10);
  for (const template of BUILTIN_TEMPLATES) {
    assert.match(template.body, /هيكل للمراجعة/, `${template.key} says it is a skeleton to review`);
    assert.doesNotMatch(template.body, /قانون رقم|لسنة \d{4}/, `${template.key} cites no law`);
  }
  assert.equal(fillTemplate('{{client_name}} / {{court_name}} / {{nope}}', { client_name: ' محمود ' }), 'محمود / […] / {{nope}}');
});

test('a final document cannot be edited or deleted, and its fingerprint covers title and text', async (t) => {
  const calls = setup(t, 'lawyer', async (sql) => (sql.includes('FROM case_drafts d') ? { rowCount: 1, rows: [draftRow('final')] } : { rowCount: 0, rows: [] }));
  assert.equal((await send('PATCH', `/api/cases/${caseId}/drafts/${draftId}`, { body: 'تعديل' })).status, 409);
  assert.equal((await send('DELETE', `/api/cases/${caseId}/drafts/${draftId}`)).status, 409);
  assert.equal(calls.filter((call) => /^\s*(UPDATE|DELETE) /.test(call.sql)).length, 0);
  assert.equal(fingerprintOf(canonicalDraft(' عقد ', 'نص\r\n')), fingerprintOf('عقد\n\nنص'));
  assert.notEqual(fingerprintOf(canonicalDraft('عقد', 'نص')), fingerprintOf(canonicalDraft('عقد', 'نص.')));
});

test('finalizing claims the draft once, then issues a code for the office', async (t) => {
  let final = false;
  const calls = setup(t, 'lawyer', async (sql) => {
    if (sql.includes('FROM case_drafts d')) return { rowCount: 1, rows: [{ ...draftRow(final ? 'final' : 'draft'), verification_code: final ? 'ABCDEFGHJK' : null }] };
    if (sql.includes("SET status = 'final'")) {
      final = true;
      return { rowCount: 1, rows: [{ draft_id: draftId }] };
    }
    if (sql.includes('INSERT INTO issued_documents')) return { rowCount: 1, rows: [{ code: 'ABCDEFGHJK', issued_at: 'now', content_sha256: 'f'.repeat(64) }] };
    return { rowCount: 0, rows: [] };
  });
  const response = await send('POST', `/api/cases/${caseId}/drafts/${draftId}/finalize`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).draft.verification_code, 'ABCDEFGHJK');
  const issued = calls.find((call) => call.sql.includes('INSERT INTO issued_documents'));
  assert.equal(issued.parameters[0], officeId);
  assert.match(issued.parameters[1], /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/);
  assert.equal(issued.parameters[3], fingerprintOf(canonicalDraft('عقد', 'المادة (1): …')));
  assert.equal(issued.parameters[4], draftId);
  assert.equal((await send('POST', `/api/cases/${caseId}/drafts/${draftId}/finalize`)).status, 409, 'a second finalize is refused');
  assert.equal((await send('POST', `/api/cases/${caseId}/drafts/${draftId}/revoke`)).status, 403, 'only the admin revokes');
});

test('the public check reveals only status, office, kind and date', async (t) => {
  setup(t, 'lawyer', async (sql) =>
    sql.includes('FROM issued_documents i') ? { rowCount: 1, rows: [{ kind: 'contract', issued_at: '2026-11-28T10:00:00.000Z', revoked_at: null, office_name: 'مكتب الخطيب' }] } : { rowCount: 0, rows: [] }
  );
  const valid = await (await fetch(`${baseUrl}/api/public/verify/abcdefghjk`)).json();
  assert.deepEqual(Object.keys(valid).sort(), ['issued_at', 'kind', 'office_name', 'revoked_at', 'status']);
  assert.equal(valid.status, 'valid');
  const bad = await (await fetch(`${baseUrl}/api/public/verify/${encodeURIComponent("1' OR '1'='1")}`)).json();
  assert.deepEqual(bad, { status: 'not_found' });
});

test('an AI draft is redacted, counts toward the allowance, and stops when it is used up', async (t) => {
  const requests = [];
  setAiClientForTests({
    beta: {
      messages: {
        create: async (params) => {
          requests.push(params);
          return { model: 'fake', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ title: 'عقد مع PERSON_1', body: 'المادة (1): PERSON_1 …' }) }] };
        },
      },
    },
  });
  const people = async (sql) => {
    if (sql.includes('AS used')) return { rowCount: 1, rows: [{ used: 0, lawyers: 1 }] };
    if (sql.includes('FROM involves i JOIN clients c')) return { rowCount: 1, rows: [{ full_name_or_org: 'محمود أحمد النجار', national_id: '401234567', phone: '0599123456' }] };
    if (sql.includes('INSERT INTO case_drafts')) return { rowCount: 1, rows: [{ draft_id: draftId }] };
    if (sql.includes('FROM case_drafts d')) return { rowCount: 1, rows: [draftRow('draft')] };
    return { rowCount: 0, rows: [] };
  };
  const calls = setup(t, 'lawyer', people);
  const response = await send('POST', `/api/cases/${caseId}/drafts/generate`, { kind: 'contract', description: 'عقد إيجار لمحمود النجار، هاتفه 0599123456' });
  assert.equal(response.status, 201);
  const sent = `${requests[0].system}\n${requests[0].messages[0].content}`;
  for (const secret of ['محمود', 'النجار', '0599123456', '401234567', 'ليان عودة']) assert.ok(!sent.includes(secret), secret);
  const insert = calls.find((call) => call.sql.includes('INSERT INTO case_drafts'));
  assert.equal(insert.parameters[3], 'عقد مع محمود أحمد النجار');
  assert.equal(insert.parameters[5], 'ai');

  t.mock.restoreAll();
  setup(t, 'lawyer', async (sql, parameters) => (sql.includes('AS used') ? { rowCount: 1, rows: [{ used: 40, lawyers: 1 }] } : people(sql, parameters)));
  const limited = await send('POST', `/api/cases/${caseId}/drafts/generate`, { kind: 'contract', description: 'x' });
  assert.equal(limited.status, 429);
  assert.equal(requests.length, 1);
});

test('assistants use templates but do not edit them; prints need text and a known kind', async (t) => {
  setup(t, 'assistant');
  assert.equal((await send('POST', '/api/templates', { kind: 'letter', title: 'كتاب', body: 'نص' })).status, 403);
  assert.equal((await send('GET', '/api/templates')).status, 200);
  assert.equal((await send('PUT', '/api/letterhead', { subtitle: 'x' })).status, 403, 'only the admin edits the letterhead');
  for (const body of [{ kind: 'secret', content: 'x' }, { kind: 'statement', content: '' }, { kind: 'statement', content: 'x', office_id: officeId }]) {
    assert.equal((await send('POST', '/api/prints', body)).status, 400, JSON.stringify(body));
  }
  t.mock.restoreAll();
  setup(t, 'client');
  assert.equal((await send('GET', `/api/cases/${caseId}/drafts`)).status, 403);
  assert.equal((await send('GET', '/api/letterhead')).status, 403);
});
