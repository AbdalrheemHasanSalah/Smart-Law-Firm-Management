import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');

const authUserId = 'auth-user-id';
const appUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const linkedUserId = '8bf121a3-7cf3-4c44-8a56-65a05dd1c9b1';
const clientId = '1cdd115e-0279-48b4-a795-1be1d5a50d0b';
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
const clientRecord = {
  client_id: clientId,
  client_type: 'individual',
  full_name_or_org: 'Taylor Client',
  phone: null,
  email: 'taylor@example.com',
  address: null,
  created_at: '2026-01-01T00:00:00.000Z',
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
  userId = appUserId
) {
  t.mock.method(auth.api, 'getSession', async () => session);
  const calls = [];
  t.mock.method(pool, 'query', async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    if (role === 'no-app-user' && sql.includes('FROM app_users u')) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('FROM app_users u')) {
      return {
        rowCount: 1,
        rows: [{ ...mappedUser, user_id: userId, role }],
      };
    }
    return databaseHandler(sql, parameters);
  });
  return calls;
}

async function request(method, path, body) {
  const headers = { cookie: 'better-auth.session_token=test-session' };
  const options = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  return fetch(`${baseUrl}${path}`, options);
}

function setupLinkRequest(t, role = 'admin', transactionHandler) {
  const authCalls = setupRequest(t, role);
  const transactionCalls = [];
  const releaseState = { count: 0, error: undefined };
  let connectCount = 0;
  const transactionClient = {
    async query(sql, parameters = []) {
      transactionCalls.push({ sql, parameters });
      const handled = await transactionHandler?.(sql, parameters);
      if (handled !== undefined) return handled;
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowCount: null, rows: [] };
      }
      if (sql.includes('FROM clients WHERE client_id')) {
        return { rowCount: 1, rows: [{ client_id: clientId, user_id: null }] };
      }
      if (sql.includes('FROM app_users u')) {
        return { rowCount: 1, rows: [{ user_id: linkedUserId }] };
      }
      if (sql.includes('FROM clients WHERE user_id')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('UPDATE clients')) {
        return {
          rowCount: 1,
          rows: [{ client_id: clientId, user_id: linkedUserId }],
        };
      }
      if (sql.includes('INSERT INTO audit_logs')) {
        return { rowCount: 1, rows: [] };
      }
      assert.fail(`Unexpected transaction query: ${sql}`);
    },
    release(error) {
      releaseState.count += 1;
      releaseState.error = error;
    },
  };
  t.mock.method(pool, 'connect', async () => {
    connectCount += 1;
    return transactionClient;
  });
  return {
    authCalls,
    transactionCalls,
    releaseState,
    transactionClient,
    get connectCount() {
      return connectCount;
    },
  };
}

test('client creation validates required fields and allowed client types before writing', async (t) => {
  const calls = setupRequest(t, 'admin');
  const missingFields = await request('POST', '/api/clients', {
    client_type: 'individual',
  });
  assert.equal(missingFields.status, 400);
  const invalidType = await request('POST', '/api/clients', {
    client_type: 'partner',
    full_name_or_org: 'Invalid Type',
  });
  assert.equal(invalidType.status, 400);
  assert.equal(calls.length, 2, 'Invalid input must not issue a client-table query.');
});

test('client creation rejects invalid optional fields and prohibited identity fields', async (t) => {
  const calls = setupRequest(t, 'admin');
  const invalidEmail = await request('POST', '/api/clients', {
    client_type: 'individual',
    full_name_or_org: 'Taylor Client',
    email: 'not-an-email',
  });
  assert.equal(invalidEmail.status, 400);
  const injectedIdentity = await request('POST', '/api/clients', {
    client_type: 'individual',
    full_name_or_org: 'Taylor Client',
    user_id: appUserId,
  });
  assert.equal(injectedIdentity.status, 400);
  assert.equal(calls.length, 2, 'Invalid input must not issue a client-table query.');
});

