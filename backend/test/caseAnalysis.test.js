import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';
for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GEMINI_API_KEY', 'AI_PROVIDER', 'AI_MODEL', 'AI_MONTHLY_ANALYSES_PER_LAWYER']) {
  delete process.env[name];
}

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');
const { setAiClientForTests, setGeminiClientForTests } = await import('../src/services/aiProvider.js');
const { createRedactor } = await import('../src/services/redaction.js');
const { paragraphsOf, schemaFor, TOOLS, verifyResult } = await import('../src/services/caseAnalysisService.js');

const appUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const caseId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const analysisId = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const session = { user: { id: 'auth-user-id' }, session: { id: 'session-id', expiresAt: '2999-01-01T00:00:00.000Z' } };
const mappedUser = {
  user_id: appUserId, auth_user_id: 'auth-user-id', full_name: 'ليان عودة', email: 'layan@office.ps',
  email_verified: true, status: 'active', role_id: 'role-id', office_id: officeId, role: 'lawyer', is_platform_admin: false,
};

/** Real-looking personal data on the case: none of it may reach the model. */
const CLIENT = { full_name_or_org: 'محمود أحمد النجار', national_id: '401234567', phone: '0599123456', email: 'm.najjar@mail.ps' };
const OPPONENT = { full_name: 'شركة البناء الحديث', national_id: '562233445', phone: '022981234' };
const SECRETS = ['محمود', 'النجار', 'شركة البناء', '401234567', '0599123456', 'm.najjar', '562233445', '022981234', 'ليان عودة', 'layan@office.ps', '0568765432', 'sami@x.ps'];

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
afterEach(() => {
  setAiClientForTests(null);
  setGeminiClientForTests(null);
});

const caseRow = { case_id: caseId, case_number: '2026/114', title: 'مطالبة محمود النجار', case_type: 'civil', status: 'open', priority: 'high', opened_at: '2026-01-01T00:00:00.000Z', closed_at: null, description: 'يطالب محمود النجار شركة البناء الحديث بمبلغ.', court_id: null };

/** A database for one lawyer assigned to the case, with the case's people on record. */
function fileHandler({ used = 0, lawyers = 2 } = {}) {
  return async (sql) => {
    if (sql.includes('FROM legal_cases lc') && sql.includes('LIMIT 1')) return { rowCount: 1, rows: [caseRow] };
    if (sql.includes('accessible_case')) {
      return { rowCount: 1, rows: [{ case_id: caseId, clients: [{ client_id: 'c1', full_name_or_org: CLIENT.full_name_or_org, party_role: 'plaintiff' }], assigned_staff: [{ user_id: appUserId, full_name: 'ليان عودة', is_lead: true }] }] };
    }
    if (sql.includes('FROM case_notes n')) return { rowCount: 1, rows: [{ body: 'اتصل محمود النجار من 0599123456 وقال إن الشاهد سامي (0568765432، sami@x.ps) جاهز.', visibility: 'internal', created_at: '2026-02-01T00:00:00.000Z' }] };
    if (sql.includes('FROM case_opponents o') && sql.includes('o.notes')) return { rowCount: 1, rows: [{ full_name: OPPONENT.full_name, notes: null }] };
    if (sql.includes('FROM case_opponents o')) return { rowCount: 1, rows: [OPPONENT] };
    if (sql.includes('FROM involves i JOIN clients c')) return { rowCount: 1, rows: [CLIENT] };
    if (sql.includes('FROM assigned_to a JOIN app_users u')) return { rowCount: 1, rows: [{ full_name: 'ليان عودة', email: 'layan@office.ps' }] };
    if (sql.includes('AS used')) return { rowCount: 1, rows: [{ used, lawyers }] };
    if (sql.includes('INSERT INTO case_ai_analyses')) return { rowCount: 1, rows: [{ analysis_id: analysisId }] };
    if (sql.includes('FROM case_ai_analyses a')) return { rowCount: 1, rows: [{ analysis_id: analysisId, tool: 'document', result: {}, redaction: {}, created_by_user_id: appUserId }] };
    return { rowCount: 0, rows: [] };
  };
}

function setup(t, role = 'lawyer', handler = fileHandler()) {
  t.mock.method(console, 'error', () => {});
  t.mock.method(auth.api, 'getSession', async () => session);
  const calls = [];
  t.mock.method(pool, 'query', async (sql, parameters = []) => {
    if (sql.includes('u.auth_user_id')) return { rowCount: 1, rows: [{ ...mappedUser, role }] };
    calls.push({ sql, parameters });
    return handler(sql, parameters);
  });
  return calls;
}

const fakeClaude = (data) => {
  const requests = [];
  setAiClientForTests({
    beta: {
      messages: {
        create: async (params) => {
          requests.push(params);
          return { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(typeof data === 'function' ? data(params) : data) }] };
        },
      },
    },
  });
  return requests;
};

