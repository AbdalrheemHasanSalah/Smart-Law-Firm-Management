import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';
const storageDirectory = await mkdtemp(path.join(os.tmpdir(), 'smart-law-public-test-'));
process.env.DOCUMENT_STORAGE_DIR = storageDirectory;
// Behind the local proxy the limiter counts X-Real-IP, so each test request can come from its own address.
process.env.TRUST_PROXY = 'loopback';
let nextAddress = 1;

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');
const { normalizeSlug } = await import('../src/services/publicPageService.js');

const appUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const lawyerId = 'd5a39bb4-f7b6-43a0-bfca-2b16678cc514';
const requestId = 'a1111111-1111-4111-8111-111111111111';
const clientId = 'b2222222-2222-4222-8222-222222222222';
const session = { user: { id: 'auth-user-id' }, session: { id: 'session-id', expiresAt: '2999-01-01T00:00:00.000Z' } };
const mappedUser = {
  user_id: appUserId, auth_user_id: 'auth-user-id', full_name: 'Owner', email: 'owner@example.com',
  email_verified: true, status: 'active', role_id: 'role-id', office_id: officeId, role: 'admin',
};
const REQUEST = {
  request_id: requestId, full_name: 'Visitor', phone: '0599 123 456', email: 'v@example.com', case_type: 'family', message: 'Help',
  preferred_time: null, status: 'new', notes: null, assigned_to_user_id: null, assigned_to_name: null, client_id: null, client_name: null,
  created_at: '2026-11-27T00:00:00Z', updated_at: '2026-11-27T00:00:00Z',
};
const VALID_PAGE = { slug: 'khatib-law', is_published: true, tagline: 'x', about: 'y', practice_areas: ['مدني', 'تجاري'], whatsapp: '+970 599 100 200', working_hours: '8-4', map_url: 'https://maps.example.com/x' };

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

function setup(t, role, handler = async () => ({ rowCount: 0, rows: [] }), { signedIn = true } = {}) {
  t.mock.method(console, 'error', () => {});
  t.mock.method(auth.api, 'getSession', async () => (signedIn ? session : null));
  const calls = [];
  t.mock.method(pool, 'query', async (sql, parameters = []) => {
    if (sql.includes('u.auth_user_id')) return { rowCount: 1, rows: [{ ...mappedUser, role }] };
    calls.push({ sql, parameters });
    return handler(sql, parameters);
  });
  return calls;
}