test('admin creates a client with only permitted values and a safe public response', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql, parameters) => {
    assert.match(sql, /INSERT INTO clients/);
    assert.doesNotMatch(sql, /user_id/);
    assert.deepEqual(parameters, [
      'organization',
      'Example Legal LLC',
      '+1 555 0100',
      'contact@example.com',
      null,
    ]);
    return { rowCount: 1, rows: [{ ...clientRecord, client_type: 'organization' }] };
  });

  const response = await request('POST', '/api/clients', {
    client_type: 'organization',
    full_name_or_org: ' Example Legal LLC ',
    phone: '+1 555 0100',
    email: 'contact@example.com',
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.client.client_type, 'organization');
  assert.equal(Object.hasOwn(body.client, 'user_id'), false);
  assert.equal(calls.length, 2);
});

test('invalid UUID client identifiers are rejected without querying client records', async (t) => {
  const calls = setupRequest(t, 'admin');
  const response = await request('GET', '/api/clients/not-a-uuid');
  assert.equal(response.status, 400);
  assert.equal(calls.length, 1);
});

test('unauthenticated requests cannot access client endpoints', async (t) => {
  const calls = [];
  t.mock.method(auth.api, 'getSession', async () => null);
  t.mock.method(pool, 'query', async (sql, parameters) => {
    calls.push({ sql, parameters });
    return { rowCount: 0, rows: [] };
  });

  const requests = [
    ['GET', '/api/clients'],
    ['POST', '/api/clients', { client_type: 'individual', full_name_or_org: 'A' }],
    ['GET', `/api/clients/${clientId}`],
    ['GET', `/api/clients/${clientId}/cases`],
    ['PATCH', `/api/clients/${clientId}`, { phone: '5550100' }],
    ['GET', '/api/clients/me'],
    ['PATCH', '/api/clients/me', { phone: '5550100' }],
  ];
  for (const [method, path, body] of requests) {
    assert.equal((await request(method, path, body)).status, 401);
  }
  assert.equal(calls.length, 0, 'Unauthenticated requests must not query the database.');
});

test('a missing application-user mapping fails closed before client data access', async (t) => {
  const calls = setupRequest(t, 'no-app-user');
  assert.equal((await request('GET', '/api/clients')).status, 401);
  assert.equal(calls.length, 1);
});

test('unknown roles are denied before querying client records', async (t) => {
  const calls = setupRequest(t, 'unrecognized');
  assert.equal((await request('GET', '/api/clients')).status, 403);
  assert.equal((await request('POST', '/api/clients', {
    client_type: 'individual',
    full_name_or_org: 'Taylor Client',
  })).status, 403);
  assert.equal(calls.length, 2, 'Only the authenticated user mapping may be queried.');
});

test('lawyer and assistant scopes fail closed for malformed application-user IDs', async (t) => {
  for (const role of ['lawyer', 'assistant']) {
    const calls = setupRequest(t, role, async () => {
      assert.fail('A malformed actor ID must not query client records.');
    }, 'not-a-uuid');
    assert.equal((await request('GET', '/api/clients')).status, 403);
    assert.equal(calls.length, 1, 'Only auth middleware may load the app user.');
  }
});

test('client list applies a maximum page size and parameterizes literal search text', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql, parameters) => {
    if (sql.includes('COUNT(*)')) {
      return { rowCount: 1, rows: [{ total: 1 }] };
    }
    return { rowCount: 1, rows: [clientRecord] };
  });

  const response = await request('GET', '/api/clients?page=3&pageSize=100&search=%25_%27');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.pagination, {
    page: 3,
    pageSize: 50,
    total: 1,
    totalPages: 1,
  });
  assert.equal(body.clients.length, 1);
  assert.equal(calls.length, 3);
  assert.match(calls[1].sql, /ILIKE \$1 ESCAPE E'\\\\'/);
  assert.equal(calls[1].sql.includes("'%_"), false);
  assert.equal(calls[1].parameters[0], "%\\%\\_'%");
  assert.equal(calls[2].parameters.at(-2), 50);
  assert.equal(calls[2].parameters.at(-1), 100);
  assert.match(calls[2].sql, /ORDER BY c\.created_at DESC, c\.client_id ASC/);
});

test('client lists return an empty page with consistent pagination metadata', async (t) => {
  setupRequest(t, 'admin', async (sql) => {
    if (sql.includes('COUNT(*)')) return { rowCount: 1, rows: [{ total: 0 }] };
    return { rowCount: 0, rows: [] };
  });
  const response = await request('GET', '/api/clients');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    clients: [],
    pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
  });
});

