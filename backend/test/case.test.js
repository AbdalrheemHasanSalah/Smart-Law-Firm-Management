import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');

const authUserId = 'auth-user-id';
const appUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const caseId = '1cdd115e-0279-48b4-a795-1be1d5a50d0b';
const session = {
  user: { id: authUserId },
  session: { id: 'session-id', expiresAt: '2999-01-01T00:00:00.000Z' },
};
const mappedUser = {
  user_id: appUserId,
  auth_user_id: authUserId,
  full_name: 'Test User',
  email: 'test@example.com',
  email_verified: true,
  status: 'active',
  role_id: 'role-id',
  role: 'admin',
};
const caseRecord = {
  case_id: caseId,
  case_number: 'CASE-001',
  title: 'Contract dispute',
  case_type: 'civil',
  status: 'open',
  priority: 'medium',
  opened_at: '2026-01-01T00:00:00.000Z',
  closed_at: null,
  description: 'Disputed contract.',
  court_id: null,
};

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  await pool.end();
});

function setupRequest(
  t,
  role,
  databaseHandler = async () => ({ rowCount: 0, rows: [] }),
  userId = appUserId,
  options = {}
) {
  t.mock.method(console, 'error', () => {});
  t.mock.method(auth.api, 'getSession', async () => options.session ?? session);
  const calls = [];
  t.mock.method(pool, 'query', async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    if (role === 'no-app-user' && sql.includes('u.auth_user_id')) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('u.auth_user_id')) {
      return { rowCount: 1, rows: [{ ...mappedUser, user_id: userId, role }] };
    }
    return databaseHandler(sql, parameters);
  });
  return calls;
}

async function request(method, path, body, cookie = 'better-auth.session_token=test-session') {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  const options = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  return fetch(`${baseUrl}${path}`, options);
}

test('unauthenticated requests cannot access case endpoints', async (t) => {
  const calls = [];
  t.mock.method(auth.api, 'getSession', async () => null);
  t.mock.method(pool, 'query', async (sql, parameters) => {
    calls.push({ sql, parameters });
    return { rowCount: 0, rows: [] };
  });
  for (const [method, path, body] of [
    ['GET', '/api/cases'],
    ['POST', '/api/cases', { case_number: 'A', title: 'B', case_type: 'C' }],
    ['POST', `/api/cases/${caseId}/assignments`, { user_id: appUserId }],
    ['GET', `/api/cases/${caseId}`],
    ['PATCH', `/api/cases/${caseId}`, { title: 'Updated' }],
  ]) {
    assert.equal((await request(method, path, body)).status, 401);
  }
  assert.equal(calls.length, 0);
  assert.equal(calls.some(({ sql }) => sql.includes('INSERT INTO assigned_to')), false);
});

test('missing application-user mappings fail closed', async (t) => {
  const calls = setupRequest(t, 'no-app-user', async () => {
    assert.fail('Cases cannot be queried without an application-user mapping.');
  });
  assert.equal((await request('GET', '/api/cases')).status, 401);
  assert.equal(calls.length, 1);
});

test('unknown roles cannot read or create cases', async (t) => {
  const calls = setupRequest(t, 'unknown');
  assert.equal((await request('GET', '/api/cases')).status, 403);
  assert.equal((await request('POST', '/api/cases', {
    case_number: 'CASE-001',
    title: 'Test',
    case_type: 'civil',
  })).status, 403);
  assert.equal(calls.length, 2);
});

test('admins can list all cases and receive stable pagination metadata', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql) => {
    assert.doesNotMatch(sql, /assigned_to|involves/);
    if (sql.includes('COUNT(*)')) return { rowCount: 1, rows: [{ total: 1 }] };
    return { rowCount: 1, rows: [caseRecord] };
  });
  const response = await request('GET', '/api/cases');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    cases: [caseRecord],
    pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
  });
  assert.equal(calls.length, 3);
});

