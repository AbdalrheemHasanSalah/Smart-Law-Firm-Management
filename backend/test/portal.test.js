import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';
for (const name of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) delete process.env[name];
const storageDirectory = await mkdtemp(path.join(os.tmpdir(), 'smart-law-portal-test-'));
process.env.DOCUMENT_STORAGE_DIR = storageDirectory;

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');
const { setPushSenderForTests } = await import('../src/services/pushService.js');
const { asPdf } = await import('../src/services/sharedFileService.js');
const { draftNotice, whatsappLink, whatsappNumber } = await import('../src/services/officialNoticeService.js');

const appUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const caseId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const clientId = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const fileId = 'c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f';
const session = { user: { id: 'auth-user-id' }, session: { id: 'session-id', expiresAt: '2999-01-01T00:00:00.000Z' } };
const mappedUser = {
  user_id: appUserId, auth_user_id: 'auth-user-id', full_name: 'Member', email: 'member@example.com',
  email_verified: true, status: 'active', role_id: 'role-id', office_id: officeId, role: 'client', is_platform_admin: false,
};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

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
afterEach(() => setPushSenderForTests(null));

function setup(t, role, handler = async () => ({ rowCount: 0, rows: [] })) {
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

const upload = (body, headers) =>
  fetch(`${baseUrl}/api/shared-files`, { method: 'POST', headers: { cookie: 'better-auth.session_token=test', 'content-type': 'application/octet-stream', ...headers }, body });
const json = (method, route, body) =>
  fetch(`${baseUrl}/api${route}`, {
    method,
    headers: { cookie: 'better-auth.session_token=test', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

test('a client sends a file only for their own case, and only a PDF or an image', async (t) => {
  const calls = setup(t, 'client');
  const headers = { 'x-purpose': 'portal', 'x-case-id': caseId, 'x-file-name': 'scan.png' };
  assert.equal((await upload(PNG, headers)).status, 404, 'not a party to the case');
  const lookup = calls.find((call) => call.sql.includes('FROM involves i JOIN clients c'));
  assert.deepEqual(lookup.parameters, [caseId, appUserId, officeId]);
  assert.equal((await upload(PNG, { ...headers, 'x-case-id': 'nope' })).status, 400);
  assert.equal((await upload(PNG, { ...headers, 'x-purpose': 'other' })).status, 400);
  t.mock.restoreAll();
  const staffCalls = setup(t, 'lawyer');
  assert.equal((await upload(PNG, headers)).status, 400, 'staff do not send portal files');
  t.mock.restoreAll();
  setup(t, 'client', async (sql) => (sql.includes('FROM involves i JOIN clients c') ? { rowCount: 1, rows: [{ client_id: clientId }] } : { rowCount: 0, rows: [] }));
  assert.equal((await upload(Buffer.from('MZ not a document'), headers)).status, 415);
  assert.equal(staffCalls.filter((call) => call.sql.includes('INSERT INTO shared_files')).length, 0);
});

test('the incoming files of a case are limited to the office, and to the case team for a lawyer', async (t) => {
  const calls = setup(t, 'lawyer');
  assert.equal((await json('GET', `/cases/${caseId}/incoming-files`)).status, 200);
  const list = calls.find((call) => call.sql.includes('FROM shared_files f'));
  assert.deepEqual(list.parameters, [caseId, appUserId, officeId]);
  assert.match(list.sql, /assigned_to a WHERE a\.case_id = f\.case_id AND a\.user_id = \$2/);
  assert.match(list.sql, /f\.purpose = 'portal'/);
  t.mock.restoreAll();
  setup(t, 'client');
  assert.equal((await json('GET', `/cases/${caseId}/incoming-files`)).status, 403);
  assert.equal((await json('POST', `/shared-files/${fileId}/move`, {})).status, 403);
});

test('a photo becomes a one-page PDF before it joins the case documents', async () => {
  const pdf = await asPdf(PNG, 'image/png');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const same = Buffer.from('%PDF-1.7 test');
  assert.equal(await asPdf(same, 'application/pdf'), same);
});

test('push is off without VAPID keys, and a subscription must be a real https endpoint', async (t) => {
  setup(t, 'client');
  assert.deepEqual(await (await json('GET', '/push/settings')).json(), { enabled: false, public_key: null });
  assert.equal((await json('POST', '/push/subscriptions', { endpoint: 'https://push.example/x', keys: { p256dh: 'k', auth: 'a' } })).status, 503);
  setPushSenderForTests(async () => {});
  for (const body of [{ endpoint: 'http://push.example/x', keys: { p256dh: 'k', auth: 'a' } }, { endpoint: 'https://push.example/x' }, { endpoint: 'https://push.example/x', keys: { p256dh: 1, auth: 'a' } }]) {
    assert.equal((await json('POST', '/push/subscriptions', body)).status, 400, JSON.stringify(body));
  }
});

test('notice text comes from the hearing, and WhatsApp numbers get the country code', () => {
  const draft = draftNotice({
    kind: 'hearing',
    caseRecord: { case_number: '2026/5', title: 'إخلاء' },
    hearing: { hearing_type: 'بيّنات', hearing_at: '2026-12-10T08:30:00Z', court_room: '3', court_name: 'محكمة بداية رام الله' },
    clientName: 'محمود',
  });
  assert.equal(draft.title, 'موعد جلسة في القضية 2026/5');
  assert.match(draft.body, /10:30/);
  assert.match(draft.body, /محكمة بداية رام الله، القاعة 3/);
  assert.equal(whatsappNumber('0599 123 456'), '970599123456');
  assert.equal(whatsappNumber('+972 52-123-4567'), '972521234567');
  assert.equal(whatsappNumber('00970599123456'), '970599123456');
  assert.equal(whatsappNumber('123'), null);
  assert.equal(whatsappLink('970599123456', 'نص & رابط'), 'https://wa.me/970599123456?text=%D9%86%D8%B5%20%26%20%D8%B1%D8%A7%D8%A8%D8%B7');
});

test('a client reads their notices without the office log, and acknowledges only their own', async (t) => {
  const row = { notice_id: fileId, case_id: caseId, kind: 'hearing', title: 't', body: 'b', client_phone: '0599123456', deliveries: [{ channel: 'whatsapp', status: 'prepared' }], case_number: '1', client_name: 'x' };
  const calls = setup(t, 'client', async (sql) => (sql.includes('FROM official_notices n') ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] }));
  const mine = await (await json('GET', '/notices/mine')).json();
  assert.equal('deliveries' in mine.notices[0], false);
  assert.equal('whatsapp_url' in mine.notices[0], false);
  assert.equal((await json('POST', `/notices/${fileId}/acknowledge`)).status, 404);
  const ack = calls.find((call) => call.sql.includes('SET acknowledged_at'));
  assert.deepEqual(ack.parameters, [fileId, officeId, appUserId]);
  t.mock.restoreAll();
  setup(t, 'lawyer');
  assert.equal((await json('POST', `/notices/${fileId}/acknowledge`)).status, 403, 'only the client acknowledges');
  assert.equal((await json('POST', `/cases/${caseId}/notices`, { kind: 'magic', client_id: clientId })).status, 404, 'the case is checked first');
});