test('client list rejects unknown query parameters and overlong search terms', async (t) => {
  const calls = setupRequest(t, 'admin');
  assert.equal((await request('GET', '/api/clients?sort=email')).status, 400);
  assert.equal((await request('GET', `/api/clients?search=${'x'.repeat(101)}`)).status, 400);
  assert.equal((await request('GET', `/api/clients?page=${Number.MAX_SAFE_INTEGER}`)).status, 400);
  assert.equal(calls.length, 3);
});

test('client detail and update return 404 for records outside authorized scope', async (t) => {
  setupRequest(t, 'admin', async () => ({ rowCount: 0, rows: [] }));
  assert.equal((await request('GET', `/api/clients/${clientId}`)).status, 404);
  assert.equal((await request('PATCH', `/api/clients/${clientId}`, { phone: '5550100' })).status, 404);
});

test('admins can list a client case history with pagination and search', async (t) => {
  const caseRecord = {
    case_id: '7f8f4d8a-6f7c-46f3-a6cf-d8a0db69f2e2',
    case_number: 'CASE-001',
    title: 'Contract dispute',
    case_type: 'civil',
    status: 'open',
    priority: 'medium',
    opened_at: '2026-01-02T00:00:00.000Z',
    closed_at: null,
    description: null,
    court_id: null,
  };
  const calls = setupRequest(t, 'admin', async (sql, parameters) => {
    assert.match(sql, /FROM involves i\s+JOIN clients c ON c\.client_id = i\.client_id/);
    assert.match(sql, /JOIN legal_cases lc ON lc\.case_id = i\.case_id/);
    if (sql.includes('COUNT(*)')) {
      assert.deepEqual(parameters, [clientId, '%dispute%',]);
      return { rowCount: 1, rows: [{ total: 1 }] };
    }
    assert.deepEqual(parameters, [clientId, '%dispute%', 20, 0]);
    return { rowCount: 1, rows: [caseRecord] };
  });

  const response = await request(
    'GET',
    `/api/clients/${clientId}/cases?search=dispute`
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    cases: [caseRecord],
    pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
  });
  assert.equal(calls.length, 3);
});

test('an administrator receives 404 for a missing client rather than an empty history', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql) => {
    if (sql.includes('COUNT(*)')) return { rowCount: 1, rows: [{ total: 0 }] };
    if (sql.includes('SELECT 1 FROM clients')) return { rowCount: 0, rows: [] };
    return { rowCount: 0, rows: [] };
  });

  const response = await request('GET', `/api/clients/${clientId}/cases`);
  assert.equal(response.status, 404);
  assert.equal(calls.length, 4);
});

test('client case history remains bound to the authenticated client identity', async (t) => {
  const calls = setupRequest(t, 'client', async (sql, parameters) => {
    if (sql.includes('FROM involves')) {
      assert.match(sql, /c\.user_id = \$2/);
      assert.ok(parameters.includes(appUserId));
    }
    if (sql.includes('COUNT(*)')) return { rowCount: 1, rows: [{ total: 0 }] };
    if (sql.includes('SELECT 1 FROM clients')) return { rowCount: 1, rows: [{ '?column?': 1 }] };
    return { rowCount: 0, rows: [] };
  });

  const response = await request('GET', `/api/clients/${clientId}/cases`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    cases: [],
    pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
  });
  assert.equal(calls.length, 4);
});

test('clients cannot read another client case history and unassigned staff cannot infer it', async (t) => {
  for (const role of ['client', 'lawyer', 'assistant']) {
    await t.test(role, async (subtest) => {
      const calls = setupRequest(subtest, role, async (sql) => {
        if (sql.includes('SELECT 1 FROM clients')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('COUNT(*)')) {
          return { rowCount: 1, rows: [{ total: 0 }] };
        }
        return { rowCount: 0, rows: [] };
      });

      const response = await request('GET', `/api/clients/${clientId}/cases`);
      assert.equal(response.status, 404);
      assert.equal(calls.length, role === 'client' ? 4 : 4);
    });
  }
});

