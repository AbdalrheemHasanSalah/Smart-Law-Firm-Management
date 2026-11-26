import { query } from '../config/db.js';
import { auditLater, pickValues } from './auditService.js';
import { getCaseById } from './caseService.js';
import { checkConflicts } from './conflictService.js';

/**
 * Opposing parties of a case. Reading follows the case's own access rules; adding and removing
 * are for the office administrator, like linking clients to a case. Adding one runs the
 * conflict-of-interest check and returns its result with the new record.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPPONENT_FIELDS = ['opponent_id', 'case_id', 'full_name', 'national_id', 'phone', 'notes', 'created_at'];
const ALLOWED = new Set(['full_name', 'national_id', 'phone', 'notes']);

export class OpponentServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'OpponentServiceError';
    this.status = status;
  }
}

const invalid = (message) => {
  throw new OpponentServiceError(400, message);
};

const publicOpponent = (row) => Object.fromEntries(OPPONENT_FIELDS.map((field) => [field, row[field]]));

function optionalText(body, field, max, pattern) {
  if (!Object.hasOwn(body, field) || body[field] === null) return null;
  if (typeof body[field] !== 'string') invalid(`${field} must be a string or null.`);
  const value = body[field].trim();
  if (value.length > max || (value && pattern && !pattern.test(value))) invalid(`${field} is not valid.`);
  return value || null;
}

function validateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Request body must be a JSON object.');
  if (Object.keys(body).some((field) => !ALLOWED.has(field))) invalid('Request contains unsupported fields.');
  if (typeof body.full_name !== 'string' || !body.full_name.trim() || body.full_name.trim().length > 200) {
    invalid('full_name must contain 1 to 200 characters.');
  }
  return {
    full_name: body.full_name.trim(),
    national_id: optionalText(body, 'national_id', 30, /^[\p{L}\p{N}\s-]+$/u),
    phone: optionalText(body, 'phone', 30, /^[+()\d.\-\s]+$/),
    notes: optionalText(body, 'notes', 2000),
  };
}

export async function listOpponents(actor, caseId) {
  // Throws 404 when the actor cannot see the case.
  await getCaseById(actor, caseId);
  const result = await query(
    `SELECT ${OPPONENT_FIELDS.map((field) => `o.${field}`).join(', ')}
       FROM case_opponents o
      WHERE o.case_id = $1 AND o.office_id = $2
      ORDER BY o.created_at`,
    [caseId, actor.office_id]
  );
  return result.rows.map(publicOpponent);
}

export async function addOpponent(actor, caseId, body) {
  if (!actor || actor.role !== 'admin') {
    throw new OpponentServiceError(403, 'You do not have permission to access this resource.');
  }
  const fields = validateBody(body);
  await getCaseById(actor, caseId);
  // Checked before the insert, so the new record does not match itself.
  const conflicts = await checkConflicts(actor, {
    role: 'opponent',
    name: fields.full_name,
    ...(fields.national_id ? { national_id: fields.national_id } : {}),
    ...(fields.phone ? { phone: fields.phone } : {}),
  });
  const result = await query(
    `INSERT INTO case_opponents (office_id, case_id, full_name, national_id, phone, notes, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${OPPONENT_FIELDS.join(', ')}`,
    [actor.office_id, caseId, fields.full_name, fields.national_id, fields.phone, fields.notes, actor.user_id]
  );
  const opponent = publicOpponent(result.rows[0]);
  auditLater(actor, {
    action: 'opponent_added',
    entityType: 'opponent',
    entityId: opponent.opponent_id,
    details: { case_id: caseId, values: pickValues(opponent, ['full_name', 'national_id', 'phone']), conflict: conflicts.conflict },
  });
  return { opponent, conflicts };
}

export async function removeOpponent(actor, caseId, opponentId) {
  if (!actor || actor.role !== 'admin') {
    throw new OpponentServiceError(403, 'You do not have permission to access this resource.');
  }
  if (typeof opponentId !== 'string' || !UUID_PATTERN.test(opponentId)) invalid('opponentId must be a valid UUID.');
  await getCaseById(actor, caseId);
  const result = await query(
    `DELETE FROM case_opponents
      WHERE opponent_id = $1 AND case_id = $2 AND office_id = $3
      RETURNING ${OPPONENT_FIELDS.join(', ')}`,
    [opponentId, caseId, actor.office_id]
  );
  if (!result.rowCount) throw new OpponentServiceError(404, 'Opposing party not found.');
  auditLater(actor, {
    action: 'opponent_removed',
    entityType: 'opponent',
    entityId: opponentId,
    details: { case_id: caseId, values: pickValues(result.rows[0], ['full_name', 'national_id', 'phone']) },
  });
}
