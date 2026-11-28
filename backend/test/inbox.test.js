import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';

const {
  contactsSql,
  countUnreadMessages,
  getThread,
  listContacts,
  listNotifications,
  markNotificationsRead,
  sendMessage,
} = await import('../src/services/inboxService.js');
const { notify } = await import('../src/services/notificationService.js');

const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const me = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const other = '1cdd115e-0279-48b4-a795-1be1d5a50d0b';
const actor = (role) => ({ user_id: me, office_id: officeId, role, full_name: 'Me' });
const contactRow = { user_id: other, full_name: 'Other', role: 'lawyer' };

/** Records every query; `answers` maps a fragment of the SQL to the rows returned. */
function fakeDatabase(answers = []) {
  const calls = [];
  const query = async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    const match = answers.find(([fragment]) => sql.includes(fragment));
    const rows = match ? match[1] : [];
    return { rows, rowCount: rows.length };
  };
  return { calls, query };
}

test('each role is limited to its own contacts', () => {
  const admin = contactsSql('admin');
  const lawyer = contactsSql('lawyer');
  const client = contactsSql('client');
  // an administrator may write to any active member of the office
  assert.doesNotMatch(admin, /EXISTS/);
  // staff: administrators, or clients on a case assigned to the staff member
  assert.match(lawyer, /r\.role_name = 'admin' OR/);
  assert.match(lawyer, /c\.user_id = m\.user_id AND a\.user_id = \$2/);
  assert.equal(contactsSql('assistant'), lawyer);
  // client: only staff assigned to one of the client's own cases
  assert.match(client, /c\.user_id = \$2 AND a\.user_id = m\.user_id/);
  assert.doesNotMatch(client, /role_name = 'admin' OR/);
  // every variant stays inside the office, excludes the actor and inactive accounts
  for (const sql of [admin, lawyer, client]) {
    assert.match(sql, /m\.office_id = \$1/);
    assert.match(sql, /m\.user_id <> \$2/);
    assert.match(sql, /m\.status = 'active'/);
    assert.match(sql, /u\.status = 'active'/);
  }
});

test('contacts carry unread counts and are ordered by latest message', async () => {
  const quiet = { user_id: '2f1e0d3c-4b5a-4978-8695-a4b3c2d1e0f9', full_name: 'Quiet', role: 'admin' };
  const { query, calls } = fakeDatabase([
    ['FROM office_memberships m', [quiet, contactRow]],
    ['GROUP BY other_user_id', [{ other_user_id: other, unread_count: 2, last_message_at: '2026-11-10T10:00:00.000Z' }]],
  ]);
  const contacts = await listContacts(actor('lawyer'), { query });
  assert.deepEqual(contacts.map((contact) => contact.user_id), [other, quiet.user_id]);
  assert.equal(contacts[0].unread_count, 2);
  assert.equal(contacts[1].unread_count, 0);
  for (const { parameters } of calls) assert.deepEqual(parameters, [officeId, me]);
});

test('a thread is refused for someone who is not a contact, before anything is read or written', async () => {
  const { query, calls } = fakeDatabase();
  await assert.rejects(getThread(actor('client'), other, { query }), { status: 404 });
  await assert.rejects(sendMessage(actor('client'), other, { body: 'hello' }, { query }), { status: 404 });
  assert.equal(calls.some(({ sql }) => /UPDATE messages|INSERT INTO messages|FROM messages/.test(sql)), false);
});

test('opening a thread marks received messages as read and returns them oldest first', async () => {
  const newer = { message_id: 'm2', body: 'second', sent_at: '2026-11-10T10:05:00.000Z' };
  const older = { message_id: 'm1', body: 'first', sent_at: '2026-11-10T10:00:00.000Z' };
  const { query, calls } = fakeDatabase([
    ['AND m.user_id = $3', [contactRow]],
    ['SELECT message_id', [newer, older]],
  ]);
  const thread = await getThread(actor('admin'), other, { query });
  assert.deepEqual(thread.messages.map((message) => message.message_id), ['m1', 'm2']);
  const update = calls.find(({ sql }) => sql.includes('UPDATE messages'));
  assert.match(update.sql, /receiver_user_id = \$2 AND sender_user_id = \$3 AND read_at IS NULL/);
  assert.deepEqual(update.parameters, [officeId, me, other]);
});

test('a message is stored in the actor office with the actor as sender', async () => {
  const { query, calls } = fakeDatabase([
    ['AND m.user_id = $3', [contactRow]],
    ['INSERT INTO messages', [{ message_id: 'm1', body: 'hello' }]],
  ]);
  const { message, contact } = await sendMessage(actor('lawyer'), other, { body: '  hello  ' }, { query });
  assert.equal(message.message_id, 'm1');
  assert.equal(contact.user_id, other);
  const insert = calls.find(({ sql }) => sql.includes('INSERT INTO messages'));
  assert.deepEqual(insert.parameters, ['hello', me, other, officeId]);
});

