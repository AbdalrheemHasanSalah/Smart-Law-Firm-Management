/**
 * The in-app inbox: the notification list and direct messages.
 *
 * Who may message whom, always inside the session's active office:
 *   - a client and the staff assigned to one of that client's cases;
 *   - a lawyer or assistant and the office administrators (the owner);
 *   - an office administrator and every member of the office.
 * The rule is enforced in SQL on every read and write, so a user ID guessed or taken from
 * another office is answered exactly like one that does not exist.
 */
import { query as databaseQuery } from '../config/db.js';
import { hasOfficeContext } from './officeScope.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = ['admin', 'lawyer', 'assistant', 'client'];
const MAX_MESSAGE_LENGTH = 4000;
const THREAD_LIMIT = 200;
const NOTIFICATION_LIMIT = 30;

export class InboxServiceError extends Error {
  constructor(status, message, publicCode) {
    super(message);
    this.name = 'InboxServiceError';
    this.status = status;
    if (publicCode) this.publicCode = publicCode;
  }
}

function assertActor(actor) {
  if (!hasOfficeContext(actor)) {
    throw new InboxServiceError(403, 'An active office is required for this request.', 'NO_ACTIVE_OFFICE');
  }
  if (!ROLES.includes(actor.role) || typeof actor.user_id !== 'string' || !UUID_PATTERN.test(actor.user_id)) {
    throw new InboxServiceError(403, 'You do not have permission to access this resource.');
  }
}

/* ───────────── who the actor may write to ───────────── */

// $1 = office, $2 = actor. Every variant lists active members of the same office, minus the actor.
const MEMBERS = `
  SELECT u.user_id, u.full_name, r.role_name AS role
  FROM office_memberships m
  JOIN app_users u ON u.user_id = m.user_id
  JOIN roles r ON r.role_id = m.role_id
  WHERE m.office_id = $1
    AND m.user_id <> $2
    AND m.status = 'active'
    AND u.status = 'active'`;

// The member is a client on a case assigned to the actor.
const IS_CLIENT_OF_ACTOR = `
  EXISTS (
    SELECT 1
    FROM clients c
    JOIN involves i ON i.client_id = c.client_id AND i.office_id = c.office_id
    JOIN assigned_to a ON a.case_id = i.case_id AND a.office_id = i.office_id
    WHERE c.office_id = m.office_id AND c.user_id = m.user_id AND a.user_id = $2
  )`;

// The member is staff assigned to a case of the acting client.
const IS_STAFF_OF_ACTOR = `
  EXISTS (
    SELECT 1
    FROM clients c
    JOIN involves i ON i.client_id = c.client_id AND i.office_id = c.office_id
    JOIN assigned_to a ON a.case_id = i.case_id AND a.office_id = i.office_id
    WHERE c.office_id = m.office_id AND c.user_id = $2 AND a.user_id = m.user_id
  )`;

export function contactsSql(role) {
  if (role === 'admin') return MEMBERS;
  if (role === 'client') return `${MEMBERS} AND ${IS_STAFF_OF_ACTOR}`;
  return `${MEMBERS} AND (r.role_name = 'admin' OR ${IS_CLIENT_OF_ACTOR})`;
}

async function findContact(actor, userId, query) {
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) {
    throw new InboxServiceError(400, 'userId must be a valid UUID.');
  }
  const result = await query(`${contactsSql(actor.role)} AND m.user_id = $3`, [actor.office_id, actor.user_id, userId]);
  if (!result.rows.length) throw new InboxServiceError(404, 'Contact not found.');
  return result.rows[0];
}

/* ───────────── messages ───────────── */

/** The people the actor may write to, with unread counts and the time of the last message. */
export async function listContacts(actor, { query = databaseQuery } = {}) {
  assertActor(actor);
  const parameters = [actor.office_id, actor.user_id];
  const [contacts, activity] = await Promise.all([
    query(`${contactsSql(actor.role)} ORDER BY u.full_name, u.user_id`, parameters),
    query(
      `SELECT other_user_id,
              COUNT(*) FILTER (WHERE unread)::int AS unread_count,
              MAX(sent_at) AS last_message_at
       FROM (
         SELECT CASE WHEN sender_user_id = $2 THEN receiver_user_id ELSE sender_user_id END AS other_user_id,
                sent_at,
                (receiver_user_id = $2 AND read_at IS NULL) AS unread
         FROM messages
         WHERE office_id = $1 AND (sender_user_id = $2 OR receiver_user_id = $2)
       ) threads
       GROUP BY other_user_id`,
      parameters
    ),
  ]);
  const byUser = new Map(activity.rows.map((row) => [row.other_user_id, row]));
  return contacts.rows
    .map((contact) => ({
      ...contact,
      unread_count: byUser.get(contact.user_id)?.unread_count ?? 0,
      last_message_at: byUser.get(contact.user_id)?.last_message_at ?? null,
    }))
    .sort((a, b) => String(b.last_message_at ?? '').localeCompare(String(a.last_message_at ?? '')));
}