test('lawyers and assistants receive only cases assigned to them for a client', async (t) => {
  for (const role of ['lawyer', 'assistant']) {
    await t.test(role, async (subtest) => {
      const calls = setupRequest(subtest, role, async (sql, parameters) => {
        if (sql.includes('FROM involves')) {
          assert.match(sql, /assignment\.user_id = \$2/);
          assert.ok(parameters.includes(appUserId));
        }
        if (sql.includes('COUNT(*)')) return { rowCount: 1, rows: [{ total: 1 }] };
        return { rowCount: 1, rows: [{
          case_id: '7f8f4d8a-6f7c-46f3-a6cf-d8a0db69f2e2',
          case_number: 'CASE-001',
          title: 'Assigned matter',
          case_type: 'civil',
          status: 'open',
          priority: 'medium',
          opened_at: '2026-01-02T00:00:00.000Z',
          closed_at: null,
          description: null,
          court_id: null,
        }] };
      });

      const response = await request('GET', `/api/clients/${clientId}/cases`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).cases.length, 1);
      assert.equal(calls.length, 3);
    });
  }
});

test('database constraint errors return safe conflict responses', async (t) => {
  t.mock.method(console, 'error', () => {});
  setupRequest(t, 'admin', async () => {
    const error = new Error('INSERT INTO clients with private connection detail');
    error.code = '23505';
    throw error;
  });
  const response = await request('POST', '/api/clients', {
    client_type: 'individual',
    full_name_or_org: 'Taylor Client',
  });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error, 'A client record conflicts with existing data.');
  assert.equal(JSON.stringify(body).includes('private connection detail'), false);
});

test('unexpected database errors return a generic server response', async (t) => {
  t.mock.method(console, 'error', () => {});
  setupRequest(t, 'admin', async () => {
    throw new Error('SQL with private connection detail');
  });
  const response = await request('GET', `/api/clients/${clientId}`);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.deepEqual(body, { error: 'Internal server error' });
  assert.equal(JSON.stringify(body).includes('private connection detail'), false);
});

test('lawyers and assistants are restricted to clients on their assigned cases', async (t) => {
  const calls = setupRequest(t, 'lawyer', async (sql, parameters) => {
    assert.match(sql, /JOIN assigned_to assignment ON assignment\.case_id = i\.case_id/);
    assert.match(sql, /assignment\.user_id = \$\d+/);
    assert.ok(parameters.includes(appUserId));
    if (sql.includes('COUNT(*)')) return { rowCount: 1, rows: [{ total: 1 }] };
    return { rowCount: 1, rows: [clientRecord] };
  });

  assert.equal((await request('GET', '/api/clients')).status, 200);
  assert.equal((await request('GET', `/api/clients/${clientId}`)).status, 200);
  assert.equal((await request('PATCH', `/api/clients/${clientId}`, { phone: '5550100' })).status, 200);
  assert.equal((await request('POST', '/api/clients', {
    client_type: 'individual',
    full_name_or_org: 'Unassigned client',
  })).status, 403);
  assert.ok(calls.length >= 6);
});