test('admins can create cases with schema-supported fields', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql, parameters) => {
    assert.match(sql, /INSERT INTO legal_cases/);
    assert.doesNotMatch(sql, /INSERT INTO legal_cases\s*\([^)]*(?:user_id|client_id|assignment)/i);
    assert.deepEqual(parameters, [
      'CASE-002',
      'New matter',
      'civil',
      'open',
      'medium',
      null,
      null,
      null,
      null,
    ]);
    return { rowCount: 1, rows: [{ ...caseRecord, case_number: 'CASE-002', title: 'New matter' }] };
  });
  const response = await request('POST', '/api/cases', {
    case_number: ' CASE-002 ',
    title: ' New matter ',
    case_type: 'civil',
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).case.case_number, 'CASE-002');
  assert.equal(calls.length, 2);
});

test('only admins can create cases', async (t) => {
  for (const role of ['lawyer', 'assistant', 'client']) {
    await t.test(role, async (subtest) => {
      const calls = setupRequest(subtest, role);
      assert.equal((await request('POST', '/api/cases', {
        case_number: 'CASE-002',
        title: 'New matter',
        case_type: 'civil',
      })).status, 403);
      assert.equal(calls.length, 1);
    });
  }
});

test('lawyers and assistants can read only cases assigned to their application user', async (t) => {
  for (const role of ['lawyer', 'assistant']) {
    await t.test(role, async (subtest) => {
      const calls = setupRequest(subtest, role, async (sql, parameters) => {
        assert.match(sql, /EXISTS\s*\(/);
        assert.match(sql, /FROM assigned_to assignment/);
        assert.match(sql, /assignment\.user_id = \$\d+/);
        assert.ok(parameters.includes(appUserId));
        if (sql.includes('COUNT(*)')) return { rowCount: 1, rows: [{ total: 1 }] };
        return { rowCount: 1, rows: [caseRecord] };
      });
      assert.equal((await request('GET', '/api/cases')).status, 200);
      assert.equal((await request('GET', `/api/cases/${caseId}`)).status, 200);
      assert.equal(calls.length, 5);
    });
  }
});

test('staff cannot access unassigned case IDs or update them', async (t) => {
  const calls = setupRequest(t, 'lawyer', async (sql, parameters) => {
    assert.match(sql, /FROM assigned_to assignment/);
    assert.ok(parameters.includes(appUserId));
    return { rowCount: 0, rows: [] };
  });
  assert.equal((await request('GET', `/api/cases/${caseId}`)).status, 404);
  assert.equal((await request('PATCH', `/api/cases/${caseId}`, { title: 'Modified' })).status, 404);
  assert.equal(calls.length, 4);
});

test('client reads are scoped to cases linked to that client user', async (t) => {
  const calls = setupRequest(t, 'client', async (sql, parameters) => {
    assert.match(sql, /EXISTS\s*\(/);
    assert.match(sql, /FROM involves i\s+JOIN clients c ON c\.client_id = i\.client_id/);
    assert.match(sql, /c\.user_id = \$\d+/);
    assert.ok(parameters.includes(appUserId));
    if (sql.includes('COUNT(*)')) return { rowCount: 1, rows: [{ total: 1 }] };
    return { rowCount: 1, rows: [caseRecord] };
  });
  assert.equal((await request('GET', '/api/cases')).status, 200);
  assert.equal((await request('GET', `/api/cases/${caseId}`)).status, 200);
  assert.equal(calls.length, 5);
});

test('clients cannot access unrelated case IDs or modify case details', async (t) => {
  const calls = setupRequest(t, 'client', async (sql, parameters) => {
    assert.match(sql, /c\.user_id = \$\d+/);
    assert.ok(parameters.includes(appUserId));
    return { rowCount: 0, rows: [] };
  });
  assert.equal((await request('GET', `/api/cases/${caseId}`)).status, 404);
  assert.equal((await request('PATCH', `/api/cases/${caseId}`, { title: 'Modified' })).status, 403);
  assert.equal(calls.length, 3);
});

test('denied client case access does not disclose case contents or database details', async (t) => {
  const calls = setupRequest(t, 'client', async () => ({
    rowCount: 0,
    rows: [],
  }));
  const response = await request('GET', `/api/cases/${caseId}`);
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.deepEqual(body, { error: 'Case not found.' });
  assert.equal(JSON.stringify(body).includes(caseRecord.title), false);
  assert.equal(JSON.stringify(body).includes(caseRecord.description), false);
  assert.equal(JSON.stringify(body).includes('internal database'), false);
  assert.equal(calls.length, 2);
});

test('malformed actor IDs fail closed for staff and clients', async (t) => {
  for (const role of ['admin', 'lawyer', 'assistant', 'client']) {
    await t.test(role, async (subtest) => {
      const calls = setupRequest(subtest, role, async () => {
        assert.fail('Cases must not be queried for a malformed actor ID.');
      }, 'not-a-uuid');
      assert.equal((await request('GET', '/api/cases')).status, 403);
      assert.equal(calls.length, 1);
    });
  }
});

test('malformed case UUIDs are rejected before reading case records', async (t) => {
  const calls = setupRequest(t, 'admin');
  assert.equal((await request('GET', '/api/cases/not-a-uuid')).status, 400);
  assert.equal((await request('PATCH', '/api/cases/not-a-uuid', { title: 'x' })).status, 400);
  assert.equal(calls.length, 2);
});

test('required case fields and status/priority enum values are validated', async (t) => {
  const calls = setupRequest(t, 'admin');
  const payloads = [
    { case_number: 'A', title: 'B' },
    { case_number: 'A', title: 'B', case_type: 'civil', status: 'pending' },
    { case_number: 'A', title: 'B', case_type: 'civil', priority: 'critical' },
    { case_number: ' ', title: 'B', case_type: 'civil' },
  ];
  for (const payload of payloads) {
    assert.equal((await request('POST', '/api/cases', payload)).status, 400);
  }
  assert.equal(calls.length, payloads.length);
});

test('case search is parameterized, escaped, and pagination is capped', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql) => {
    if (sql.includes('COUNT(*)')) return { rowCount: 1, rows: [{ total: 1 }] };
    return { rowCount: 1, rows: [caseRecord] };
  });
  const response = await request('GET', '/api/cases?page=2&pageSize=999&search=%25_%27');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.pagination.pageSize, 50);
  assert.match(calls[1].sql, /case_number ILIKE \$1 ESCAPE E'\\\\'/);
  assert.equal(calls[1].parameters[0], "%\\%\\_'%");
  assert.equal(calls[2].parameters.at(-2), 50);
  assert.equal(calls[2].parameters.at(-1), 50);
  assert.match(calls[2].sql, /ORDER BY lc\.opened_at DESC, lc\.case_id ASC/);
});

