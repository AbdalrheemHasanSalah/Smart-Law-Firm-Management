import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');

const authUserId = 'auth-user-id';
const appUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const caseId = '1cdd115e-0279-48b4-a795-1be1d5a50d0b';
const noteId = 'e4663540-663f-4d4d-b8f2-bfbc6a414d64';
const otherAuthUserId = 'other-auth-user-id';
const otherAppUserId = '4db57c80-823c-4c5f-9f92-6c82a6ed8b6b';
const otherClientId = 'e6b4a70e-8c57-4e6a-9a03-3d1b4f5c7a9e';
const otherCaseId = '2ddee226-138a-4bf9-9c06-2f6e2b61e1c1';
const otherNoteId = 'f5774651-774e-4e5e-9c03-c6cd7b525e75';
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
  office_id: '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d',
  role: 'admin',
};
const noteRecord = {
  note_id: noteId,
  body: 'Review the filing.',
  visibility: 'internal',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: null,
  case_id: caseId,
};
const otherNoteRecord = {
  ...noteRecord,
  note_id: otherNoteId,
  body: 'Private note for another client.',
  visibility: 'client_visible',
  case_id: otherCaseId,
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
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await pool.end();
});

function setupRequest(
  t,
  role,
  databaseHandler = async () => ({ rowCount: 0, rows: [] }),
  actorId = appUserId
) {
  t.mock.method(console, 'error', () => {});
  t.mock.method(auth.api, 'getSession', async () => session);
  const calls = [];
  t.mock.method(pool, 'query', async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    if (sql.includes('u.auth_user_id')) {
      return { rowCount: 1, rows: [{ ...mappedUser, user_id: actorId, role }] };
    }
    return databaseHandler(sql, parameters);
  });
  return calls;
}

async function request(method, route, body, cookie = 'better-auth.session_token=test-session') {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  const options = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  return fetch(`${baseUrl}${route}`, options);
}

test('unauthenticated note requests are rejected before database access', async (t) => {
  const calls = [];
  t.mock.method(auth.api, 'getSession', async () => null);
  t.mock.method(pool, 'query', async (...args) => {
    calls.push(args);
    return { rowCount: 0, rows: [] };
  });
  assert.equal((await request('GET', `/api/cases/${caseId}/notes`)).status, 401);
  assert.equal((await request('POST', `/api/cases/${caseId}/notes`, { body: 'note' })).status, 401);
  assert.equal((await request('PATCH', `/api/notes/${noteId}`, { body: 'updated' })).status, 401);
  assert.equal(calls.length, 0);
});

test('admins can list notes with bounded pagination and safe fields', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql, parameters) => {
    assert.doesNotMatch(sql, /SELECT \*/i);
    if (sql.includes('COUNT(*)')) return { rowCount: 1, rows: [{ total: 1 }] };
    assert.deepEqual(parameters, [caseId, officeId, '%review%', 50, 50]);
    return { rowCount: 1, rows: [{ ...noteRecord, user_id: appUserId }] };
  });
  const response = await request('GET', `/api/cases/${caseId}/notes?page=2&pageSize=100&search=review`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.notes, [noteRecord]);
  assert.equal(body.pagination.pageSize, 50);
  assert.equal('user_id' in body.notes[0], false);
  assert.equal(calls.length, 3);
});

test('staff note access is limited to assigned cases', async (t) => {
  for (const role of ['lawyer', 'assistant']) {
    await t.test(role, async (subtest) => {
      const calls = setupRequest(subtest, role, async (sql, parameters) => {
        assert.match(sql, /FROM assigned_to assignment/);
        assert.ok(parameters.includes(appUserId));
        if (sql.includes('COUNT(*)')) return { rowCount: 1, rows: [{ total: 1 }] };
        return { rowCount: 1, rows: [noteRecord] };
      });
      assert.equal((await request('GET', `/api/cases/${caseId}/notes`)).status, 200);
      assert.equal(calls.length, 3);
    });
  }
});

test('unassigned staff cannot read or update a note', async (t) => {
  const calls = setupRequest(t, 'lawyer', async (sql, parameters) => {
    assert.match(sql, /assigned_to/);
    assert.ok(parameters.includes(appUserId));
    if (sql.includes('COUNT(*)')) return { rowCount: 1, rows: [{ total: 0 }] };
    return { rowCount: 0, rows: [] };
  });
  assert.equal((await request('GET', `/api/cases/${caseId}/notes`)).status, 200);
  assert.equal((await request('PATCH', `/api/notes/${noteId}`, { body: 'updated' })).status, 404);
  assert.equal(calls.length, 5);
});