test('staff list and detail use EXISTS to avoid duplicates for clients linked to multiple cases', async (t) => {
  const calls = setupRequest(t, 'lawyer', async (sql, parameters) => {
    assert.match(sql, /EXISTS\s*\(/);
    assert.doesNotMatch(sql, /FROM clients c\s+JOIN involves/);
    assert.ok(parameters.includes(appUserId));
    if (sql.includes('COUNT(*)')) return { rowCount: 1, rows: [{ total: 1 }] };
    return { rowCount: 1, rows: [clientRecord] };
  });

  const listResponse = await request('GET', '/api/clients');
  assert.equal(listResponse.status, 200);
  const listBody = await listResponse.json();
  assert.equal(listBody.pagination.total, 1);
  assert.equal(listBody.clients.length, 1);

  const detailResponse = await request('GET', `/api/clients/${clientId}`);
  assert.equal(detailResponse.status, 200);
  assert.equal((await detailResponse.json()).client.client_id, clientId);
  assert.equal(calls.length, 5);
});

test('assistant client list is scoped through case assignment too', async (t) => {
  const calls = setupRequest(t, 'assistant', async (sql) => {
    assert.match(sql, /JOIN assigned_to assignment/);
    if (sql.includes('COUNT(*)')) return { rowCount: 1, rows: [{ total: 0 }] };
    return { rowCount: 0, rows: [] };
  });
  assert.equal((await request('GET', '/api/clients')).status, 200);
  assert.equal(calls.length, 3);
});

test('clients cannot list, create, or address another profile by URL', async (t) => {
  const calls = setupRequest(t, 'client');
  assert.equal((await request('GET', '/api/clients')).status, 403);
  assert.equal((await request('POST', '/api/clients', {
    client_type: 'individual',
    full_name_or_org: 'Injected client',
  })).status, 403);
  assert.equal((await request('GET', `/api/clients/${clientId}`)).status, 403);
  assert.equal((await request('PATCH', `/api/clients/${clientId}`, { phone: '5550100' })).status, 403);
  assert.equal(calls.length, 4, 'Denied operations must not query client data.');
});

test('client self-service is bound to the authenticated application user', async (t) => {
  const calls = setupRequest(t, 'client', async (sql, parameters) => {
    assert.match(sql, /WHERE c\.user_id = \$\d+/);
    assert.ok(parameters.includes(appUserId));
    return { rowCount: 1, rows: [clientRecord] };
  });
  assert.equal((await request('GET', '/api/clients/me')).status, 200);
  assert.equal((await request('PATCH', '/api/clients/me', {
    phone: '5550100',
    address: 'New address',
  })).status, 200);
  assert.match(calls[1].sql, /WHERE c\.user_id = \$1/);
});

test('client self-service rejects protected fields without updating a record', async (t) => {
  const calls = setupRequest(t, 'client');
  for (const body of [
    { phone: '5550100', user_id: appUserId },
    { phone: '5550100', role: 'admin' },
    { phone: '5550100', is_admin: true },
  ]) {
    const response = await request('PATCH', '/api/clients/me', body);
    assert.equal(response.status, 400);
  }
  assert.equal(calls.length, 3);
});

test('staff updates reject role, user identity, and unknown fields', async (t) => {
  const calls = setupRequest(t, 'admin');
  for (const body of [
    { phone: '5550100', user_id: appUserId },
    { phone: '5550100', role: 'admin' },
    { phone: '5550100', is_admin: true },
  ]) {
    assert.equal((await request('PATCH', `/api/clients/${clientId}`, body)).status, 400);
  }
  assert.equal(calls.length, 3, 'Rejected patch fields must not query client records.');
});

test('client self-service reports an unlinked client profile as not found', async (t) => {
  setupRequest(t, 'client', async () => ({ rowCount: 0, rows: [] }));
  const response = await request('GET', '/api/clients/me');
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'Client profile not found.');
});

test('admin links an eligible application account and atomically records the audit event', async (t) => {
  const state = setupLinkRequest(t);
  const response = await request(
    'POST',
    `/api/clients/${clientId}/link-account`,
    { user_id: linkedUserId }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    client_id: clientId,
    user_id: linkedUserId,
    linked: true,
  });
  assert.deepEqual(
    state.transactionCalls.map(({ sql }) => sql.trim().split(/\s+/).slice(0, 2).join(' ')),
    ['BEGIN', 'SELECT client_id,', 'SELECT u.user_id', 'SELECT client_id', 'UPDATE clients', 'INSERT INTO', 'COMMIT']
  );
  assert.deepEqual(state.transactionCalls[0].parameters, []);
  assert.deepEqual(state.transactionCalls[1].parameters, [clientId]);
  assert.match(state.transactionCalls[2].sql, /r\.role_name = 'client'/);
  assert.match(state.transactionCalls[2].sql, /u\.status = 'active'/);
  assert.match(state.transactionCalls[2].sql, /u\.auth_user_id IS NOT NULL/);
  assert.deepEqual(state.transactionCalls[2].parameters, [linkedUserId]);
  assert.deepEqual(state.transactionCalls[3].parameters, [linkedUserId, clientId]);
  assert.deepEqual(state.transactionCalls[4].parameters, [clientId, linkedUserId]);
  assert.deepEqual(state.transactionCalls[5].parameters, [
    'client_account_linked',
    'client',
    clientId,
    JSON.stringify({ linked_user_id: linkedUserId }),
    appUserId,
  ]);
  assert.deepEqual(state.transactionCalls[6].parameters, []);
  assert.equal(state.releaseState.count, 1);
  assert.equal(state.releaseState.error, undefined);
});

test('client linking requires the admin role before checkout', async (t) => {
  for (const role of ['lawyer', 'assistant', 'client']) {
    await t.test(`${role} role is denied`, async (subtest) => {
      const state = setupLinkRequest(subtest, role);
      assert.equal(
        (await request('POST', `/api/clients/${clientId}/link-account`, { user_id: linkedUserId })).status,
        403
      );
      assert.equal(state.connectCount, 0);
    });
  }
});

