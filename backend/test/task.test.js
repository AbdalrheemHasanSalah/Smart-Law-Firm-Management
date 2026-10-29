import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');

const authUserId = 'auth-user-id';
const appUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const taskId = '1cdd115e-0279-48b4-a795-1be1d5a50d0b';
const caseId = 'e4663540-663f-4d4d-b8f2-bfbc6a414d64';
const assigneeId = 'd5a39bb4-f7b6-43a0-bfca-2b16678cc514';
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
const taskRecord = {
  task_id: taskId,
  title: 'File motion',
  description: 'Prepare the motion.',
  status: 'pending',
  priority: 'high',
  due_at: '2026-11-01T12:00:00.000Z',
  completed_at: null,
  case_id: caseId,
  assigned_to_name: 'Assigned Lawyer',
  created_by_name: 'Administrator',
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

function setupRequest(t, role, databaseHandler = async () => ({ rowCount: 0, rows: [] }), userId = appUserId) {
  t.mock.method(console, 'error', () => {});
  t.mock.method(auth.api, 'getSession', async () => session);
  const calls = [];
  t.mock.method(pool, 'query', async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    if (sql.includes('u.auth_user_id')) {
      return { rowCount: 1, rows: [{ ...mappedUser, user_id: userId, role }] };
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

test('unauthenticated and client requests cannot access internal task endpoints', async (t) => {
  const calls = [];
  t.mock.method(auth.api, 'getSession', async () => null);
  t.mock.method(pool, 'query', async (sql, parameters) => {
    calls.push({ sql, parameters });
    return { rowCount: 0, rows: [] };
  });
  assert.equal((await request('GET', '/api/tasks')).status, 401);
  assert.equal((await request('POST', '/api/tasks', {
    title: 'Task',
    assigned_to_user_id: assigneeId,
  })).status, 401);
  assert.equal(calls.length, 0);

  const clientCalls = setupRequest(t, 'client');
  assert.equal((await request('GET', '/api/tasks')).status, 403);
  assert.equal((await request('GET', `/api/tasks/${taskId}`)).status, 403);
  assert.equal(clientCalls.length, 2);
});

test('admin lists tasks with status filters and bounded pagination', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql) => {
    if (sql.includes('COUNT(*)')) return { rowCount: 1, rows: [{ total: 1 }] };
    assert.match(sql, /ORDER BY t\.due_at ASC NULLS LAST, t\.task_id ASC/);
    assert.doesNotMatch(sql, /SELECT \*/i);
    return { rowCount: 1, rows: [taskRecord] };
  });
  const response = await request('GET', '/api/tasks?page=2&pageSize=100&status=pending');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.pagination.pageSize, 50);
  assert.equal(body.tasks[0].task_id, taskId);
  assert.equal('created_by_user_id' in body.tasks[0], false);
  assert.deepEqual(calls[1].parameters, [officeId, 'pending']);
  assert.deepEqual(calls[2].parameters, [officeId, 'pending', 50, 50]);
  assert.equal(calls.length, 3);
});

test('staff task access is limited to tasks assigned to them and their current case assignments', async (t) => {
  for (const role of ['lawyer', 'assistant']) {
    await t.test(role, async (subtest) => {
      const calls = setupRequest(subtest, role, async (sql, parameters) => {
        assert.match(sql, /t\.assigned_to_user_id = \$\d+/);
        assert.match(sql, /FROM assigned_to case_assignment/);
        assert.match(sql, /case_assignment\.user_id = \$\d+/);
        assert.ok(parameters.includes(appUserId));
        if (sql.includes('COUNT(*)')) return { rowCount: 1, rows: [{ total: 1 }] };
        return { rowCount: 1, rows: [taskRecord] };
      });
      assert.equal((await request('GET', '/api/tasks')).status, 200);
      assert.equal((await request('GET', `/api/tasks/${taskId}`)).status, 200);
      assert.equal(calls.length, 5);
    });
  }
});

test('staff cannot retrieve or update tasks outside their task and case assignment scope', async (t) => {
  const calls = setupRequest(t, 'lawyer', async (sql, parameters) => {
    assert.match(sql, /t\.assigned_to_user_id = \$\d+/);
    assert.match(sql, /case_assignment\.user_id = \$\d+/);
    assert.ok(parameters.includes(appUserId));
    return { rowCount: 0, rows: [] };
  });
  assert.equal((await request('GET', `/api/tasks/${taskId}`)).status, 404);
  assert.equal((await request('PATCH', `/api/tasks/${taskId}`, { status: 'in_progress' })).status, 404);
  assert.equal(calls.length, 4);
});

test('only admins can create tasks, and admin creation validates eligible assignees in SQL', async (t) => {
  for (const role of ['lawyer', 'assistant']) {
    await t.test(role, async (subtest) => {
      const calls = setupRequest(subtest, role);
      assert.equal((await request('POST', '/api/tasks', {
        title: 'Prepare filing',
        assigned_to_user_id: assigneeId,
      })).status, 403);
      assert.equal(calls.length, 1);
    });
  }

  const calls = setupRequest(t, 'admin', async (sql, parameters) => {
    if (sql.includes('INSERT INTO tasks')) {
      assert.match(sql, /assignee_role\.role_name IN \('lawyer', 'assistant'\)/);
      assert.match(sql, /assignee\.status = 'active'/);
      assert.match(sql, /FROM assigned_to assignment/);
      assert.match(sql, /membership\.office_id = \$4/);
      assert.deepEqual(parameters, [
        assigneeId,
        caseId,
        appUserId,
        officeId,
        'File motion',
        'Prepare the motion.',
        'pending',
        'high',
        '2026-11-01T12:00:00.000Z',
        null,
      ]);
      return { rowCount: 1, rows: [{ task_id: taskId }] };
    }
    return { rowCount: 1, rows: [taskRecord] };
  });
  const response = await request('POST', '/api/tasks', {
    title: ' File motion ',
    description: 'Prepare the motion.',
    priority: 'high',
    due_at: '2026-11-01T12:00:00.000Z',
    case_id: caseId,
    assigned_to_user_id: assigneeId,
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).task.task_id, taskId);
  assert.equal(calls.length, 3);
});