const request = (method, route, body, headers = {}) =>
  fetch(`${baseUrl}${route}`, {
    method,
    headers: { cookie: 'better-auth.session_token=test', ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

/* ───────────── the page ───────────── */

test('a page link is lower-case Latin letters, digits and hyphens, and never a reserved word', () => {
  assert.equal(normalizeSlug(' Khatib-Law '), 'khatib-law');
  for (const bad of ['ab', 'with space', 'double--hyphen', '-start', 'مكتب', 'a'.repeat(61)]) {
    assert.throws(() => normalizeSlug(bad), { status: 400 }, bad);
  }
  assert.throws(() => normalizeSlug('admin'), { status: 409 });
});

test('a visitor sees only a published page of an active office, with the lawyers the office chose', async (t) => {
  const calls = setup(t, 'admin', async (sql) => {
    if (sql.includes('FROM office_public_pages p')) {
      return { rowCount: 1, rows: [{ ...VALID_PAGE, logo_key: null, has_logo: false, office_id: officeId, name: 'Office', phone: '1', email: 'o@x', city: 'Nablus', address: 'x', updated_at: 'x' }] };
    }
    return { rowCount: 1, rows: [{ full_name: 'Lawyer', job_title: 'محامية' }] };
  }, { signedIn: false });
  const response = await fetch(`${baseUrl}/api/public/offices/Khatib-Law`);
  assert.equal(response.status, 200);
  const { page } = await response.json();
  assert.equal(page.office.name, 'Office');
  assert.deepEqual(page.lawyers, [{ full_name: 'Lawyer', job_title: 'محامية' }]);
  assert.equal(page.is_published, undefined, 'settings are not sent to visitors');
  assert.match(calls[0].sql, /o\.status = 'active'/);
  assert.match(calls[0].sql, /p\.is_published/);
  assert.deepEqual(calls[0].parameters, ['khatib-law']);
  assert.match(calls[1].sql, /sp\.show_on_public_page/);
  assert.match(calls[1].sql, /m\.status = 'active'/);
});

test('an unpublished or unknown page is not found', async (t) => {
  setup(t, 'admin', async () => ({ rowCount: 0, rows: [] }), { signedIn: false });
  assert.equal((await fetch(`${baseUrl}/api/public/offices/nobody-here`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/public/offices/bad%20slug`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/public/offices/nobody-here/logo`)).status, 404);
});

test('only the office administrator edits the page', async (t) => {
  for (const role of ['lawyer', 'assistant', 'client']) {
    await t.test(role, async (subtest) => {
      const calls = setup(subtest, role);
      assert.equal((await request('PUT', '/api/offices/current/public-page', VALID_PAGE, { origin: 'http://localhost:5173' })).status, 403);
      assert.equal(calls.length, 0);
    });
  }
});

test('the page settings are checked: a safe map link, a phone for WhatsApp, a bounded list of areas', async (t) => {
  const calls = setup(t, 'admin');
  for (const body of [
    { ...VALID_PAGE, map_url: 'http://maps.example.com' },
    { ...VALID_PAGE, map_url: 'javascript:alert(1)' },
    { ...VALID_PAGE, whatsapp: 'call me' },
    { ...VALID_PAGE, practice_areas: Array.from({ length: 13 }, (_, index) => `a${index}`) },
    { ...VALID_PAGE, is_published: 'yes' },
    { ...VALID_PAGE, office_id: officeId },
  ]) {
    assert.equal((await request('PUT', '/api/offices/current/public-page', body, { origin: 'http://localhost:5173' })).status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
});

test("saving the page is the office's own, and a link used by another office is refused", async (t) => {
  const calls = setup(t, 'admin', async () => {
    const error = new Error('duplicate');
    error.code = '23505';
    throw error;
  });
  const response = await request('PUT', '/api/offices/current/public-page', VALID_PAGE, { origin: 'http://localhost:5173' });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'SLUG_TAKEN');
  assert.equal(calls[0].parameters.at(-1), officeId);
  assert.match(calls[0].sql, /ON CONFLICT \(office_id\)/);
});

/* ───────────── consultation requests ───────────── */

const visitorRequest = (body, address = `10.0.${Math.floor(nextAddress / 250)}.${(nextAddress++ % 250) + 1}`) => fetch(`${baseUrl}/api/public/offices/khatib-law/consultations`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'http://localhost:5173', 'x-real-ip': address },
  body: JSON.stringify(body),
});
const VALID_REQUEST = { full_name: 'Visitor', phone: '0599 123 456', message: 'I need advice', opened_at: Date.now() - 60_000 };

test("a visitor's request is filed with the office behind the page", async (t) => {
  const calls = setup(t, 'admin', async (sql) => (sql.includes('SELECT p.office_id') ? { rowCount: 1, rows: [{ office_id: officeId }] } : { rowCount: 1, rows: [{ request_id: requestId }] }), { signedIn: false });
  const response = await visitorRequest(VALID_REQUEST);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { received: true });
  const insert = calls.find(({ sql }) => sql.startsWith('INSERT INTO consultation_requests'));
  assert.equal(insert.parameters.at(-1), officeId);
});

test('a request that looks like a bot gets the same answer and is not kept', async (t) => {
  for (const body of [
    { ...VALID_REQUEST, website: 'http://spam.example' },
    { ...VALID_REQUEST, opened_at: Date.now() },
    { ...VALID_REQUEST, opened_at: 'never' },
  ]) {
    await t.test(JSON.stringify(body).slice(0, 40), async (subtest) => {
      const calls = setup(subtest, 'admin', async () => ({ rowCount: 1, rows: [{ office_id: officeId }] }), { signedIn: false });
      const response = await visitorRequest(body);
      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), { received: true });
      assert.equal(calls.some(({ sql }) => sql.startsWith('INSERT')), false);
    });
  }
});