/** The conversation with one contact, oldest first. Opening it marks what was received as read. */
export async function getThread(actor, userId, { query = databaseQuery } = {}) {
  assertActor(actor);
  const contact = await findContact(actor, userId, query);
  const parameters = [actor.office_id, actor.user_id, userId];
  await query(
    `UPDATE messages SET read_at = NOW()
     WHERE office_id = $1 AND receiver_user_id = $2 AND sender_user_id = $3 AND read_at IS NULL`,
    parameters
  );
  const result = await query(
    `SELECT message_id, body, sent_at, read_at, sender_user_id, receiver_user_id
     FROM messages
     WHERE office_id = $1
       AND ((sender_user_id = $2 AND receiver_user_id = $3) OR (sender_user_id = $3 AND receiver_user_id = $2))
     ORDER BY sent_at DESC, message_id
     LIMIT ${THREAD_LIMIT}`,
    parameters
  );
  return { contact, messages: result.rows.reverse() };
}

export async function sendMessage(actor, userId, body, { query = databaseQuery } = {}) {
  assertActor(actor);
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((field) => field !== 'body')) {
    throw new InboxServiceError(400, 'Request body must contain only the message body.');
  }
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text || text.length > MAX_MESSAGE_LENGTH) {
    throw new InboxServiceError(400, `body must contain 1 to ${MAX_MESSAGE_LENGTH} characters.`);
  }
  const contact = await findContact(actor, userId, query);
  const result = await query(
    `INSERT INTO messages (body, message_type, sender_user_id, receiver_user_id, office_id)
     VALUES ($1, 'direct', $2, $3, $4)
     RETURNING message_id, body, sent_at, read_at, sender_user_id, receiver_user_id`,
    [text, actor.user_id, userId, actor.office_id]
  );
  return { message: result.rows[0], contact };
}

export async function countUnreadMessages(actor, { query = databaseQuery } = {}) {
  assertActor(actor);
  const result = await query(
    `SELECT COUNT(*)::int AS unread FROM messages
     WHERE office_id = $1 AND receiver_user_id = $2 AND read_at IS NULL`,
    [actor.office_id, actor.user_id]
  );
  return result.rows[0]?.unread ?? 0;
}

/* ───────────── notifications ───────────── */

export async function listNotifications(actor, { query = databaseQuery } = {}) {
  assertActor(actor);
  const parameters = [actor.office_id, actor.user_id];
  const [list, unread] = await Promise.all([
    query(
      `SELECT notification_id, title, body, notification_type, link_path, read_at, created_at
       FROM notifications
       WHERE office_id = $1 AND user_id = $2
       ORDER BY created_at DESC, notification_id
       LIMIT ${NOTIFICATION_LIMIT}`,
      parameters
    ),
    query(
      `SELECT COUNT(*)::int AS unread FROM notifications
       WHERE office_id = $1 AND user_id = $2 AND read_at IS NULL`,
      parameters
    ),
  ]);
  return { notifications: list.rows, unread: unread.rows[0]?.unread ?? 0 };
}

/** "Clear all": removes the actor's notifications in the active office. */
export async function clearNotifications(actor, { query = databaseQuery } = {}) {
  assertActor(actor);
  const result = await query(
    'DELETE FROM notifications WHERE office_id = $1 AND user_id = $2',
    [actor.office_id, actor.user_id]
  );
  return { deleted: result.rowCount ?? 0 };
}

/** Marks one of the actor's notifications read (it was opened). Someone else's is left alone. */
export async function markNotificationRead(actor, notificationId, { query = databaseQuery } = {}) {
  assertActor(actor);
  if (typeof notificationId !== 'string' || !UUID_PATTERN.test(notificationId)) {
    throw new InboxServiceError(400, 'notificationId must be a valid UUID.');
  }
  const result = await query(
    `UPDATE notifications SET read_at = NOW()
     WHERE notification_id = $1 AND office_id = $2 AND user_id = $3 AND read_at IS NULL`,
    [notificationId, actor.office_id, actor.user_id]
  );
  return { updated: result.rowCount ?? 0 };
}

export async function markNotificationsRead(actor, { query = databaseQuery } = {}) {
  assertActor(actor);
  const result = await query(
    `UPDATE notifications SET read_at = NOW()
     WHERE office_id = $1 AND user_id = $2 AND read_at IS NULL`,
    [actor.office_id, actor.user_id]
  );
  return { updated: result.rowCount ?? 0 };
}
