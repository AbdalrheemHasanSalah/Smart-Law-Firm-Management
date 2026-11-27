import { query } from '../config/db.js';
import { auditLater } from './auditService.js';
import { officeCondition } from './officeScope.js';

/**
 * A case's session log and the outcome of each hearing.
 *
 * Every hearing row is one entry of the log. After a session, the administrator or a member of
 * the case team records what happened: held (with its decision), postponed (with the reason and
 * the next date, which becomes the next hearing of the same case), or cancelled. Scheduling a
 * hearing from scratch stays with the administrator (calendarService).
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const STAFF = ['admin', 'lawyer', 'assistant'];
const OUTCOMES = ['completed', 'postponed', 'cancelled'];

export class HearingServiceError extends Error {
  constructor(status, message, publicCode) {
    super(message);
    this.name = 'HearingServiceError';
    this.status = status;
    if (publicCode) this.publicCode = publicCode;
  }
}

const invalid = (message) => {
  throw new HearingServiceError(400, message, 'VALIDATION');
};

function assertStaff(actor) {
  if (!actor || !STAFF.includes(actor.role) || typeof actor.user_id !== 'string' || !UUID_PATTERN.test(actor.user_id)) {
    throw new HearingServiceError(403, 'You do not have permission to access this resource.', 'FORBIDDEN');
  }
}

const uuid = (value, field) => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) invalid(`${field} must be a valid UUID.`);
  return value;
};

function text(value, field, max) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return null;
  if (typeof value !== 'string' || value.trim().length > max) invalid(`${field} must contain at most ${max} characters.`);
  return value.trim();
}

const timestamp = (value, field) => {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    invalid(`${field} must be an ISO timestamp.`);
  }
  return value;
};

// PostgreSQL refuses values a statement never uses, so only the used ones are sent.
function usedParameters(sql, parameters) {
  const highest = Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])));
  return parameters.slice(0, highest);
}

async function execute(sql, parameters) {
  try {
    return await query(sql, usedParameters(sql, parameters));
  } catch (error) {
    if (['23502', '23503', '23514', '22001', '22007', '22008', '22P02'].includes(error?.code)) {
      invalid('Hearing data violates a database constraint.');
    }
    throw error;
  }
}

/** Limits `${alias}.case_id` to the actor's cases: all of the office for the administrator. */
function caseAccess(actor, parameters, alias) {
  const office = officeCondition(actor, parameters, alias);
  if (actor.role === 'admin') return office;
  parameters.push(actor.user_id);
  return `${office} AND EXISTS (SELECT 1 FROM assigned_to mine
                                  WHERE mine.case_id = ${alias}.case_id AND mine.user_id = $${parameters.length})`;
}

const LOG_COLUMNS = `
  h.hearing_id, h.hearing_at, h.hearing_type, h.court_room, h.status, h.outcome, h.notes,
  h.postponement_reason, h.next_hearing_id, h.outcome_recorded_at, h.case_id,
  h.attended_by_user_id, attendee.full_name AS attended_by_name,
  recorder.full_name AS outcome_recorded_by_name,
  next.hearing_at AS next_hearing_at, co.name AS court_name`;

const LOG_FROM = `
  FROM hearings h
  LEFT JOIN app_users attendee ON attendee.user_id = h.attended_by_user_id
  LEFT JOIN app_users recorder ON recorder.user_id = h.outcome_recorded_by_user_id
  LEFT JOIN hearings next ON next.hearing_id = h.next_hearing_id
  LEFT JOIN courts co ON co.court_id = h.court_id`;

/** The case's sessions, oldest first: the log as it reads in the case file. */
export async function listCaseHearings(actor, caseId) {
  assertStaff(actor);
  uuid(caseId, 'caseId');
  const parameters = [caseId];
  const scope = caseAccess(actor, parameters, 'h');
  const result = await execute(
    `SELECT ${LOG_COLUMNS} ${LOG_FROM}
      WHERE h.case_id = $1 AND ${scope}
      ORDER BY h.hearing_at, h.hearing_id`,
    parameters
  );
  // An empty log may mean no hearings or a case out of reach; tell them apart for the caller.
  if (!result.rowCount) {
    const caseParameters = [caseId];
    const reachable = await execute(
      `SELECT 1 FROM legal_cases lc WHERE lc.case_id = $1 AND ${caseAccess(actor, caseParameters, 'lc')} LIMIT 1`,
      caseParameters
    );
    if (!reachable.rowCount) throw new HearingServiceError(404, 'Case not found.', 'NOT_FOUND');
  }
  return { hearings: result.rows };
}

const OUTCOME_FIELDS = ['status', 'outcome', 'attended_by_user_id', 'postponed_to', 'postponement_reason', 'next_court_room'];

/**
 * Records what happened at a hearing. A postponement with a date creates the next hearing of the
 * case (same type and court) and links the two, in the same statement. Once a hearing has been
 * postponed to a next one, that link is kept: the next date is changed on the next hearing.
 */
