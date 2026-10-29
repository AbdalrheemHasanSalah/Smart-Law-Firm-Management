import { pool, query } from '../config/db.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OFFICE_STATUSES = new Set(['pending', 'active', 'rejected', 'suspended']);
const REVIEW_DECISIONS = new Set(['active', 'rejected', 'suspended']);
const ACCOUNT_STATUSES = new Set(['active', 'inactive', 'suspended']);

export class PlatformServiceError extends Error {
  constructor(status, message, publicCode) {
    super(message);
    this.name = 'PlatformServiceError';
    this.status = status;
    if (publicCode) this.publicCode = publicCode;
  }
}

function invalid(message) {
  throw new PlatformServiceError(400, message, 'VALIDATION');
}

function assertPlatformAdmin(actor) {
  if (actor?.is_platform_admin !== true) {
    throw new PlatformServiceError(403, 'You do not have permission to access this resource.', 'FORBIDDEN');
  }
}

export async function listOffices(actor, queryParameters = {}) {
  assertPlatformAdmin(actor);
  if (Object.keys(queryParameters).some((key) => key !== 'status')) {
    invalid('Unsupported office-list query parameter.');
  }
  const { status } = queryParameters;
  if (status !== undefined && !OFFICE_STATUSES.has(status)) invalid('status is not supported.');

  const result = await query(
    `SELECT office.office_id, office.name, office.email, office.phone, office.city, office.address,
            office.license_number, office.status, office.review_note, office.reviewed_at,
            office.created_at, owner.full_name AS owner_name, owner.email AS owner_email,
            profile.bar_number AS owner_bar_number, profile.license_status AS owner_license_status
       FROM law_offices office
       JOIN app_users owner ON owner.user_id = office.created_by_user_id
       LEFT JOIN lawyer_profiles profile ON profile.user_id = owner.user_id
      WHERE ($1::text IS NULL OR office.status = $1)
      ORDER BY office.created_at DESC
      LIMIT 200`,
    [status ?? null]
  );
  return result.rows;
}

/**
 * Approving an office also marks the owner's bar licence as verified, since checking the bar
 * number is part of the review. Suspending or rejecting removes the office from open sessions.
 */
export async function reviewOffice(actor, officeId, body) {
  assertPlatformAdmin(actor);
  if (typeof officeId !== 'string' || !UUID_PATTERN.test(officeId)) invalid('officeId must be a valid UUID.');
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Request body must be a JSON object.');
  if (Object.keys(body).some((field) => field !== 'status' && field !== 'review_note')) {
    invalid('Request contains unsupported fields.');
  }
  if (!REVIEW_DECISIONS.has(body.status)) invalid('status must be active, rejected, or suspended.');
  const note = body.review_note ?? null;
  if (note !== null && (typeof note !== 'string' || note.length > 2000)) {
    invalid('review_note must be a string of at most 2000 characters.');
  }

  const client = await pool.connect();
  let releaseError;
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE law_offices
          SET status = $2, review_note = $3, reviewed_at = NOW(), reviewed_by_user_id = $4, updated_at = NOW()
        WHERE office_id = $1
        RETURNING office_id, name, status, review_note, reviewed_at, created_by_user_id`,
      [officeId, body.status, note, actor.user_id]
    );
    if (!updated.rowCount) throw new PlatformServiceError(404, 'Office not found.', 'NOT_FOUND');

    if (body.status === 'active') {
      await client.query(
        "UPDATE lawyer_profiles SET license_status = 'active' WHERE user_id = $1 AND license_status = 'pending'",
        [updated.rows[0].created_by_user_id]
      );
    } else {
      await client.query('UPDATE sessions SET active_office_id = NULL WHERE active_office_id = $1', [officeId]);
    }
    await client.query(
      `INSERT INTO audit_logs (action, entity_type, entity_id, user_id, details)
       VALUES ('office_reviewed', 'law_office', $1, $2, $3::jsonb)`,
      [officeId, actor.user_id, JSON.stringify({ status: body.status })]
    );
    await client.query('COMMIT');
    const { created_by_user_id: _owner, ...office } = updated.rows[0];
    return office;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      releaseError = rollbackError;
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

/**
 * Platform-wide account status (sign-in for every office). Kept from the original user-status
 * logic: every session of the account is deleted on suspension and again on reactivation, so a
 * session created while the account was inactive can never be revived.
 */
export async function updateAccountStatus(actor, userId, body) {
  assertPlatformAdmin(actor);
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) invalid('userId must be a valid UUID.');
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).length !== 1 || !ACCOUNT_STATUSES.has(body.status)) {
    invalid('Request must contain only a status of active, inactive, or suspended.');
  }
  if (actor.user_id?.toLowerCase() === userId.toLowerCase() && body.status !== 'active') {
    throw new PlatformServiceError(400, 'Platform administrators cannot suspend their own account.', 'VALIDATION');
  }

  const client = await pool.connect();
  let releaseError;
  try {
    await client.query('BEGIN');
    const account = await client.query(
      'SELECT status, auth_user_id FROM app_users WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    if (!account.rowCount) throw new PlatformServiceError(404, 'User not found.', 'NOT_FOUND');
    const updated = await client.query(
      `UPDATE app_users SET status = $2, updated_at = NOW()
        WHERE user_id = $1
        RETURNING user_id, full_name, email, status`,
      [userId, body.status]
    );
    const { status: previousStatus, auth_user_id: authUserId } = account.rows[0];
    if ((body.status !== 'active' || previousStatus !== 'active') && authUserId) {
      await client.query('DELETE FROM sessions WHERE user_id = $1', [authUserId]);
    }
    await client.query(
      `INSERT INTO audit_logs (action, entity_type, entity_id, user_id, details)
       VALUES ('account_status_changed', 'app_user', $1, $2, $3::jsonb)`,
      [userId, actor.user_id, JSON.stringify({ status: body.status })]
    );
    await client.query('COMMIT');
    return updated.rows[0];
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      releaseError = rollbackError;
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}