test('client linking requires an authenticated session before checkout', async (t) => {
  t.mock.method(auth.api, 'getSession', async () => null);
  let connectCount = 0;
  t.mock.method(pool, 'query', async () => ({ rowCount: 0, rows: [] }));
  t.mock.method(pool, 'connect', async () => {
    connectCount += 1;
    throw new Error('Unauthenticated requests must not check out a client.');
  });
  const response = await request(
    'POST',
    `/api/clients/${clientId}/link-account`,
    { user_id: linkedUserId }
  );
  assert.equal(response.status, 401);
  assert.equal(connectCount, 0);
});

test('client linking rejects malformed or unsupported input before checkout', async (t) => {
  const state = setupLinkRequest(t, 'admin');
  for (const [path, body] of [
    ['/api/clients/not-a-uuid/link-account', { user_id: linkedUserId }],
    [`/api/clients/${clientId}/link-account`, {}],
    [`/api/clients/${clientId}/link-account`, { user_id: 'not-a-uuid' }],
    [`/api/clients/${clientId}/link-account`, { user_id: linkedUserId, email: 'x@example.com' }],
  ]) {
    assert.equal((await request('POST', path, body)).status, 400);
  }
  assert.equal(state.connectCount, 0);
});

test('client linking returns 404 for a missing client and rolls back', async (t) => {
  const missingClient = setupLinkRequest(t, 'admin', async (sql) => (
    sql.includes('FROM clients WHERE client_id')
      ? { rowCount: 0, rows: [] }
      : undefined
  ));
  assert.equal(
    (await request('POST', `/api/clients/${clientId}/link-account`, { user_id: linkedUserId })).status,
    404
  );
  assert.equal(missingClient.transactionCalls.at(-1).sql, 'ROLLBACK');
  assert.equal(missingClient.releaseState.count, 1);
});

test('client linking returns 404 for an ineligible target account and rolls back', async (t) => {
  const ineligibleUser = setupLinkRequest(t, 'admin', async (sql) => (
    sql.includes('FROM app_users u')
      ? { rowCount: 0, rows: [] }
      : undefined
  ));
  assert.equal(
    (await request('POST', `/api/clients/${clientId}/link-account`, { user_id: linkedUserId })).status,
    404
  );
  assert.equal(ineligibleUser.transactionCalls.at(-1).sql, 'ROLLBACK');
  assert.equal(ineligibleUser.releaseState.count, 1);
});

test('client linking rejects an already-linked client without updating or auditing', async (t) => {
  const linkedClient = setupLinkRequest(t, 'admin', async (sql) => (
    sql.includes('FROM clients WHERE client_id')
      ? { rowCount: 1, rows: [{ client_id: clientId, user_id: appUserId }] }
      : undefined
  ));
  assert.equal(
    (await request('POST', `/api/clients/${clientId}/link-account`, { user_id: linkedUserId })).status,
    409
  );
  assert.equal(linkedClient.transactionCalls.at(-1).sql, 'ROLLBACK');
  assert.equal(linkedClient.transactionCalls.some(({ sql }) => sql.includes('UPDATE clients')), false);
  assert.equal(linkedClient.transactionCalls.some(({ sql }) => sql.includes('INSERT INTO audit_logs')), false);
  assert.equal(linkedClient.releaseState.count, 1);
});

test('client linking rejects a user already linked elsewhere without updating', async (t) => {
  const linkedUser = setupLinkRequest(t, 'admin', async (sql) => (
    sql.includes('FROM clients WHERE user_id')
      ? { rowCount: 1, rows: [{ client_id: 'another-client' }] }
      : undefined
  ));
  assert.equal(
    (await request('POST', `/api/clients/${clientId}/link-account`, { user_id: linkedUserId })).status,
    409
  );
  assert.equal(linkedUser.transactionCalls.at(-1).sql, 'ROLLBACK');
  assert.equal(linkedUser.transactionCalls.some(({ sql }) => sql.includes('UPDATE clients')), false);
  assert.equal(linkedUser.releaseState.count, 1);
});