test('task creation fails safely for missing eligible assignees or cases', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql) => {
    assert.match(sql, /INSERT INTO tasks/);
    return { rowCount: 0, rows: [] };
  });
  const response = await request('POST', '/api/tasks', {
    title: 'Prepare filing',
    assigned_to_user_id: assigneeId,
    case_id: caseId,
  });
  assert.equal(response.status, 404);
  assert.equal(calls.length, 2);
});

test('task creation and updates reject prohibited identity, assignment, and unknown fields', async (t) => {
  const calls = setupRequest(t, 'admin');
  const invalidCreateBodies = [
    { title: 'Missing assignee' },
    { title: 'Task', assigned_to_user_id: 'bad-id' },
    { title: 'Task', assigned_to_user_id: assigneeId, created_by_user_id: appUserId },
  ];
  for (const body of invalidCreateBodies) {
    assert.equal((await request('POST', '/api/tasks', body)).status, 400);
  }
  for (const body of [
    { assigned_to_user_id: assigneeId },
    { created_by_user_id: appUserId },
    { task_id: taskId },
  ]) {
    assert.equal((await request('PATCH', `/api/tasks/${taskId}`, body)).status, 400);
  }
  assert.equal(calls.length, 6);
});

test('task status, priority, timestamp, case UUID, and search filters are validated', async (t) => {
  const calls = setupRequest(t, 'admin');
  for (const body of [
    { status: 'waiting' },
    { priority: 'critical' },
    { due_at: 'tomorrow' },
    { completed_at: '2026-02-30T10:00:00Z' },
  ]) {
    assert.equal((await request('PATCH', `/api/tasks/${taskId}`, body)).status, 400);
  }
  for (const route of [
    '/api/tasks?status=waiting',
    '/api/tasks?priority=critical',
    '/api/tasks?page=0',
    '/api/tasks?caseId=bad-id',
    `/api/tasks?search=${'x'.repeat(101)}`,
  ]) {
    assert.equal((await request('GET', route)).status, 400);
  }
  assert.equal((await request('GET', '/api/tasks/bad-id')).status, 400);
  assert.equal(calls.length, 10);
});

test('task completion fills completed_at on the server', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql, parameters) => {
    if (sql.includes('UPDATE tasks AS t')) {
      assert.match(sql, /completed_at = \$2/);
      assert.equal(parameters[0], 'completed');
      assert.match(parameters[1], /^\d{4}-\d\d-\d\dT/);
      return { rowCount: 1, rows: [{ task_id: taskId }] };
    }
    if (sql.includes('FROM tasks t')) {
      return { rowCount: 1, rows: [{ ...taskRecord, status: 'completed' }] };
    }
    return { rowCount: 1, rows: [{ task_id: taskId }] };
  });
  const response = await request('PATCH', `/api/tasks/${taskId}`, { status: 'completed' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.task.status, 'completed', JSON.stringify(body));
  assert.equal(calls.length, 3);
});

test('leaving the completed state clears completed_at', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql, parameters) => {
    if (sql.includes('UPDATE tasks AS t')) {
      assert.deepEqual(parameters.slice(0, 2), ['in_progress', null]);
      return { rowCount: 1, rows: [{ task_id: taskId }] };
    }
    if (sql.includes('FROM tasks t')) {
      return { rowCount: 1, rows: [{ ...taskRecord, status: 'in_progress', completed_at: null }] };
    }
    return { rowCount: 1, rows: [{ task_id: taskId }] };
  });
  const response = await request('PATCH', `/api/tasks/${taskId}`, { status: 'in_progress' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.task.status, 'in_progress');
  assert.equal(body.task.completed_at, null);
  assert.equal(calls.length, 3);
});

test('completion timestamps are server-managed and cannot be supplied independently', async (t) => {
  const calls = setupRequest(t, 'admin');
  assert.equal((await request('PATCH', `/api/tasks/${taskId}`, {
    completed_at: '2026-11-01T12:00:00Z',
  })).status, 400);
  assert.equal((await request('POST', '/api/tasks', {
    title: 'Completed task',
    assigned_to_user_id: assigneeId,
    status: 'pending',
    completed_at: '2026-11-01T12:00:00Z',
  })).status, 400);
  assert.equal(calls.length, 2);
});

test('missing task and database errors return safe responses', async (t) => {
  await t.test('missing', async (subtest) => {
    const calls = setupRequest(subtest, 'admin');
    assert.equal((await request('GET', `/api/tasks/${taskId}`)).status, 404);
    assert.equal(calls.length, 2);
  });
  await t.test('constraint error', async (subtest) => {
    const calls = setupRequest(subtest, 'admin', async () => {
      const error = new Error('private database detail');
      error.code = '23503';
      throw error;
    });
    const response = await request('POST', '/api/tasks', {
      title: 'Task',
      assigned_to_user_id: assigneeId,
    });
    assert.equal(response.status, 400);
    assert.doesNotMatch(JSON.stringify(await response.json()), /private database detail/);
    assert.equal(calls.length, 2);
  });
});