test('pagination rejects malformed, unbounded offsets, and unsupported search options', async (t) => {
  const calls = setupRequest(t, 'admin');
  for (const url of [
    '/api/cases?page=0',
    `/api/cases?page=${Number.MAX_SAFE_INTEGER}`,
    `/api/cases?search=${'x'.repeat(101)}`,
    '/api/cases?sort=title',
  ]) {
    assert.equal((await request('GET', url)).status, 400);
  }
  assert.equal(calls.length, 4);
});

test('case updates reject assignment, ownership, client, and unknown fields', async (t) => {
  const calls = setupRequest(t, 'admin');
  for (const body of [
    { assigned_to: appUserId },
    { user_id: appUserId },
    { client_id: appUserId },
    { is_admin: true },
  ]) {
    assert.equal((await request('PATCH', `/api/cases/${caseId}`, body)).status, 400);
  }
  assert.equal(calls.length, 4);
});

test('case updates validate dates and do not allow null opened_at', async (t) => {
  const calls = setupRequest(t, 'admin');
  for (const body of [
    { opened_at: null },
    { opened_at: 'not-a-date' },
    { opened_at: '2026-01-02T00:00:00Z', closed_at: '2026-01-01T00:00:00Z' },
  ]) {
    assert.equal((await request('PATCH', `/api/cases/${caseId}`, body)).status, 400);
  }
  assert.equal(calls.length, 3);
});