test("a visitor's request needs a name, a phone, a message, and a valid email when given", async (t) => {
  const calls = setup(t, 'admin', async () => ({ rowCount: 1, rows: [{ office_id: officeId }] }), { signedIn: false });
  for (const body of [
    { ...VALID_REQUEST, full_name: '' },
    { ...VALID_REQUEST, phone: 'abc' },
    { ...VALID_REQUEST, message: undefined },
    { ...VALID_REQUEST, email: 'not-an-email' },
    { ...VALID_REQUEST, office_id: officeId },
  ]) {
    assert.equal((await visitorRequest(body)).status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
});

test('a lawyer sees only the requests assigned to them, and cannot assign', async (t) => {
  const calls = setup(t, 'lawyer');
  assert.equal((await request('GET', '/api/consultations')).status, 200);
  assert.match(calls[0].sql, /r\.assigned_to_user_id = \$2/);
  assert.deepEqual(calls[0].parameters, [officeId, appUserId]);
  assert.equal((await request('PATCH', `/api/consultations/${requestId}`, { assigned_to_user_id: lawyerId }, { origin: 'http://localhost:5173' })).status, 403);
  assert.equal((await request('POST', `/api/consultations/${requestId}/convert`, {}, { origin: 'http://localhost:5173' })).status, 403);
});

test('assigning a request needs an active staff member of the same office', async (t) => {
  const calls = setup(t, 'admin', async (sql) => (sql.startsWith('UPDATE') ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [REQUEST] }));
  assert.equal((await request('PATCH', `/api/consultations/${requestId}`, { status: 'converted' }, { origin: 'http://localhost:5173' })).status, 400);
  const response = await request('PATCH', `/api/consultations/${requestId}`, { assigned_to_user_id: lawyerId }, { origin: 'http://localhost:5173' });
  assert.equal(response.status, 400);
  const update = calls.find(({ sql }) => sql.startsWith('UPDATE consultation_requests'));
  assert.match(update.sql, /m\.office_id = r\.office_id AND m\.user_id = \$2::uuid/);
  assert.match(update.sql, /m\.status = 'active'/);
  assert.match(update.sql, /r\.office_id = \$3/);
  assert.deepEqual(update.parameters, [requestId, lawyerId, officeId]);
});

test('converting a request creates the client through the usual checks and marks it converted', async (t) => {
  const calls = setup(t, 'admin', async (sql) => {
    if (sql.includes('INSERT INTO clients')) return { rowCount: 1, rows: [{ client_id: clientId, client_type: 'individual', full_name_or_org: 'Visitor', phone: '0599 123 456', email: 'v@example.com', created_at: 'x' }] };
    if (sql.startsWith('UPDATE consultation_requests')) return { rowCount: 1, rows: [{ request_id: requestId }] };
    return { rowCount: 1, rows: [REQUEST] };
  });
  const response = await request('POST', `/api/consultations/${requestId}/convert`, {}, { origin: 'http://localhost:5173' });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).client.client_id, clientId);
  const insert = calls.find(({ sql }) => sql.includes('INSERT INTO clients'));
  assert.equal(insert.parameters.at(-1), officeId);
  const update = calls.find(({ sql }) => sql.startsWith('UPDATE consultation_requests'));
  assert.match(update.sql, /status = 'converted', client_id = \$2/);
  assert.deepEqual(update.parameters, [requestId, clientId, officeId]);
});

test('a converted request cannot change or be converted again', async (t) => {
  setup(t, 'admin', async () => ({ rowCount: 1, rows: [{ ...REQUEST, status: 'converted', client_id: clientId }] }));
  const update = await request('PATCH', `/api/consultations/${requestId}`, { status: 'contacted' }, { origin: 'http://localhost:5173' });
  assert.equal(update.status, 409);
  assert.equal((await update.json()).code, 'REQUEST_CONVERTED');
  assert.equal((await request('POST', `/api/consultations/${requestId}/convert`, {}, { origin: 'http://localhost:5173' })).status, 409);
});

test('one address may send only a few requests in a quarter of an hour', async (t) => {
  setup(t, 'admin', async (sql) => (sql.includes('SELECT p.office_id') ? { rowCount: 1, rows: [{ office_id: officeId }] } : { rowCount: 1, rows: [{ request_id: requestId }] }), { signedIn: false });
  const statuses = [];
  for (let attempt = 0; attempt < 6; attempt += 1) statuses.push((await visitorRequest(VALID_REQUEST, '10.9.9.9')).status);
  assert.deepEqual(statuses, [201, 201, 201, 201, 201, 429]);
});
