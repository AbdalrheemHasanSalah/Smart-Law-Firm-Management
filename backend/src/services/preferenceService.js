import { query } from '../config/db.js';

/**
 * A person's own settings kept on the server (unlike the language and theme, which stay in the
 * browser): for now, whether reminders also come by email. In-app reminders are always kept.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PreferenceServiceError extends Error {
  constructor(status, message, publicCode) {
    super(message);
    this.name = 'PreferenceServiceError';
    this.status = status;
    if (publicCode) this.publicCode = publicCode;
  }
}

function assertUser(actor) {
  if (!actor || typeof actor.user_id !== 'string' || !UUID_PATTERN.test(actor.user_id)) {
    throw new PreferenceServiceError(401, 'Authentication required.', 'UNAUTHORIZED');
  }
}

export async function getPreferences(actor) {
  assertUser(actor);
  const result = await query('SELECT email_reminders FROM app_users WHERE user_id = $1', [actor.user_id]);
  if (!result.rowCount) throw new PreferenceServiceError(404, 'User not found.', 'NOT_FOUND');
  return { preferences: { email_reminders: result.rows[0].email_reminders } };
}

export async function updatePreferences(actor, body) {
  assertUser(actor);
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).length !== 1 || typeof body.email_reminders !== 'boolean') {
    throw new PreferenceServiceError(400, 'Only email_reminders (true or false) can be changed.', 'VALIDATION');
  }
  const result = await query(
    `UPDATE app_users SET email_reminders = $1, updated_at = NOW() WHERE user_id = $2 RETURNING email_reminders`,
    [body.email_reminders, actor.user_id]
  );
  if (!result.rowCount) throw new PreferenceServiceError(404, 'User not found.', 'NOT_FOUND');
  return { preferences: { email_reminders: result.rows[0].email_reminders } };
}