test('clients receive only their own visible note and never another client note', async (t) => {
  const calls = setupRequest(t, 'client', async (sql, parameters) => {
    const requestedCaseId = parameters[0];
    const clientCases = [
      { userId: appUserId, clientId: 'client-a', caseId, note: noteRecord },
      { userId: otherAppUserId, clientId: otherClientId, caseId: otherCaseId, note: otherNoteRecord },
    ];
    const ownFixture = clientCases.find(
      (fixture) => fixture.userId === appUserId && fixture.caseId === requestedCaseId
    );
    const ownsCase = Boolean(ownFixture);
    if (sql.includes('COUNT(*)')) {
      return { rowCount: 1, rows: [{ total: ownsCase ? 1 : 0 }] };
    }
    if (ownsCase) {
      return { rowCount: 1, rows: [{ ...ownFixture.note, visibility: 'client_visible' }] };
    }
    return { rowCount: 0, rows: [] };
  });
  const ownResponse = await request('GET', `/api/cases/${caseId}/notes`);
  assert.equal(ownResponse.status, 200);
  const ownBody = await ownResponse.json();
  assert.deepEqual(ownBody.notes, [{ ...noteRecord, visibility: 'client_visible' }]);

  const otherResponse = await request('GET', `/api/cases/${otherCaseId}/notes`);
  assert.equal(otherResponse.status, 200);
  const otherBody = await otherResponse.json();
  assert.deepEqual(otherBody.notes, []);
  assert.doesNotMatch(JSON.stringify(otherBody), /Private note for another client/);
  assert.ok(calls.some(({ parameters }) => parameters[0] === otherCaseId));
});

test('clients cannot create or update notes', async (t) => {
  const calls = setupRequest(t, 'client');
  assert.equal((await request('POST', `/api/cases/${caseId}/notes`, { body: 'note' })).status, 403);
  assert.equal((await request('PATCH', `/api/notes/${noteId}`, { body: 'updated' })).status, 403);
  assert.equal(calls.length, 2);
});

test('assigned and unassigned staff have behavioral list, create, and update boundaries', async (t) => {
  for (const role of ['lawyer', 'assistant']) {
    await t.test(`${role} assigned`, async (subtest) => {
      const calls = setupRequest(subtest, role, async (sql, parameters) => {
        assert.ok(parameters.includes(appUserId));
        if (sql.includes('COUNT(*)')) return { rowCount: 1, rows: [{ total: 1 }] };
        if (sql.includes('INSERT INTO case_notes')) {
          return { rowCount: 1, rows: [{ ...noteRecord, body: 'Assigned note', visibility: 'case_team' }] };
        }
        if (sql.includes('UPDATE case_notes')) {
          return { rowCount: 1, rows: [{ ...noteRecord, body: 'Updated assigned note' }] };
        }
        return { rowCount: 1, rows: [noteRecord] };
      });
      const list = await request('GET', `/api/cases/${caseId}/notes`);
      assert.deepEqual((await list.json()).notes, [noteRecord]);
      const create = await request('POST', `/api/cases/${caseId}/notes`, {
        body: 'Assigned note',
        visibility: 'case_team',
      });
      assert.equal(create.status, 201);
      assert.equal((await create.json()).note.body, 'Assigned note');
      const update = await request('PATCH', `/api/notes/${noteId}`, {
        body: 'Updated assigned note',
      });
      assert.equal(update.status, 200);
      assert.equal((await update.json()).note.body, 'Updated assigned note');
      assert.ok(calls.length > 0);
    });

    await t.test(`${role} unassigned`, async (subtest) => {
      const calls = setupRequest(subtest, role, async (sql, parameters) => {
        assert.ok(parameters.includes(otherAppUserId));
        if (sql.includes('COUNT(*)')) return { rowCount: 1, rows: [{ total: 0 }] };
        return { rowCount: 0, rows: [] };
      }, otherAppUserId);
      const list = await request('GET', `/api/cases/${caseId}/notes`);
      assert.equal(list.status, 200);
      assert.deepEqual((await list.json()).notes, []);
      const create = await request('POST', `/api/cases/${caseId}/notes`, {
        body: 'Unauthorized note',
      });
      assert.equal(create.status, 404);
      assert.doesNotMatch(JSON.stringify(await create.json()), /Unauthorized note/);
      const update = await request('PATCH', `/api/notes/${noteId}`, {
        body: 'Unauthorized update',
      });
      assert.equal(update.status, 404);
      assert.doesNotMatch(JSON.stringify(await update.json()), /Unauthorized update/);
      assert.ok(calls.length > 0);
    });
  }
});

