import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');
const { effectivePermissions, permissionFor } = await import('../src/config/permissions.js');
const { lockMinutes, recordFailure, signInLockout } = await import('../src/services/lockoutService.js');
const { backupStatus } = await import('../src/services/securityService.js');

const appUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const otherId = '4db5c770-823c-4c5c-9f92-6c82a0d8e69b';
const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const caseId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const taskId = 'c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f';
const session = { user: { id: 'auth-user-id' }, session: { id: 'session-id', expiresAt: '2999-01-01T00:00:00.000Z' } };
const mappedUser = {
  user_id: appUserId, auth_user_id: 'auth-user-id', full_name: 'Member', email: 'member@example.com',
  email_verified: true, status: 'active', role_id: 'role-id', office_id: officeId, role: 'lawyer', is_platform_admin: false,
  is_owner: false, permissions_granted: [], permissions_revoked: [],
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

const send = (method, route, body) =>
  fetch(`${baseUrl}/api${route}`, {
    method,
    headers: { cookie: 'better-auth.session_token=test', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const code = async (response) => (await response.json()).code;

test('every office route maps to one permission', () => {
  assert.equal(permissionFor('GET', '/api/finance/invoices?page=1'), 'finance.manage');
  assert.equal(permissionFor('POST', '/api/fee-agreements'), 'finance.manage');
  assert.equal(permissionFor('GET', '/api/cases/x'), 'cases.view');
  assert.equal(permissionFor('PATCH', '/api/cases/x'), 'cases.edit');
  assert.equal(permissionFor('PUT', '/api/cases/x/stage'), 'cases.edit');
  assert.equal(permissionFor('POST', '/api/cases/x/analyses'), 'ai.use');
  assert.equal(permissionFor('POST', '/api/prints'), 'print');
  assert.equal(permissionFor('DELETE', '/api/tasks/x'), 'delete');
  assert.equal(permissionFor('DELETE', '/api/library/saved/x'), 'open', 'personal items are the member\'s own');
  assert.equal(permissionFor('POST', '/api/offices/current/invitations'), 'office.manage');
  assert.equal(permissionFor('GET', '/api/audit-logs/verify'), 'office.manage');
  assert.equal(permissionFor('GET', '/api/session'), 'session');
  assert.equal(permissionFor('GET', '/api/messages/x'), 'open');
  assert.equal(permissionFor('POST', '/api/hearings/x/outcome'), 'schedule.edit');
  assert.equal(permissionFor('POST', '/api/clients'), 'clients.edit');
  assert.equal(permissionFor('GET', '/api/somewhere-new'), null);
});

test('effective permissions: role defaults, grants and revocations; the owner keeps everything', () => {
  assert.deepEqual([...effectivePermissions({ role: 'print_only' })].sort(), ['cases.view', 'print']);
  const accountant = effectivePermissions({ role: 'accountant', permissions_granted: ['cases.edit', 'office.manage'], permissions_revoked: ['print'] });
  assert.equal(accountant.has('cases.edit'), true);
  assert.equal(accountant.has('office.manage'), false, 'office.manage cannot be granted');
  assert.equal(accountant.has('print'), false);
  assert.equal(effectivePermissions({ role: 'admin', is_owner: true, permissions_revoked: ['finance.manage'] }).has('finance.manage'), true);
});

test('an accountant reaches office finance and reads cases, but cannot edit cases or reach unmapped routes', async (t) => {
  const calls = setup(t, { role: 'accountant' }, async (sql) => (sql.includes('COUNT(*)') ? { rowCount: 1, rows: [{ total: 0 }] } : { rowCount: 0, rows: [] }));
  assert.notEqual((await send('GET', '/finance/invoices')).status, 403, 'finance is open to the accountant');
  assert.ok(calls.some((call) => /FROM invoices/.test(call.sql)));
  assert.notEqual((await send('GET', '/cases')).status, 403);
  const edit = await send('PATCH', `/cases/${caseId}`, { title: 'x' });
  assert.equal(edit.status, 403);
  assert.equal(await code(edit), 'PERMISSION_DENIED');
  assert.equal((await send('POST', '/clients', { full_name_or_org: 'x' })).status, 403);
  assert.equal((await send('GET', '/offices/current/members/security')).status, 403);
});

test('print-only and data-entry roles keep to their lists', async (t) => {
  setup(t, { role: 'print_only' });
  assert.equal((await send('GET', '/finance/invoices')).status, 403);
  assert.equal((await send('POST', '/tasks', { title: 'x' })).status, 403);
  assert.notEqual((await send('GET', '/documents')).status, 403);
  t.mock.restoreAll();
  setup(t, { role: 'data_entry' });
  assert.equal((await send('DELETE', `/tasks/${taskId}`)).status, 403, 'no deleting');
  assert.equal((await send('POST', `/cases/${caseId}/analyses`, { tool: 'x' })).status, 403, 'no AI tools');
  assert.equal((await send('GET', '/fee-agreements')).status, 403, 'no finance');
});

test('the owner can revoke from or grant to a lawyer, and the server follows it', async (t) => {
  setup(t, { role: 'lawyer', permissions_revoked: ['delete'] });
  assert.equal(await code(await send('DELETE', `/tasks/${taskId}`)), 'PERMISSION_DENIED');
  t.mock.restoreAll();
  setup(t, { role: 'lawyer' });
  assert.equal((await send('GET', '/finance/summary')).status, 403, 'finance is not a lawyer\'s by default');
  t.mock.restoreAll();
  const calls = setup(t, { role: 'lawyer', permissions_granted: ['finance.manage'] }, async () => ({ rowCount: 0, rows: [] }));
  assert.notEqual((await send('GET', '/finance/summary')).status, 403, 'a granted permission opens the admin route');
  assert.ok(calls.length > 0);
});

test('only the owner manages member permissions, within the role\'s limits', async (t) => {
  const member = { user_id: otherId, full_name: 'Lina', email: 'lina@example.com', role: 'lawyer', is_owner: false, status: 'active', permissions_granted: [], permissions_revoked: [], locked_until: null };
  const calls = setup(t, { role: 'admin', is_owner: true }, async (sql) => (sql.includes('FROM office_memberships m') ? { rowCount: 1, rows: [member] } : { rowCount: 1, rows: [] }));
  assert.equal((await send('PUT', `/offices/current/members/${otherId}/permissions`, { granted: ['cases.edit'] })).status, 400, 'a lawyer already has cases.edit');
  assert.equal((await send('PUT', `/offices/current/members/${otherId}/permissions`, { revoked: ['finance.manage'] })).status, 400, 'nothing to revoke');
  assert.equal((await send('PUT', `/offices/current/members/${otherId}/permissions`, { granted: ['office.manage'] })).status, 400);
  const ok = await send('PUT', `/offices/current/members/${otherId}/permissions`, { granted: ['finance.manage'], revoked: ['delete', 'delete'] });
  assert.equal(ok.status, 200);
  const update = calls.find((call) => call.sql.includes('UPDATE office_memberships SET permissions_granted'));
  assert.deepEqual(update.parameters, [officeId, otherId, ['finance.manage'], ['delete']]);
  assert.equal((await send('POST', `/offices/current/members/${otherId}/unlock`)).status, 200);
  assert.ok(calls.some((call) => call.sql.includes('DELETE FROM sign_in_lockouts') && call.parameters[0] === 'lina@example.com'));
  t.mock.restoreAll();
  setup(t, { role: 'admin', is_owner: true }, async (sql) => (sql.includes('FROM office_memberships m') ? { rowCount: 1, rows: [{ ...member, is_owner: true }] } : { rowCount: 0, rows: [] }));
  assert.equal(await code(await send('PUT', `/offices/current/members/${otherId}/permissions`, { revoked: ['delete'] })), 'OWNER_PERMISSIONS');
  t.mock.restoreAll();
  setup(t, { role: 'lawyer' });
  assert.equal((await send('GET', '/offices/current/members/security')).status, 403);
  assert.equal((await send('GET', '/offices/current/export')).status, 403);
  assert.equal((await send('GET', '/audit-logs/verify')).status, 403);
});

test('five wrong passwords lock the address, each lock twice as long up to a day', async () => {
  assert.deepEqual([1, 2, 3, 7, 20].map(lockMinutes), [15, 30, 60, 960, 1440]);
  const store = { failed_count: 0, lock_level: 0 };
  const run = async (sql) => {
    if (sql.includes('INSERT INTO sign_in_lockouts')) {
      store.failed_count += 1;
      return { rows: [{ ...store }] };
    }
    if (sql.includes('UPDATE sign_in_lockouts')) {
      store.failed_count = 0;
      store.lock_level += 1;
      return { rows: [{ locked_until: '2026-01-01T00:15:00Z' }] };
    }
    return { rows: [] };
  };
  for (let attempt = 1; attempt <= 4; attempt += 1) assert.equal(await recordFailure('a@x.ps', run), null);
  assert.deepEqual(await recordFailure('a@x.ps', run), { until: '2026-01-01T00:15:00Z', minutes: 15 });
  for (let attempt = 1; attempt <= 4; attempt += 1) await recordFailure('a@x.ps', run);
  assert.equal((await recordFailure('a@x.ps', run)).minutes, 30);
});

test('a locked address is refused before the password is checked', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(pool, 'query', async (sql) => (sql.includes('FROM sign_in_lockouts') ? { rowCount: 1, rows: [{ locked_until: new Date('2999-01-01T00:00:00Z') }] } : { rowCount: 0, rows: [] }));
  let status;
  let body;
  let passed = false;
  const response = { status(value) { status = value; return this; }, json(value) { body = value; return this; }, on() {} };
  await new Promise((resolve) => {
    signInLockout({ body: { email: ' A@X.ps ' } }, { ...response, json(value) { body = value; resolve(); return this; } }, () => { passed = true; resolve(); });
  });
  assert.equal(passed, false);
  assert.equal(status, 429);
  assert.equal(body.code, 'ACCOUNT_LOCKED');
});

test('the backup page reads the status file and warns when the last good backup is old', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'qadiyati-backups-'));
  const file = path.join(folder, 'status.json');
  const platform = { user_id: appUserId, is_platform_admin: true };
  assert.equal((await backupStatus(platform, { BACKUP_STATUS_FILE: file })).configured, false);
  const recent = new Date(Date.now() - 3600 * 1000).toISOString();
  await writeFile(file, JSON.stringify([
    { stamp: 'old', finished_at: '2026-01-01T03:00:00Z', ok: true },
    { stamp: 'new', finished_at: recent, ok: false, error: 'tar failed' },
  ]));
  const status = await backupStatus(platform, { BACKUP_STATUS_FILE: file });
  assert.equal(status.backups[0].stamp, 'new', 'newest first');
  assert.equal(status.latest_ok_at, '2026-01-01T03:00:00Z');
  assert.equal(status.stale, true);
  await assert.rejects(backupStatus({ user_id: appUserId, role: 'admin' }, { BACKUP_STATUS_FILE: file }), { status: 403 });
});
