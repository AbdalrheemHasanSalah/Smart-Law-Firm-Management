import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');

const appUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const courtId = 'c1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const colleagueId = 'd2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
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

function setup(t, user, handler = async () => ({ rowCount: 1, rows: [{}] })) {
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

test('the court list is shared and only the platform admin edits it; offices keep their own note', async (t) => {
  const calls = setup(t, { role: 'lawyer' }, async () => ({ rowCount: 1, rows: [{ note: 'اسأل عن قلم الصلح' }] }));
  assert.equal((await send('GET', '/courts?search=نابلس')).status, 200);
  const list = calls.find((call) => call.sql.includes('FROM courts c'));
  assert.match(list.sql, /c\.is_active/, 'offices see active courts only');
  assert.match(list.sql, /n\.office_id = \$2/, 'the note shown is the office\'s own');
  assert.deepEqual(list.parameters, ['%نابلس%', officeId]);
  assert.equal((await send('POST', '/courts', { name: 'محكمة' })).status, 403);
  assert.equal((await send('PATCH', `/courts/${courtId}`, { phone: '09' })).status, 403);
  const note = await send('PUT', `/courts/${courtId}/note`, { note: 'اسأل عن قلم الصلح' });
  assert.equal(note.status, 200);
  const upsert = calls.find((call) => call.sql.includes('INSERT INTO court_office_notes'));
  assert.deepEqual(upsert.parameters, [officeId, courtId, 'اسأل عن قلم الصلح', appUserId]);
  t.mock.restoreAll();

  const platformCalls = setup(t, { role: null, office_id: null, is_platform_admin: true }, async () => ({ rowCount: 1, rows: [{ court_id: courtId, name: 'صلح نابلس' }] }));
  assert.equal((await send('POST', '/courts', { name: ' صلح نابلس ', city: 'نابلس', phone: '09 238 0000' })).status, 201);
  const insert = platformCalls.find((call) => call.sql.includes('INSERT INTO courts'));
  assert.deepEqual(insert.parameters, ['صلح نابلس', 'نابلس', '09 238 0000']);
  assert.equal((await send('POST', '/courts', { name: 'x', phone: 'not a phone' })).status, 400);
  assert.equal((await send('POST', '/courts', { name: 'x', secret: 1 })).status, 400);
  assert.equal((await send('PATCH', `/courts/${courtId}`, { is_active: false })).status, 200);
  assert.equal((await send('GET', '/courts')).status, 200);
  assert.doesNotMatch(platformCalls.at(-1).sql, /is_active\s+AND|WHERE c\.is_active/, 'the platform admin also sees hidden courts');
});

test('colleagues belong to the office: staff add and edit them, only the admin deletes', async (t) => {
  const calls = setup(t, { role: 'assistant' }, async () => ({ rowCount: 1, rows: [{ colleague_id: colleagueId, full_name: 'أحمد' }] }));
  assert.equal((await send('POST', '/colleagues', { full_name: 'أحمد', bar_number: '1234', phone: '0599 000 000', email: '' })).status, 201);
  const insert = calls.find((call) => call.sql.includes('INSERT INTO colleagues'));
  assert.deepEqual(insert.parameters, [officeId, appUserId, 'أحمد', '1234', '0599 000 000', null]);
  assert.equal((await send('POST', '/colleagues', { bar_number: '1' })).status, 400, 'a name is required');
  assert.equal((await send('PATCH', `/colleagues/${colleagueId}`, { city: 'جنين' })).status, 200);
  assert.match(calls.find((call) => call.sql.includes('UPDATE colleagues')).sql, /office_id = \$2/);
  assert.equal((await send('PATCH', `/colleagues/${colleagueId}`, {})).status, 400);
  assert.equal((await send('DELETE', `/colleagues/${colleagueId}`)).status, 403);
  assert.equal(calls.filter((call) => call.sql.includes('DELETE FROM colleagues')).length, 0);
  t.mock.restoreAll();
  setup(t, { role: 'client' });
  assert.equal((await send('GET', '/colleagues')).status, 403);
});

test('the office admin keeps the message templates; staff only read them', async (t) => {
  setup(t, { role: 'lawyer' }, async () => ({ rowCount: 0, rows: [] }));
  assert.equal((await send('GET', '/colleague-templates')).status, 200);
  assert.equal((await send('POST', '/colleague-templates', { title: 'x', body: 'y' })).status, 403);
  t.mock.restoreAll();
  const calls = setup(t, { role: 'admin' }, async () => ({ rowCount: 1, rows: [{ template_id: colleagueId }] }));
  assert.equal((await send('POST', '/colleague-templates', { title: 'طلب تأجيل', body: 'الزميل {الزميل}…' })).status, 201);
  assert.deepEqual(calls.at(-1).parameters, [officeId, appUserId, 'طلب تأجيل', 'الزميل {الزميل}…']);
  assert.equal((await send('POST', '/colleague-templates', { title: 'x' })).status, 400);
  assert.equal((await send('POST', '/colleague-templates', { title: 'x', body: 'y'.repeat(3001) })).status, 400);
});