test('admin updates an existing case using only allowlisted fields', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql, parameters) => {
    assert.match(sql, /UPDATE legal_cases AS lc/);
    assert.deepEqual(parameters, ['closed', caseId]);
    return { rowCount: 1, rows: [{ ...caseRecord, status: 'closed' }] };
  });
  const response = await request('PATCH', `/api/cases/${caseId}`, { status: 'closed' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).case.status, 'closed');
  assert.equal(calls.length, 2);
});

test('missing cases return 404 and database constraint failures do not leak details', async (t) => {
  await t.test('missing case', async (subtest) => {
    const calls = setupRequest(subtest, 'admin', async () => ({ rowCount: 0, rows: [] }));
    assert.equal((await request('GET', `/api/cases/${caseId}`)).status, 404);
    assert.equal(calls.length, 2);
  });
  await t.test('constraint error', async (subtest) => {
    const calls = setupRequest(subtest, 'admin', async () => {
      const error = new Error('database connection details');
      error.code = '23505';
      throw error;
    });
    subtest.mock.method(console, 'error', () => {});
    const response = await request('POST', '/api/cases', {
      case_number: 'CASE-001',
      title: 'Duplicate',
      case_type: 'civil',
    });
    assert.equal(response.status, 409);
    assert.equal(JSON.stringify(await response.json()).includes('database connection'), false);
    assert.equal(calls.length, 2);
  });
});

test('case queries use EXISTS so multiple client or assignment relationships do not duplicate results', async (t) => {
  const calls = setupRequest(t, 'client', async (sql) => {
    assert.match(sql, /EXISTS\s*\(/);
    assert.doesNotMatch(sql, /FROM legal_cases lc\s+JOIN involves/);
    if (sql.includes('COUNT(*)')) return { rowCount: 1, rows: [{ total: 1 }] };
    return { rowCount: 1, rows: [caseRecord] };
  });
  const response = await request('GET', '/api/cases');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.pagination.total, 1);
  assert.equal(body.cases.length, 1);
  assert.equal(calls.length, 3);
});

test('admins can link an existing client to a case', async (t) => {
  const clientId = 'e4663540-663f-4d4d-b8f2-bfbc6a414d64';
  const calls = setupRequest(t, 'admin', async (sql, parameters) => {
    assert.match(sql, /INSERT INTO involves \(client_id, case_id\)/);
    assert.match(sql, /FROM clients c\s+JOIN legal_cases lc/);
    assert.deepEqual(parameters, [clientId, caseId]);
    return {
      rowCount: 1,
      rows: [{
        client_id: clientId,
        case_id: caseId,
        party_role: 'client',
        is_primary: false,
      }],
    };
  });
  const response = await request('POST', `/api/cases/${caseId}/clients`, {
    client_id: clientId,
  });
  assert.equal(response.status, 201);
  assert.deepEqual((await response.json()).relationship, {
    client_id: clientId,
    case_id: caseId,
    party_role: 'client',
    is_primary: false,
  });
  assert.equal(calls.length, 2);
});

test('only admins can link clients or assign staff and cannot submit relationship flags', async (t) => {
  for (const role of ['lawyer', 'assistant', 'client']) {
    await t.test(role, async (subtest) => {
      const calls = setupRequest(subtest, role, async () => {
        assert.fail('Unauthorized relationship management must not query relationship data.');
      });
      assert.equal((await request('POST', `/api/cases/${caseId}/clients`, {
        client_id: appUserId,
      })).status, 403);
      assert.equal((await request('POST', `/api/cases/${caseId}/assignments`, {
        user_id: appUserId,
      })).status, 403);
      assert.equal(calls.length, 2);
      assert.equal(calls.some(({ sql }) => sql.includes('INSERT INTO assigned_to')), false);
    });
  }

  const calls = setupRequest(t, 'admin');
  assert.equal((await request('POST', `/api/cases/${caseId}/clients`, {
    client_id: appUserId,
    is_primary: true,
  })).status, 400);
  assert.equal((await request('POST', `/api/cases/${caseId}/assignments`, {
    user_id: appUserId,
    is_lead: true,
  })).status, 400);
  assert.equal((await request('POST', `/api/cases/${caseId}/assignments`, {
    user_id: appUserId,
    role: 'assistant',
  })).status, 400);
  assert.equal(calls.length, 3);
  assert.equal(calls.some(({ sql }) => sql.includes('INSERT INTO assigned_to')), false);
});