test('invalid messages and identifiers are rejected', async () => {
  const { query } = fakeDatabase([['AND m.user_id = $3', [contactRow]]]);
  await assert.rejects(sendMessage(actor('admin'), other, { body: '   ' }, { query }), { status: 400 });
  await assert.rejects(sendMessage(actor('admin'), other, { body: 'x'.repeat(4001) }, { query }), { status: 400 });
  await assert.rejects(sendMessage(actor('admin'), other, { body: 'hi', office_id: 'x' }, { query }), { status: 400 });
  await assert.rejects(sendMessage(actor('admin'), 'not-a-uuid', { body: 'hi' }, { query }), { status: 400 });
});

test('a session without an office or with an unknown role is refused', async () => {
  const { query, calls } = fakeDatabase();
  await assert.rejects(listContacts({ user_id: me, role: 'admin' }, { query }), { status: 403, publicCode: 'NO_ACTIVE_OFFICE' });
  await assert.rejects(listNotifications({ user_id: me, office_id: officeId, role: 'guest' }, { query }), { status: 403 });
  assert.equal(calls.length, 0);
});

test('notifications and counts are read for the actor in the active office only', async () => {
  const { query, calls } = fakeDatabase([
    ['SELECT notification_id', [{ notification_id: 'n1', title: 'T' }]],
    ['FROM notifications', [{ unread: 3 }]],
    ['FROM messages', [{ unread: 4 }]],
  ]);
  const inbox = await listNotifications(actor('client'), { query });
  assert.equal(inbox.notifications.length, 1);
  assert.equal(inbox.unread, 3);
  assert.equal(await countUnreadMessages(actor('client'), { query }), 4);
  await markNotificationsRead(actor('client'), { query });
  for (const { sql, parameters } of calls) {
    assert.deepEqual(parameters, [officeId, me], sql);
    assert.match(sql, /office_id = \$1/);
  }
});

test('a new message notifies its receiver with a link to their own area', async () => {
  const receiver = { user_id: other, email: 'other@example.com', full_name: 'Other' };
  const mails = [];
  const dependencies = {
    query: async (sql) => (sql.includes('m.user_id = $2') ? { rows: [receiver] } : { rows: [], rowCount: 1 }),
    sendMail: async (mail) => mails.push(mail),
  };
  await notify('message.received', { officeId, actorUserId: me, userId: other, receiverRole: 'client', senderName: 'Lina' }, dependencies);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'other@example.com');
  assert.match(mails[0].text, /Lina/);
  assert.match(mails[0].text, /\/portal\/messages$/);
});

test('clear all removes only the actor notifications in the active office', async () => {
  const { clearNotifications } = await import('../src/services/inboxService.js');
  const calls = [];
  const query = async (sql, parameters) => {
    calls.push({ sql, parameters });
    return { rowCount: 3, rows: [] };
  };
  assert.deepEqual(await clearNotifications(actor('lawyer'), { query }), { deleted: 3 });
  assert.match(calls[0].sql, /^DELETE FROM notifications WHERE office_id = \$1 AND user_id = \$2$/);
  assert.deepEqual(calls[0].parameters, [officeId, me]);
  await assert.rejects(clearNotifications({ user_id: me, role: 'lawyer' }, { query }), { status: 403 });
});

test('opening an office request marks it seen once; clear all marks every pending request', async () => {
  const { markOfficesSeen } = await import('../src/services/platformService.js');
  const platformAdmin = { user_id: me, is_platform_admin: true };
  const calls = [];
  const query = async (sql, parameters) => {
    calls.push({ sql, parameters });
    return { rowCount: 1, rows: [] };
  };
  assert.deepEqual(await markOfficesSeen(platformAdmin, other, { query }), { updated: 1 });
  assert.match(calls[0].sql, /WHERE office_id = \$1 AND platform_seen_at IS NULL/);
  assert.deepEqual(calls[0].parameters, [other]);
  await markOfficesSeen(platformAdmin, null, { query });
  assert.match(calls[1].sql, /WHERE status = 'pending' AND platform_seen_at IS NULL/);
  await assert.rejects(markOfficesSeen({ user_id: me, is_platform_admin: false }, other, { query }), { status: 403 });
  await assert.rejects(markOfficesSeen(platformAdmin, 'not-a-uuid', { query }), { status: 400 });
  assert.equal(calls.length, 2);
});
