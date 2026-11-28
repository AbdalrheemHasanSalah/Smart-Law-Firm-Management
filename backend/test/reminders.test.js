import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');
const { localClock, reminderConfig, reminderKey, reminderMessage, runReminders } = await import('../src/services/reminderService.js');

const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const userId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const caseId = 'e4663540-663f-4d4d-b8f2-bfbc6a414d64';
const hearingId = 'a1111111-1111-4111-8111-111111111111';
const env = { REMINDER_TIMEZONE: 'Asia/Hebron', REMINDER_MORNING_HOUR: '7' };
// 27 November 2026, 08:30 in Palestine (UTC+2).
const MORNING = new Date('2026-11-27T06:30:00Z');

const HEARING_ROW = {
  kind: 'hearing', subject_id: hearingId, at: new Date('2026-11-28T07:00:00Z'), detail: 'مرافعة',
  case_id: caseId, case_number: '2026/114', office_id: officeId, moment: 'day_before',
  user_id: userId, email: 'lawyer@example.com', full_name: 'Lawyer', email_reminders: true,
};

/** A fake database: due rows per kind, claims answered by `claim`, every call recorded. */
function fakeDatabase({ due = {}, claim = () => true } = {}) {
  const calls = [];
  const query = async (sql, values = []) => {
    calls.push({ sql, values });
    if (sql.includes('INSERT INTO reminder_deliveries')) return claim(values) ? { rowCount: 1, rows: [{ reminder_key: values[0] }] } : { rowCount: 0, rows: [] };
    const kind = /SELECT '(\w+)' AS kind/.exec(sql)?.[1];
    if (kind) return { rowCount: (due[kind] ?? []).length, rows: due[kind] ?? [] };
    return { rowCount: 0, rows: [] };
  };
  return { calls, query };
}

test('the local day and hour follow the configured time zone', () => {
  assert.deepEqual(localClock(new Date('2026-11-27T05:30:00Z'), 'Asia/Hebron'), { day: '2026-11-27', hour: 7 });
  assert.deepEqual(localClock(new Date('2026-11-27T23:30:00Z'), 'Asia/Hebron'), { day: '2026-11-28', hour: 1 });
});

test('a wrong time zone or hour is refused', () => {
  assert.throws(() => reminderConfig({ REMINDER_TIMEZONE: 'Mars/Olympus' }), /REMINDER_TIMEZONE/);
  assert.throws(() => reminderConfig({ REMINDER_MORNING_HOUR: '25' }), /REMINDER_MORNING_HOUR/);
  assert.deepEqual(reminderConfig({}), { timeZone: 'Asia/Hebron', morningHour: 7 });
});

test('nothing is sent before the morning hour', async () => {
  const { calls, query } = fakeDatabase({ due: { hearing: [HEARING_ROW] } });
  const sent = await runReminders({ now: new Date('2026-11-27T03:00:00Z'), query, env, channels: [] });
  assert.equal(sent, 0);
  assert.equal(calls.length, 0);
});

test('each kind is asked with exactly the values its query uses', async () => {
  const { calls, query } = fakeDatabase();
  await runReminders({ now: MORNING, query, env, channels: [] });
  const byKind = Object.fromEntries(calls.filter(({ sql }) => /AS kind/.test(sql)).map(({ sql, values }) => [/SELECT '(\w+)' AS kind/.exec(sql)[1], { sql, values }]));
  assert.deepEqual(Object.keys(byKind), ['hearing', 'task', 'appointment', 'poa', 'installment']);
  assert.deepEqual(byKind.installment.values, ['2026-11-27', '2026-11-28']);
  assert.match(byKind.installment.sql, /i\.status IN \('unpaid', 'partially_paid'\)/, 'only installments still owed');
  assert.match(byKind.installment.sql, /a\.status = 'active'/, 'not settled agreements');
  assert.deepEqual(byKind.hearing.values, ['Asia/Hebron', '2026-11-27', '2026-11-28', MORNING.toISOString()]);
  assert.deepEqual(byKind.task.values, ['Asia/Hebron', '2026-11-28']);
  assert.deepEqual(byKind.appointment.values, ['Asia/Hebron', '2026-11-27', MORNING.toISOString()]);
  assert.deepEqual(byKind.poa.values, ['2026-11-27']);
  for (const { sql, values } of Object.values(byKind)) {
    const highest = Math.max(...[...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])));
    assert.equal(values.length, highest, 'each query is sent exactly the values it uses');
    // Only active members of active offices, with active accounts, are reminded.
    assert.match(sql, /o\.status = 'active'/);
    assert.match(sql, /member\.status = 'active'/);
    assert.match(sql, /u\.status = 'active'/);
  }
  assert.match(byKind.hearing.sql, /h\.status = 'scheduled'/);
  assert.match(byKind.hearing.sql, /JOIN assigned_to team/);
  assert.match(byKind.task.sql, /t\.status IN \('pending', 'in_progress'\)/);
  assert.match(byKind.poa.sql, /r\.role_name = 'admin'/);
  assert.match(byKind.poa.sql, /power_of_attorney_lawyers/);
});

