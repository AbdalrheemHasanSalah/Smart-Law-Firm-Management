import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';
const storageDirectory = await mkdtemp(path.join(os.tmpdir(), 'smart-law-voice-test-'));
process.env.DOCUMENT_STORAGE_DIR = storageDirectory;

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');

const appUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const clipId = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';
const contactId = '7e0f5b8a-1c2d-4e3f-8a9b-0c1d2e3f4a5b';
const session = { user: { id: 'auth-user-id' }, session: { id: 'session-id', expiresAt: '2999-01-01T00:00:00.000Z' } };
const mappedUser = {
  user_id: appUserId, auth_user_id: 'auth-user-id', full_name: 'Member', email: 'member@example.com',
  email_verified: true, status: 'active', role_id: 'role-id', office_id: officeId, role: 'lawyer', is_platform_admin: false,
};
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(1000, 7)]);

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
  await rm(storageDirectory, { recursive: true, force: true });
});

function setup(t, role = 'lawyer', handler = async () => ({ rowCount: 0, rows: [] })) {
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

const upload = (body, headers = {}) =>
  fetch(`${baseUrl}/api/voice`, {
    method: 'POST',
    headers: { cookie: 'better-auth.session_token=test', 'content-type': 'audio/webm', 'x-duration-seconds': '12', ...headers },
    body,
  });

test('a recording is checked by its bytes and its length before anything is stored', async (t) => {
  const calls = setup(t, 'client');
  assert.equal((await upload(Buffer.from('%PDF-1.7 not audio'))).status, 415, 'a PDF called audio/webm is refused');
  assert.equal((await upload(WEBM, { 'x-duration-seconds': '121' })).status, 400, 'over two minutes');
  assert.equal((await upload(WEBM, { 'x-duration-seconds': 'abc' })).status, 400);
  assert.equal((await upload(Buffer.alloc(3 * 1024 * 1024 + 10, 1))).status, 413, 'over 3 MB');
  assert.equal(calls.filter((call) => call.sql.includes('INSERT INTO voice_clips')).length, 0);
});

test('a stored recording belongs to its owner in their office, and plays back with byte ranges', async (t) => {
  let storageKey = null;
  const calls = setup(t, 'client', async (sql, parameters) => {
    if (sql.includes('INSERT INTO voice_clips')) {
      storageKey = parameters[2];
      return { rowCount: 1, rows: [{ clip_id: clipId, duration_seconds: 12, created_at: 'now' }] };
    }
    if (sql.includes('FROM voice_clips v')) return { rowCount: 1, rows: [{ storage_key: storageKey, mime_type: 'audio/webm' }] };
    return { rowCount: 0, rows: [] };
  });
  const response = await upload(WEBM);
  assert.equal(response.status, 201);
  const insert = calls.find((call) => call.sql.includes('INSERT INTO voice_clips'));
  assert.deepEqual([insert.parameters[0], insert.parameters[1], insert.parameters[3], insert.parameters[4], insert.parameters[5]], [officeId, appUserId, 'audio/webm', 12, WEBM.length]);
  assert.match(storageKey, /^[0-9a-f-]{36}\.webm$/);

  const whole = await fetch(`${baseUrl}/api/voice/${clipId}`, { headers: { cookie: 'better-auth.session_token=test' } });
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('content-type'), 'audio/webm');
  assert.equal(Buffer.from(await whole.arrayBuffer()).length, WEBM.length);
  const part = await fetch(`${baseUrl}/api/voice/${clipId}`, { headers: { cookie: 'better-auth.session_token=test', range: 'bytes=0-3' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 0-3/${WEBM.length}`);
  assert.deepEqual([...Buffer.from(await part.arrayBuffer())], [0x1a, 0x45, 0xdf, 0xa3]);

  const read = calls.find((call) => call.sql.includes('FROM voice_clips v'));
  assert.deepEqual(read.parameters, [clipId, appUserId, officeId]);
  assert.match(read.sql, /n\.visibility = 'client_visible'/, 'a client hears only client-visible notes');
  assert.match(read.sql, /m\.sender_user_id = \$2 OR m\.receiver_user_id = \$2/, 'and only their own messages');
});

test('a recording nobody may hear reads as not found', async (t) => {
  setup(t, 'lawyer');
  assert.equal((await fetch(`${baseUrl}/api/voice/${clipId}`, { headers: { cookie: 'better-auth.session_token=test' } })).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/voice/not-a-uuid`, { headers: { cookie: 'better-auth.session_token=test' } })).status, 404);
});

test('a voice message needs the sender\'s own unused recording', async (t) => {
  const contact = { user_id: contactId, full_name: 'Client', role: 'client' };
  const calls = setup(t, 'lawyer', async (sql) => {
    if (sql.includes('AND m.user_id = $3')) return { rowCount: 1, rows: [contact] };
    return { rowCount: 0, rows: [] };
  });
  const response = await fetch(`${baseUrl}/api/messages/${contactId}`, {
    method: 'POST',
    headers: { cookie: 'better-auth.session_token=test', 'content-type': 'application/json' },
    body: JSON.stringify({ voice_clip_id: clipId }),
  });
  assert.equal(response.status, 400);
  const check = calls.find((call) => call.sql.includes('FROM voice_clips'));
  assert.deepEqual(check.parameters, [clipId, appUserId, officeId]);
  assert.match(check.sql, /message_id IS NULL AND note_id IS NULL/);
  assert.equal(calls.filter((call) => call.sql.includes('INSERT INTO messages')).length, 0, 'nothing is sent');
});