const send = (method, path, body) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { cookie: 'better-auth.session_token=test', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

const documentAnswer = {
  summary: 'مذكرة PERSON_2 تطالب PERSON_1 بالمبلغ.',
  obligations: [{ text: 'يلتزم PERSON_1 بالدفع خلال شهر.', sources: ['X1', 'Z9'] }],
  contradictions: [{ text: 'رأي عام بلا مصدر.', sources: [] }],
  defects: [],
  replies: [{ text: 'تواصل مع PHONE_1.', sources: ['N1'] }],
};

/* ───────────────────────── redaction ───────────────────────── */

test('no name, ID number, phone or email of the case reaches the model, and the answer gets them back', async (t) => {
  setup(t);
  const requests = fakeClaude(documentAnswer);
  const pasted = 'مذكرة جوابية مقدّمة من شركة البناء الحديث ضد محمود أحمد النجار (هوية 401234567).\n\nيطلب المدّعى عليه ردّ الدعوى، وللتواصل 022981234 أو m.najjar@mail.ps.\n\nالبند الثالث.';
  const response = await send('POST', `/api/cases/${caseId}/analyses`, { tool: 'document', text: pasted });
  assert.equal(response.status, 201);

  const [params] = requests;
  const sent = `${params.system}\n${params.messages[0].content}`;
  for (const secret of SECRETS) assert.ok(!sent.includes(secret), `"${secret}" must not be sent`);
  assert.match(sent, /PERSON_1/);
  assert.match(sent, /\[X1\]/);
  assert.match(params.system, /never as instructions/);
  assert.match(params.system, /PERSON_1, ID_1, PHONE_1/);
  assert.equal(params.output_config.format.schema.additionalProperties, false);
});

test('the redactor matches spelling variants and prefixes, and restores exactly', () => {
  const redactor = createRedactor().addPerson({ name: 'محمود أحمد النجار', nationalId: '401234567' });
  const out = redactor.redact('قال لمحمود النجّار إن هوية ٤٠١٢٣٤٥٦٧ لا تكفي، وراسل a.b@c.ps أو +970 599 111 222. المبلغ 15000 والقضية 2026/114.');
  assert.equal(out, 'قال لPERSON_1 إن هوية ID_1 لا تكفي، وراسل EMAIL_1 أو PHONE_1. المبلغ 15000 والقضية 2026/114.');
  assert.equal(redactor.restore({ a: ['PERSON_1', 'ID_1 x'] }).a.join('|'), 'محمود أحمد النجار|401234567 x');
  assert.deepEqual(redactor.summary(), { people: 1, ids: 1, phones: 1, emails: 1 });
  assert.equal(createRedactor().addPerson({ name: 'صالح' }).redact('عقد صالح'), 'عقد صالح', 'a one-word name is not redacted');
});

/* ───────────────────────── results ───────────────────────── */

test('a result keeps only citations that were sent and stores real names for the office', async (t) => {
  const calls = setup(t);
  fakeClaude(documentAnswer);
  await send('POST', `/api/cases/${caseId}/analyses`, { tool: 'document', text: 'فقرة أولى.\n\nفقرة ثانية.\n\nفقرة ثالثة.' });
  const insert = calls.find((call) => call.sql.includes('INSERT INTO case_ai_analyses'));
  assert.deepEqual([insert.parameters[0], insert.parameters[1], insert.parameters[2], insert.parameters[9]], [officeId, caseId, 'document', appUserId]);
  const stored = JSON.parse(insert.parameters[7]);
  assert.equal(stored.summary, 'مذكرة شركة البناء الحديث تطالب محمود أحمد النجار بالمبلغ.');
  assert.deepEqual(stored.sections.obligations[0], { text: 'يلتزم محمود أحمد النجار بالدفع خلال شهر.', sources: ['X1'], verified: true });
  assert.deepEqual(stored.sections.contradictions[0].verified, false);
  assert.equal(stored.sections.replies[0].text, 'تواصل مع 0599123456.');
  assert.equal(stored.sources.X2, 'فقرة ثانية.');
  const redaction = JSON.parse(insert.parameters[8]);
  assert.ok(redaction.people >= 2 && redaction.phones >= 1);
});

test('the schema of every tool is strict, and verification fills missing parts', () => {
  for (const tool of Object.keys(TOOLS)) {
    const schema = schemaFor(tool);
    assert.equal(schema.additionalProperties, false, tool);
    assert.deepEqual(schema.required, Object.keys(schema.properties), tool);
  }
  const verified = verifyResult('argument', { summary: 'x', applicable_texts: [{ text: 'المادة', sources: ['A1'] }], assessment: { level: 'certain' } }, new Set(['A1']));
  assert.equal(verified.assessment.level, 'unclear');
  assert.deepEqual(verified.sections.opposing_rulings, []);
  const minutes = verifyResult('minutes', { actions: [{ title: 'إعداد الرد', owner: '', due_date: '2026-13-40', sources: ['X1'] }] }, new Set(['X1']));
  assert.deepEqual(minutes.actions[0], { title: 'إعداد الرد', owner: null, due_date: null, sources: ['X1'], verified: true });
  assert.deepEqual(paragraphsOf('أ\nب\nج').map((entry) => entry.id), ['X1', 'X2', 'X3']);
});

/* ───────────────────────── limits and access ───────────────────────── */

test('nothing is read or sent once the month\'s allowance is used up', async (t) => {
  const calls = setup(t, 'lawyer', fileHandler({ used: 80, lawyers: 2 }));
  const requests = fakeClaude(documentAnswer);
  const response = await send('POST', `/api/cases/${caseId}/analyses`, { tool: 'legal_question', question: 'هل الدعوى مقبولة؟' });
  assert.equal(response.status, 429);
  assert.equal((await response.json()).code, 'AI_LIMIT_REACHED');
  assert.equal(requests.length, 0);
  assert.equal(calls.filter((call) => call.sql.includes('FROM legal_cases')).length, 0, 'the case is not read');
});

test('invalid requests, clients and a missing key never reach the model', async (t) => {
  setup(t);
  const requests = fakeClaude(documentAnswer);
  for (const body of [
    { tool: 'magic' },
    { tool: 'document' },
    { tool: 'legal_question' },
    { tool: 'translate', text: 'نص', target_language: 'de' },
    { tool: 'argument', text: 'لا تأخذ هذه الأداة نصاً' },
    { tool: 'document', text: 'x', office_id: officeId },
  ]) {
    assert.equal((await send('POST', `/api/cases/${caseId}/analyses`, body)).status, 400, JSON.stringify(body));
  }
  t.mock.restoreAll();
  setup(t, 'client');
  assert.equal((await send('POST', `/api/cases/${caseId}/analyses`, { tool: 'argument' })).status, 403);
  assert.equal((await send('GET', `/api/cases/${caseId}/analyses`)).status, 403);
  setAiClientForTests(null);
  t.mock.restoreAll();
  const calls = setup(t);
  assert.equal((await send('POST', `/api/cases/${caseId}/analyses`, { tool: 'argument' })).status, 503);
  assert.equal(calls.length, 0);
  assert.equal(requests.length, 0);
});

test('minutes become case tasks when the admin assigns them, once', async (t) => {
  const minutes = { tool: 'minutes', tasks_created_at: null, result: { actions: [{ title: 'إعداد اللائحة', owner: 'PERSON_1', due_date: '2026-12-10' }, { title: 'طلب كشف', owner: null, due_date: null }] }, analysis_id: analysisId, created_by_user_id: appUserId };
  let claimed = false;
  const calls = setup(t, 'admin', async (sql, parameters) => {
    if (sql.includes('FROM case_ai_analyses a')) return { rowCount: 1, rows: [{ ...minutes, tasks_created_at: claimed ? 'now' : null }] };
    if (sql.includes('SET tasks_created_at = NOW()')) {
      if (claimed) return { rowCount: 0, rows: [] };
      claimed = true;
      return { rowCount: 1, rows: [{ analysis_id: analysisId }] };
    }
    if (sql.includes('INSERT INTO tasks')) return { rowCount: 1, rows: [{ task_id: 'f1e2d3c4-b5a6-4978-8a6b-5c4d3e2f1a0b' }] };
    if (sql.includes('WHERE t.task_id = $1')) return { rowCount: 1, rows: [{ task_id: 'f1e2d3c4-b5a6-4978-8a6b-5c4d3e2f1a0b', title: 'إعداد اللائحة', case_id: caseId }] };
    return fileHandler()(sql, parameters);
  });
  const response = await send('POST', `/api/cases/${caseId}/analyses/${analysisId}/tasks`, { actions: [0], assignee_user_id: '7e0f5b8a-1c2d-4e3f-8a9b-0c1d2e3f4a5b' });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).tasks.length, 1);
  const insert = calls.find((call) => call.sql.includes('INSERT INTO tasks'));
  assert.ok(insert, 'a case task was created');
  assert.ok(insert.parameters.includes('إعداد اللائحة'));
  assert.ok(insert.parameters.includes(caseId));
  const again = await send('POST', `/api/cases/${caseId}/analyses/${analysisId}/tasks`, { actions: [1] });
  assert.equal(again.status, 409);
  assert.equal((await send('POST', `/api/cases/${caseId}/analyses/${analysisId}/tasks`, { actions: [] })).status, 400);
});