test('a claimed reminder goes in-app and by email; nobody gets it twice', async () => {
  const seen = new Set();
  const { calls, query } = fakeDatabase({
    due: { hearing: [HEARING_ROW, HEARING_ROW] },
    claim: ([key, user]) => (seen.has(`${key}|${user}`) ? false : (seen.add(`${key}|${user}`), true)),
  });
  const mails = [];
  const sent = await runReminders({ now: MORNING, query, env, sendMail: async (mail) => (mails.push(mail), true) });
  assert.equal(sent, 1);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'lawyer@example.com');
  assert.match(mails[0].subject, /تذكير: جلسة غداً/);
  const inApp = calls.filter(({ sql }) => sql.includes('INSERT INTO notifications'));
  assert.equal(inApp.length, 1);
  // tapping it in the app opens the case on its hearings
  assert.deepEqual(inApp[0].values.slice(2), [userId, officeId, `/office/cases/${caseId}?tab=hearings`]);
  const claim = calls.find(({ sql }) => sql.includes('INSERT INTO reminder_deliveries'));
  assert.match(claim.sql, /ON CONFLICT DO NOTHING/);
  assert.ok(calls.findIndex(({ sql }) => sql.includes('INSERT INTO reminder_deliveries'))
    < calls.findIndex(({ sql }) => sql.includes('INSERT INTO notifications')), 'claimed before it is delivered');
});

test('someone who turned reminder emails off still gets the in-app reminder', async () => {
  const { calls, query } = fakeDatabase({ due: { task: [{ ...HEARING_ROW, kind: 'task', email_reminders: false }] } });
  const mails = [];
  await runReminders({ now: MORNING, query, env, sendMail: async (mail) => (mails.push(mail), true) });
  assert.equal(mails.length, 0);
  assert.equal(calls.filter(({ sql }) => sql.includes('INSERT INTO notifications')).length, 1);
});

test('a failing channel does not stop the others', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { query } = fakeDatabase({ due: { appointment: [{ ...HEARING_ROW, kind: 'appointment', moment: 'same_day', detail: 'expert_session' }] } });
  const delivered = [];
  const sent = await runReminders({
    now: MORNING, query, env,
    channels: [
      { name: 'broken', deliver: async () => { throw new Error('down'); } },
      { name: 'working', deliver: async ({ message }) => { delivered.push(message.title); return true; } },
    ],
  });
  assert.equal(sent, 1);
  assert.deepEqual(delivered, ['تذكير: موعد اليوم']);
});

test('a rescheduled hearing gets new reminders, and the two reminders of a day are distinct', () => {
  const moved = { ...HEARING_ROW, at: new Date('2026-11-29T07:00:00Z') };
  const sameDay = { ...HEARING_ROW, moment: 'same_day' };
  assert.notEqual(reminderKey(HEARING_ROW), reminderKey(moved));
  assert.notEqual(reminderKey(HEARING_ROW), reminderKey(sameDay));
  assert.equal(reminderKey(HEARING_ROW), reminderKey({ ...HEARING_ROW }));
});

test('reminders name the case and the local time, never the details of the work', () => {
  const hearing = reminderMessage(HEARING_ROW, 'Asia/Hebron');
  assert.match(hearing.body, /2026\/114/);
  assert.match(hearing.body, /9:00/);
  assert.equal(hearing.path, `/office/cases/${caseId}?tab=hearings`);
  const poa = reminderMessage({ ...HEARING_ROW, kind: 'poa', detail: 'و-2026/0412', days_left: 7, at: '2026-12-04' }, 'Asia/Hebron');
  assert.match(poa.body, /خلال 7 يوماً/);
  const task = reminderMessage({ ...HEARING_ROW, kind: 'task', detail: null }, 'Asia/Hebron');
  assert.doesNotMatch(task.body, /مرافعة/);
  // 23:30 UTC is already the next day in Palestine: the calendar opens on the local day
  const appointment = reminderMessage({ ...HEARING_ROW, kind: 'appointment', detail: 'meeting', at: new Date('2026-11-27T23:30:00Z') }, 'Asia/Hebron');
  assert.equal(appointment.path, '/office/calendar?day=2026-11-28');
});

/* ───────────── the person's own preference ───────────── */

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

function signedIn(t, handler) {
  t.mock.method(console, 'error', () => {});
  t.mock.method(auth.api, 'getSession', async () => ({ user: { id: 'auth-user-id' }, session: { id: 's', expiresAt: '2999-01-01T00:00:00.000Z' } }));
  const calls = [];
  t.mock.method(pool, 'query', async (sql, values = []) => {
    if (sql.includes('u.auth_user_id')) {
      return { rowCount: 1, rows: [{ user_id: userId, auth_user_id: 'auth-user-id', full_name: 'L', email: 'l@example.com', email_verified: true, status: 'active', role_id: 'r', office_id: officeId, role: 'lawyer' }] };
    }
    calls.push({ sql, values });
    return handler(sql, values);
  });
  return calls;
}

const call = (method, body) => fetch(`${baseUrl}/api/me/preferences`, {
  method,
  headers: { cookie: 'better-auth.session_token=test', ...(body ? { 'content-type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

test('a person reads and changes only their own reminder-email preference', async (t) => {
  const calls = signedIn(t, async (sql, values) => ({ rowCount: 1, rows: [{ email_reminders: sql.startsWith('UPDATE') ? values[0] : true }] }));
  assert.deepEqual(await (await call('GET')).json(), { preferences: { email_reminders: true } });
  const response = await call('PATCH', { email_reminders: false });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { preferences: { email_reminders: false } });
  const update = calls.find(({ sql }) => sql.startsWith('UPDATE app_users'));
  assert.deepEqual(update.values, [false, userId]);
});

test('only a true or false reminder-email preference is accepted', async (t) => {
  const calls = signedIn(t, async () => ({ rowCount: 1, rows: [{ email_reminders: true }] }));
  for (const body of [{ email_reminders: 'no' }, { email_reminders: false, is_platform_admin: true }, { status: 'active' }]) {
    assert.equal((await call('PATCH', body)).status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
});
