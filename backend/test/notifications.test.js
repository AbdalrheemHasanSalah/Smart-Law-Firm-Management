import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';

const { notify, notificationEmail } = await import('../src/services/notificationService.js');

const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const caseId = '1cdd115e-0279-48b4-a795-1be1d5a50d0b';
const client = { user_id: 'u-client', email: 'client@example.com', full_name: 'Client', client_id: 'c-1' };
const otherClient = { user_id: 'u-client-2', email: 'other@example.com', full_name: 'Other', client_id: 'c-2' };
const lawyer = { user_id: 'u-lawyer', email: 'lawyer@example.com', full_name: 'Lawyer' };
const owner = { user_id: 'u-owner', email: 'owner@example.com', full_name: 'Owner' };
const platformOwner = { user_id: 'u-platform', email: 'platform@example.com', full_name: 'Platform' };

/** A fake database that answers each lookup by the table it reads, and records every call. */
function harness({ clients = [client], staff = [lawyer], member = [lawyer] } = {}) {
  const calls = [];
  const mails = [];
  const query = async (sql, parameters) => {
    calls.push({ sql, parameters });
    if (sql.includes('INSERT INTO notifications')) return { rows: [], rowCount: 1 };
    if (sql.includes('FROM legal_cases')) return { rows: [{ case_number: '2026/114', title: 'Dispute' }] };
    if (sql.includes('FROM involves')) return { rows: clients };
    if (sql.includes('FROM assigned_to')) return { rows: staff };
    if (sql.includes('m.is_owner = TRUE')) return { rows: [owner] };
    if (sql.includes('m.user_id = $2')) return { rows: member };
    if (sql.includes('is_platform_admin = TRUE')) return { rows: [platformOwner] };
    if (sql.includes('FROM law_offices')) return { rows: [{ name: 'Test Office' }] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  const sendMail = async (message) => {
    mails.push(message);
    return true;
  };
  return { calls, mails, dependencies: { query, sendMail } };
}

const recipients = (mails) => mails.map((mail) => mail.to).sort();

test('a status change reaches the client, the assigned staff and the owner, but not the actor', async () => {
  const { mails, calls, dependencies } = harness();
  const sent = await notify(
    'case.status_changed',
    { officeId, caseId, status: 'closed', actorUserId: lawyer.user_id },
    dependencies
  );
  assert.equal(sent, 2);
  assert.deepEqual(recipients(mails), ['client@example.com', 'owner@example.com']);
  const toClient = mails.find((mail) => mail.to === client.email);
  assert.match(toClient.text, /2026\/114/);
  assert.match(toClient.text, /مغلقة/);
  assert.ok(toClient.text.endsWith(`/portal#case-${caseId}`));
  // every lookup is scoped to the acting office
  for (const { sql, parameters } of calls.filter(({ sql }) => sql.includes('FROM involves') || sql.includes('FROM assigned_to'))) {
    assert.deepEqual(parameters, [caseId, officeId], sql);
  }
});

test('an internal note is announced to the owner only, never to the client or the team', async () => {
  const { mails, dependencies } = harness();
  await notify('case.note_added', { officeId, caseId, visibility: 'internal', actorUserId: lawyer.user_id }, dependencies);
  assert.deepEqual(recipients(mails), ['owner@example.com']);
});

test('a team note reaches staff and owner; only a client-visible note reaches the client', async () => {
  const team = harness();
  await notify('case.note_added', { officeId, caseId, visibility: 'case_team', actorUserId: owner.user_id }, team.dependencies);
  assert.deepEqual(recipients(team.mails), ['lawyer@example.com']);

  const visible = harness();
  await notify('case.note_added', { officeId, caseId, visibility: 'client_visible', actorUserId: owner.user_id }, visible.dependencies);
  assert.deepEqual(recipients(visible.mails), ['client@example.com', 'lawyer@example.com']);
});

test('the email never carries the note or file content, only that something changed', async () => {
  const { mails, dependencies } = harness();
  await notify(
    'case.note_added',
    { officeId, caseId, visibility: 'client_visible', actorUserId: owner.user_id, body: 'SECRET STRATEGY' },
    dependencies
  );
  for (const mail of mails) {
    assert.doesNotMatch(mail.html, /SECRET STRATEGY/);
    assert.doesNotMatch(mail.text, /SECRET STRATEGY/);
  }
});

test('a shared document is announced only to the client it was shared with', async () => {
  const { mails, dependencies } = harness({ clients: [client, otherClient] });
  await notify(
    'case.document_added',
    { officeId, caseId, accessLevel: 'authorized_users', clientId: 'c-1', actorUserId: lawyer.user_id },
    dependencies
  );
  assert.deepEqual(recipients(mails), ['client@example.com', 'owner@example.com']);

  const restricted = harness({ clients: [client] });
  await notify(
    'case.document_added',
    { officeId, caseId, accessLevel: 'restricted', clientId: null, actorUserId: lawyer.user_id },
    restricted.dependencies
  );
  assert.deepEqual(recipients(restricted.mails), ['owner@example.com']);
});

test('assignments and tasks notify the person they are given to', async () => {
  const assigned = harness();
  await notify('case.staff_assigned', { officeId, caseId, userId: lawyer.user_id, actorUserId: owner.user_id }, assigned.dependencies);
  assert.deepEqual(recipients(assigned.mails), ['lawyer@example.com']);

  const task = harness();
  await notify('task.assigned', { officeId, userId: lawyer.user_id, actorUserId: owner.user_id }, task.dependencies);
  assert.deepEqual(recipients(task.mails), ['lawyer@example.com']);

  const done = harness();
  await notify('task.completed', { officeId, actorUserId: lawyer.user_id }, done.dependencies);
  assert.deepEqual(recipients(done.mails), ['owner@example.com']);
});

test('the platform owner hears about a new office, and the office owner about the decision', async () => {
  const registered = harness();
  await notify('office.registered', { officeName: 'New Office', actorUserId: 'someone' }, registered.dependencies);
  assert.deepEqual(recipients(registered.mails), ['platform@example.com']);
  assert.match(registered.mails[0].text, /New Office/);
  assert.equal(registered.calls.some(({ sql }) => sql.includes('INSERT INTO notifications')), false);

  const reviewed = harness();
  await notify('office.reviewed', { officeId, status: 'active', actorUserId: platformOwner.user_id }, reviewed.dependencies);
  assert.deepEqual(recipients(reviewed.mails), ['owner@example.com']);
  assert.match(reviewed.mails[0].subject, /اعتماد/);
});

test('office notifications are also stored for the in-app list, per recipient and office', async () => {
  const { calls, dependencies } = harness();
  await notify('case.status_changed', { officeId, caseId, status: 'open', actorUserId: 'nobody' }, dependencies);
  const inserts = calls.filter(({ sql }) => sql.includes('INSERT INTO notifications'));
  assert.equal(inserts.length, 3);
  for (const { parameters } of inserts) assert.equal(parameters[4], officeId);
});

test('each stored notification keeps the page it opens: the case file, or the case in the portal', async () => {
  const { calls, dependencies } = harness();
  await notify('case.note_added', { officeId, caseId, visibility: 'client_visible', actorUserId: 'nobody' }, dependencies);
  const pages = calls
    .filter(({ sql }) => sql.includes('INSERT INTO notifications'))
    .map(({ parameters }) => [parameters[3], parameters[5]]);
  assert.deepEqual(pages.sort(), [
    ['u-client', `/portal#case-${caseId}`],
    ['u-lawyer', `/office/cases/${caseId}?tab=notes`],
    ['u-owner', `/office/cases/${caseId}?tab=notes`],
  ]);

  const document = harness();
  await notify('case.document_added', { officeId, caseId, accessLevel: 'case_team', actorUserId: 'nobody' }, document.dependencies);
  const toLawyer = document.calls.find(({ sql, parameters }) => sql.includes('INSERT INTO notifications') && parameters[3] === 'u-lawyer');
  assert.equal(toLawyer.parameters[5], `/office/cases/${caseId}?tab=documents`);
});

test('an unknown case or event sends nothing', async () => {
  const mails = [];
  const dependencies = { query: async () => ({ rows: [] }), sendMail: async (mail) => mails.push(mail) };
  assert.equal(await notify('case.status_changed', { officeId, caseId, status: 'open' }, dependencies), 0);
  assert.equal(await notify('something.else', { officeId }, dependencies), 0);
  assert.equal(mails.length, 0);
});

test('the email escapes its text and links to the app', () => {
  const email = notificationEmail({ title: '<b>x</b>', body: 'a & b', url: 'http://localhost:5173/portal', button: 'افتح' });
  assert.match(email.html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(email.html, /a &amp; b/);
  assert.match(email.html, /href="http:\/\/localhost:5173\/portal"/);
});