test('case linking validates UUIDs, reports missing records, and maps duplicate conflicts safely', async (t) => {
  const clientId = 'e4663540-663f-4d4d-b8f2-bfbc6a414d64';
  const calls = setupRequest(t, 'admin', async (_sql, parameters) => {
    if (parameters[0] === clientId) return { rowCount: 0, rows: [] };
    const error = new Error('internal constraint details');
    error.code = '23505';
    throw error;
  });
  assert.equal((await request('POST', `/api/cases/not-a-uuid/clients`, {
    client_id: clientId,
  })).status, 400);
  assert.equal((await request('POST', `/api/cases/${caseId}/clients`, {
    client_id: 'not-a-uuid',
  })).status, 400);
  assert.equal((await request('POST', `/api/cases/${caseId}/clients`, {
    client_id: clientId,
  })).status, 404);
  const duplicate = await request('POST', `/api/cases/${caseId}/clients`, {
    client_id: appUserId,
  });
  assert.equal(duplicate.status, 409);
  assert.doesNotMatch(JSON.stringify(await duplicate.json()), /internal constraint details/);
  assert.equal(calls.length, 6);
});

test('lawyer assignments require an active lawyer role and active lawyer profile', async (t) => {
  const lawyerId = 'e4663540-663f-4d4d-b8f2-bfbc6a414d64';
  const calls = setupRequest(t, 'admin', async (sql, parameters) => {
    assert.match(sql, /LEFT JOIN lawyer_profiles lp ON lp\.user_id = u\.user_id/);
    assert.match(sql, /INSERT INTO assigned_to \(user_id, case_id, assignment_role\)/);
    assert.match(sql, /SELECT u\.user_id, lc\.case_id, r\.role_name/);
    assert.match(sql, /r\.role_name = 'assistant'/);
    assert.match(sql, /r\.role_name = 'lawyer'/);
    assert.match(sql, /OR\s*\(\s*r\.role_name = 'lawyer'\s+AND lp\.license_status = 'active'/);
    assert.match(sql, /u\.status = 'active'/);
    assert.match(sql, /lp\.license_status = 'active'/);
    assert.deepEqual(parameters, [lawyerId, caseId]);
    return {
      rowCount: 1,
      rows: [{
        user_id: lawyerId,
        case_id: caseId,
        assignment_role: 'lawyer',
        assigned_at: '2026-01-01T00:00:00.000Z',
        is_lead: false,
      }],
    };
  });
  const response = await request('POST', `/api/cases/${caseId}/assignments`, {
    user_id: lawyerId,
  });
  assert.equal(response.status, 201);
  assert.deepEqual((await response.json()).assignment, {
    user_id: lawyerId,
    case_id: caseId,
    assignment_role: 'lawyer',
    assigned_at: '2026-01-01T00:00:00.000Z',
    is_lead: false,
  });
  assert.equal(calls.length, 2);
});

test('assistant assignments require an active assistant account but no lawyer profile', async (t) => {
  const assistantId = 'e4663540-663f-4d4d-b8f2-bfbc6a414d64';
  const calls = setupRequest(t, 'admin', async (sql, parameters) => {
    assert.match(sql, /LEFT JOIN lawyer_profiles lp ON lp\.user_id = u\.user_id/);
    assert.match(sql, /INSERT INTO assigned_to \(user_id, case_id, assignment_role\)/);
    assert.match(sql, /SELECT u\.user_id, lc\.case_id, r\.role_name/);
    assert.match(sql, /r\.role_name = 'assistant'/);
    assert.match(sql, /u\.status = 'active'/);
    assert.deepEqual(parameters, [assistantId, caseId]);
    return {
      rowCount: 1,
      rows: [{
        user_id: assistantId,
        case_id: caseId,
        assignment_role: 'assistant',
        assigned_at: '2026-01-01T00:00:00.000Z',
        is_lead: false,
      }],
    };
  });
  const response = await request('POST', `/api/cases/${caseId}/assignments`, {
    user_id: assistantId,
  });

  assert.equal(response.status, 201);
  assert.deepEqual((await response.json()).assignment, {
    user_id: assistantId,
    case_id: caseId,
    assignment_role: 'assistant',
    assigned_at: '2026-01-01T00:00:00.000Z',
    is_lead: false,
  });
  assert.equal(calls.length, 2);
});

test('assistant eligibility does not extend to inactive users, clients, or unsupported roles', async (t) => {
  for (const ineligibleAccount of [
    { user_id: 'e4663540-663f-4d4d-b8f2-bfbc6a414d61', role: 'assistant', status: 'inactive' },
    { user_id: 'e4663540-663f-4d4d-b8f2-bfbc6a414d62', role: 'client', status: 'active' },
    { user_id: 'e4663540-663f-4d4d-b8f2-bfbc6a414d63', role: 'admin', status: 'active' },
    { user_id: 'e4663540-663f-4d4d-b8f2-bfbc6a414d64', role: 'unsupported', status: 'active' },
  ]) {
    await t.test(`${ineligibleAccount.role} (${ineligibleAccount.status}) is rejected`, async (subtest) => {
      const calls = setupRequest(subtest, 'admin', async (sql, parameters) => {
        assert.match(sql, /INSERT INTO assigned_to \(user_id, case_id, assignment_role\)/);
        assert.match(sql, /SELECT u\.user_id, lc\.case_id, r\.role_name/);
        assert.match(sql, /r\.role_name = 'assistant'/);
        assert.match(sql, /OR\s*\(\s*r\.role_name = 'lawyer'\s+AND lp\.license_status = 'active'/);
        assert.match(sql, /u\.status = 'active'/);
        assert.deepEqual(parameters, [ineligibleAccount.user_id, caseId]);
        return { rowCount: 0, rows: [] };
      });
      const response = await request('POST', `/api/cases/${caseId}/assignments`, {
        user_id: ineligibleAccount.user_id,
      });

      assert.equal(response.status, 404);
      assert.equal(calls.length, 2);
      assert.equal((await response.json()).error, 'Case or eligible staff member not found.');
    });
  }
});

test('lawyer assignments validate identifiers and safely handle missing or duplicate records', async (t) => {
  const lawyerId = 'e4663540-663f-4d4d-b8f2-bfbc6a414d64';
  const calls = setupRequest(t, 'admin', async (sql, parameters) => {
    if (parameters[0] === lawyerId) {
      assert.match(sql, /r\.role_name = 'assistant'/);
      assert.match(sql, /r\.role_name = 'lawyer'/);
      assert.match(sql, /u\.status = 'active'/);
      assert.match(sql, /lp\.license_status = 'active'/);
      return { rowCount: 0, rows: [] };
    }
    const error = new Error('internal assignment constraint details');
    error.code = '23505';
    throw error;
  });
  assert.equal((await request('POST', '/api/cases/not-a-uuid/assignments', {
    user_id: lawyerId,
  })).status, 400);
  assert.equal((await request('POST', `/api/cases/${caseId}/assignments`, {
    user_id: 'not-a-uuid',
  })).status, 400);
  assert.equal((await request('POST', `/api/cases/${caseId}/assignments`, {
    user_id: lawyerId,
  })).status, 404);
  const duplicate = await request('POST', `/api/cases/${caseId}/assignments`, {
    user_id: appUserId,
  });
  assert.equal(duplicate.status, 409);
  assert.doesNotMatch(JSON.stringify(await duplicate.json()), /internal assignment constraint details/);
  assert.equal(calls.length, 6);
});

test('relationship details honor case access and only expose a client own profile', async (t) => {
  const calls = setupRequest(t, 'client', async (sql, parameters) => {
    assert.match(sql, /WITH accessible_case AS/);
    assert.match(sql, /FROM assigned_to assignment/);
    assert.match(sql, /FROM involves i/);
    assert.match(sql, /json_agg/);
    assert.match(sql, /AND c\.user_id = \$2/);
    assert.ok(parameters.includes(appUserId));
    assert.doesNotMatch(sql, /c\.email|c\.phone|c\.address/);
    return {
      rowCount: 1,
      rows: [{
        case_id: caseId,
        clients: [{
          client_id: 'e4663540-663f-4d4d-b8f2-bfbc6a414d64',
          client_type: 'individual',
          full_name_or_org: 'Own Client',
          party_role: 'client',
          is_primary: true,
        }],
        assigned_staff: [{
          user_id: appUserId,
          full_name: 'Assigned Lawyer',
          role: 'lawyer',
          assignment_role: 'lawyer',
          assigned_at: '2026-01-01T00:00:00.000Z',
          is_lead: true,
        }],
      }],
    };
  });
  const response = await request('GET', `/api/cases/${caseId}/relationships`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body.relationships), ['assigned_staff']);
  assert.equal(body.relationships.assigned_staff.length, 1);
  assert.deepEqual(body.relationships.assigned_staff[0], {
    full_name: 'Assigned Lawyer',
    assignment_role: 'lawyer',
  });
  for (const field of [
    'case_id',
    'clients',
    'user_id',
    'role',
    'assigned_at',
    'is_lead',
  ]) {
    assert.equal(Object.hasOwn(body.relationships, field), false);
    assert.equal(Object.hasOwn(body.relationships.assigned_staff[0], field), false);
  }
  assert.equal(calls.length, 2);
});

test('relationship details preserve the complete response for authorized staff', async (t) => {
  const calls = setupRequest(t, 'lawyer', async () => ({
    rowCount: 1,
    rows: [{
      case_id: caseId,
      clients: [{
        client_id: 'e4663540-663f-4d4d-b8f2-bfbc6a414d64',
        client_type: 'individual',
        full_name_or_org: 'Case Client',
        party_role: 'client',
        is_primary: true,
      }],
      assigned_staff: [{
        user_id: appUserId,
        full_name: 'Assigned Lawyer',
        role: 'lawyer',
        assignment_role: 'lawyer',
        assigned_at: '2026-01-01T00:00:00.000Z',
        is_lead: true,
      }],
    }],
  }));
  const response = await request('GET', `/api/cases/${caseId}/relationships`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).relationships, {
    case_id: caseId,
    clients: [{
      client_id: 'e4663540-663f-4d4d-b8f2-bfbc6a414d64',
      client_type: 'individual',
      full_name_or_org: 'Case Client',
      party_role: 'client',
      is_primary: true,
    }],
    assigned_staff: [{
      user_id: appUserId,
      full_name: 'Assigned Lawyer',
      role: 'lawyer',
      assignment_role: 'lawyer',
      assigned_at: '2026-01-01T00:00:00.000Z',
      is_lead: true,
    }],
  });
  assert.equal(calls.length, 2);
});

test('relationship details return 404 for inaccessible cases and empty arrays when no relationships exist', async (t) => {
  await t.test('inaccessible case', async (subtest) => {
    const calls = setupRequest(subtest, 'lawyer', async (sql) => {
      assert.match(sql, /FROM assigned_to assignment/);
      return { rowCount: 0, rows: [] };
    });
    assert.equal((await request('GET', `/api/cases/${caseId}/relationships`)).status, 404);
    assert.equal(calls.length, 2);
  });
  await t.test('empty relationships', async (subtest) => {
    const calls = setupRequest(subtest, 'admin', async () => ({
      rowCount: 1,
      rows: [{ case_id: caseId, clients: [], assigned_staff: [] }],
    }));
    const response = await request('GET', `/api/cases/${caseId}/relationships`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).relationships, {
      case_id: caseId,
      clients: [],
      assigned_staff: [],
    });
    assert.equal(calls.length, 2);
  });
});