test('a concurrent relationship conflict is rejected when the conditional update returns no row', async (t) => {
  const state = setupLinkRequest(t, 'admin', async (sql) => (
    sql.includes('UPDATE clients')
      ? { rowCount: 0, rows: [] }
      : undefined
  ));
  assert.equal(
    (await request('POST', `/api/clients/${clientId}/link-account`, { user_id: linkedUserId })).status,
    409
  );
  assert.equal(state.transactionCalls.at(-1).sql, 'ROLLBACK');
  assert.equal(state.transactionCalls.some(({ sql }) => sql.includes('INSERT INTO audit_logs')), false);
  assert.equal(state.releaseState.count, 1);
});

test('the expected client-user unique violation maps to conflict', async (t) => {
  const expectedConflict = setupLinkRequest(t, 'admin', async (sql) => {
    if (sql.includes('UPDATE clients')) {
      throw Object.assign(new Error('duplicate link'), {
        code: '23505',
        constraint: 'clients_user_id_key',
      });
    }
    return undefined;
  });
  assert.equal(
    (await request('POST', `/api/clients/${clientId}/link-account`, { user_id: linkedUserId })).status,
    409
  );
  assert.equal(expectedConflict.transactionCalls.at(-1).sql, 'ROLLBACK');
  assert.equal(expectedConflict.releaseState.count, 1);
});

test('unrelated unique violations remain server errors', async (t) => {
  const unrelatedUniqueFailure = setupLinkRequest(t, 'admin', async (sql) => {
    if (sql.includes('INSERT INTO audit_logs')) {
      throw Object.assign(new Error('unrelated constraint'), {
        code: '23505',
        constraint: 'audit_logs_pkey',
      });
    }
    return undefined;
  });
  assert.equal(
    (await request('POST', `/api/clients/${clientId}/link-account`, { user_id: linkedUserId })).status,
    500
  );
  assert.equal(unrelatedUniqueFailure.transactionCalls.at(-1).sql, 'ROLLBACK');
  assert.equal(unrelatedUniqueFailure.releaseState.count, 1);
});

test('audit failure rolls back and releases the checked-out client', async (t) => {
  const auditFailure = setupLinkRequest(t, 'admin', async (sql) => {
    if (sql.includes('INSERT INTO audit_logs')) throw new Error('audit unavailable');
    return undefined;
  });
  assert.equal(
    (await request('POST', `/api/clients/${clientId}/link-account`, { user_id: linkedUserId })).status,
    500
  );
  assert.equal(auditFailure.transactionCalls.at(-1).sql, 'ROLLBACK');
  assert.equal(auditFailure.releaseState.count, 1);
});

test('a missing audit insert result rolls back the relationship', async (t) => {
  const state = setupLinkRequest(t, 'admin', async (sql) => (
    sql.includes('INSERT INTO audit_logs')
      ? { rowCount: 0, rows: [] }
      : undefined
  ));
  assert.equal(
    (await request('POST', `/api/clients/${clientId}/link-account`, { user_id: linkedUserId })).status,
    500
  );
  assert.equal(state.transactionCalls.at(-1).sql, 'ROLLBACK');
  assert.equal(state.releaseState.count, 1);
});

test('a failed BEGIN releases the checked-out client', async (t) => {
  const beginFailure = setupLinkRequest(t, 'admin', async (sql) => {
    if (sql === 'BEGIN') throw new Error('transaction unavailable');
    return undefined;
  });
  assert.equal(
    (await request('POST', `/api/clients/${clientId}/link-account`, { user_id: linkedUserId })).status,
    500
  );
  assert.equal(beginFailure.transactionCalls.length, 1);
  assert.equal(beginFailure.releaseState.count, 1);
  assert.ok(beginFailure.releaseState.error);
});

test('a failed rollback discards the client and returns a safe server error', async (t) => {
  const rollbackFailure = setupLinkRequest(t, 'admin', async (sql) => {
    if (sql.includes('INSERT INTO audit_logs')) throw new Error('audit unavailable');
    if (sql === 'ROLLBACK') throw Object.assign(new Error('rollback unavailable'), { code: '08006' });
    return undefined;
  });
  t.mock.method(console, 'error', () => {});
  assert.equal(
    (await request('POST', `/api/clients/${clientId}/link-account`, { user_id: linkedUserId })).status,
    500
  );
  assert.equal(rollbackFailure.releaseState.count, 1);
  assert.equal(rollbackFailure.releaseState.error.code, '08006');
});