test('only admins can publish notes to clients', async (t) => {
  for (const role of ['lawyer', 'assistant']) {
    await t.test(role, async (subtest) => {
      const calls = setupRequest(subtest, role);
      assert.equal((await request('POST', `/api/cases/${caseId}/notes`, {
        body: 'Public note',
        visibility: 'client_visible',
      })).status, 403);
      assert.equal(calls.length, 1);
    });
  }
  const adminCalls = setupRequest(t, 'admin', async (sql, parameters) => {
    if (sql.includes('INSERT INTO case_notes')) {
      assert.deepEqual(parameters, ['Public note', 'client_visible', appUserId, caseId, officeId, true]);
      return { rowCount: 1, rows: [{ ...noteRecord, body: 'Public note', visibility: 'client_visible' }] };
    }
    return { rowCount: 0, rows: [] };
  });
  const createResponse = await request('POST', `/api/cases/${caseId}/notes`, {
    body: 'Public note',
    visibility: 'client_visible',
  });
  assert.equal(createResponse.status, 201);
  assert.equal((await createResponse.json()).note.visibility, 'client_visible');
  assert.equal(adminCalls.length, 2);

  const updateCalls = setupRequest(t, 'lawyer', async (sql) => {
    if (sql.includes('UPDATE case_notes')) return { rowCount: 0, rows: [] };
    return { rowCount: 0, rows: [] };
  });
  const updateResponse = await request('PATCH', `/api/notes/${noteId}`, {
    body: 'Attempted publication',
    visibility: 'client_visible',
  });
  assert.equal(updateResponse.status, 403);
  assert.equal(updateCalls.length, 1);
});

test('invalid note input and mass assignment are rejected without writes', async (t) => {
  const calls = setupRequest(t, 'admin');
  for (const body of [
    {},
    { body: '   ' },
    { body: 'x'.repeat(10001) },
    { body: 'note', visibility: 'unknown' },
    { body: 'note', case_id: caseId },
    { body: 'note', user_id: appUserId },
    { body: 'note', created_at: '2026-01-01T00:00:00.000Z' },
  ]) {
    assert.equal(
      (await request('POST', `/api/cases/${caseId}/notes`, body)).status,
      400
    );
  }
  assert.equal(calls.length, 7);
});

test('admins can update note content and visibility with parameterized SQL', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql, parameters) => {
    assert.match(sql, /UPDATE case_notes AS n/);
    assert.match(sql, /updated_at = NOW\(\)/);
    assert.deepEqual(parameters, ['Published note', 'client_visible', noteId, officeId]);
    return { rowCount: 1, rows: [{ ...noteRecord, body: 'Published note', visibility: 'client_visible' }] };
  });

  const response = await request('PATCH', `/api/notes/${noteId}`, {
    body: 'Published note',
    visibility: 'client_visible',
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).note.visibility, 'client_visible');
  assert.equal(calls.length, 2);
});

test('client-supplied ownership and timestamp fields are rejected before writes', async (t) => {
  const calls = setupRequest(t, 'admin');
  const response = await request('POST', `/api/cases/${caseId}/notes`, {
    body: 'Trusted note',
    visibility: 'internal',
    case_id: otherCaseId,
    user_id: otherAppUserId,
    note_id: otherNoteId,
    created_at: '1999-01-01T00:00:00.000Z',
    updated_at: '1999-01-01T00:00:00.000Z',
  });
  assert.equal(response.status, 400);
  assert.equal(calls.length, 1);
});

test('update ignores no server-controlled fields from the request body', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql, parameters) => {
    if (sql.includes('UPDATE case_notes')) {
      assert.deepEqual(parameters, ['Updated trusted note', noteId]);
      assert.match(sql, /updated_at = NOW\(\)/);
      return { rowCount: 1, rows: [{ ...noteRecord, body: 'Updated trusted note' }] };
    }
    return { rowCount: 0, rows: [] };
  });
  const response = await request('PATCH', `/api/notes/${noteId}`, {
    body: 'Updated trusted note',
    case_id: otherCaseId,
    user_id: otherAppUserId,
    note_id: otherNoteId,
    created_at: '1999-01-01T00:00:00.000Z',
    updated_at: '1999-01-01T00:00:00.000Z',
  });
  assert.equal(response.status, 400);
  assert.equal(calls.length, 1);
});