export async function recordHearingOutcome(actor, hearingId, body) {
  assertStaff(actor);
  uuid(hearingId, 'hearingId');
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Request body must be a JSON object.');
  if (Object.keys(body).some((field) => !OUTCOME_FIELDS.includes(field))) invalid('Request contains unsupported fields.');
  if (!OUTCOMES.includes(body.status)) invalid('status must be completed, postponed or cancelled.');
  const status = body.status;
  const outcome = text(body.outcome, 'outcome', 2000);
  const attendedBy = body.attended_by_user_id == null ? null : uuid(body.attended_by_user_id, 'attended_by_user_id');
  const reason = text(body.postponement_reason, 'postponement_reason', 1000);
  const nextRoom = text(body.next_court_room, 'next_court_room', 50);
  const postponedTo = body.postponed_to == null ? null : timestamp(body.postponed_to, 'postponed_to');
  if (status !== 'postponed' && (postponedTo || reason || nextRoom)) {
    invalid('A next date, a postponement reason and a next room apply to a postponement only.');
  }

  const parameters = [hearingId, attendedBy];
  const scope = caseAccess(actor, parameters, 'h');
  const found = await execute(
    `SELECT h.hearing_id, h.hearing_at, h.case_id, h.status, h.next_hearing_id,
            ($2::uuid IS NULL OR EXISTS (
              SELECT 1 FROM office_memberships m JOIN roles r ON r.role_id = m.role_id
               WHERE m.office_id = h.office_id AND m.user_id = $2::uuid AND m.status = 'active'
                 AND r.role_name IN ('admin', 'lawyer', 'assistant'))) AS attendee_ok
       FROM hearings h
      WHERE h.hearing_id = $1 AND ${scope}
      LIMIT 1`,
    parameters
  );
  if (!found.rowCount) throw new HearingServiceError(404, 'Hearing not found.', 'NOT_FOUND');
  const hearing = found.rows[0];
  if (!hearing.attendee_ok) invalid('The attending lawyer must be an active member of the office.');
  if (hearing.next_hearing_id && (status !== 'postponed' || postponedTo)) {
    throw new HearingServiceError(409, 'This hearing was already postponed to a next session.', 'HEARING_ALREADY_POSTPONED');
  }
  if (postponedTo && Date.parse(postponedTo) <= new Date(hearing.hearing_at).getTime()) {
    invalid('postponed_to must be after the hearing.');
  }

  const write = [hearingId, status, outcome, attendedBy, reason, postponedTo, nextRoom, actor.user_id];
  const office = officeCondition(actor, write, 'h');
  const result = await execute(
    `WITH target AS (
       SELECT h.hearing_id, h.hearing_type, h.court_room, h.case_id, h.court_id, h.office_id
         FROM hearings h WHERE h.hearing_id = $1 AND ${office}
        FOR UPDATE
     ), next AS (
       INSERT INTO hearings (hearing_at, hearing_type, court_room, case_id, court_id, office_id)
       SELECT $6::timestamptz, target.hearing_type, COALESCE($7::text, target.court_room),
              target.case_id, target.court_id, target.office_id
         FROM target WHERE $6::timestamptz IS NOT NULL
       RETURNING hearing_id
     )
     UPDATE hearings h
        SET status = $2, outcome = $3, attended_by_user_id = $4::uuid,
            postponement_reason = $5::text,
            next_hearing_id = COALESCE((SELECT hearing_id FROM next), h.next_hearing_id),
            outcome_recorded_at = NOW(), outcome_recorded_by_user_id = $8
       FROM target
      WHERE h.hearing_id = target.hearing_id
      RETURNING h.hearing_id, h.case_id, h.status, h.next_hearing_id`,
    write
  );
  if (!result.rowCount) throw new HearingServiceError(404, 'Hearing not found.', 'NOT_FOUND');
  const saved = result.rows[0];
  auditLater(actor, {
    action: status === 'postponed' ? 'hearing_postponed' : status === 'cancelled' ? 'hearing_cancelled' : 'hearing_held',
    entityType: 'case',
    entityId: hearing.case_id,
    details: {
      values: {
        status, outcome, postponement_reason: reason,
        ...(postponedTo ? { hearing_at: postponedTo } : {}),
      },
    },
  });
  return saved;
}

/**
 * A client's upcoming hearings, in the cases they are a party to: when, what kind, and where.
 * The outcomes and notes the office records stay internal.
 */
export async function listClientUpcomingHearings(actor) {
  if (!actor || actor.role !== 'client' || typeof actor.user_id !== 'string' || !UUID_PATTERN.test(actor.user_id)) {
    throw new HearingServiceError(403, 'You do not have permission to access this resource.', 'FORBIDDEN');
  }
  const parameters = [actor.user_id];
  const office = officeCondition(actor, parameters, 'h');
  const result = await execute(
    `SELECT h.hearing_id, h.hearing_at, h.hearing_type, h.court_room, co.name AS court_name,
            lc.case_id, lc.case_number, lc.title AS case_title
       FROM hearings h
       JOIN legal_cases lc ON lc.case_id = h.case_id AND lc.office_id = h.office_id
       LEFT JOIN courts co ON co.court_id = h.court_id
      WHERE ${office} AND h.status = 'scheduled' AND h.hearing_at >= NOW()
        AND EXISTS (SELECT 1 FROM involves party JOIN clients own ON own.client_id = party.client_id AND own.office_id = party.office_id
                     WHERE party.case_id = h.case_id AND party.office_id = h.office_id AND own.user_id = $1)
      ORDER BY h.hearing_at
      LIMIT 50`,
    parameters
  );
  return { hearings: result.rows };
}
