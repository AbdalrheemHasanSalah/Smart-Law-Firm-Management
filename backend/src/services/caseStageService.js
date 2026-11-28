import { query } from '../config/db.js';
import { auditLater } from './auditService.js';
import { getCaseById } from './caseService.js';

/**
 * Case stages (مراحل القضية): where a case stands in its life, and its number in Mizan.
 *
 *   registration → preparation → hearings → judgment → appeal → execution → closed
 *
 * Any move is allowed (a case can go back to hearings after an appeal is accepted, say), and each
 * one is kept in the history with who made it and why. The office admin and the lawyers assigned
 * to the case move it; everyone who can open the case sees its stage and history.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF = ['admin', 'lawyer', 'assistant'];
export const STAGES = ['registration', 'preparation', 'hearings', 'judgment', 'appeal', 'execution', 'closed'];
const MAX_NOTE = 1000;
const MAX_MIZAN = 60;

export class CaseStageError extends Error {
  constructor(status, message, publicCode) {
    super(message);
    this.name = 'CaseStageError';
    this.status = status;
    if (publicCode) this.publicCode = publicCode;
  }
}

const invalid = (message) => {
  throw new CaseStageError(400, message, 'VALIDATION');
};
const forbidden = () => {
  throw new CaseStageError(403, 'You do not have permission to access this resource.', 'FORBIDDEN');
};

function assertActor(actor, roles) {
  if (!actor || !roles.includes(actor.role) || typeof actor.user_id !== 'string' || !UUID_PATTERN.test(actor.user_id)) forbidden();
}

async function assertCase(actor, caseId) {
  if (typeof caseId !== 'string' || !UUID_PATTERN.test(caseId)) invalid('caseId must be a valid UUID.');
  try {
    return await getCaseById(actor, caseId);
  } catch (error) {
    if (error?.status === 404 || error?.status === 403) throw new CaseStageError(404, 'Case not found.', 'NOT_FOUND');
    throw error;
  }
}

/** Only the admin and lawyers change stages; assistants read them. */
const assertMover = (actor) => {
  if (actor.role !== 'admin' && actor.role !== 'lawyer') forbidden();
};

/** The Mizan portal's address, when the office set one (MIZAN_URL); the number is shown either way. */
export function mizanUrl(env = process.env) {
  const value = env.MIZAN_URL?.trim();
  return value && /^https:\/\/[^\s]+$/.test(value) ? value : null;
}

export async function getCaseStage(actor, caseId) {
  assertActor(actor, [...STAFF, 'client']);
  await assertCase(actor, caseId);
  const [current, history] = await Promise.all([
    query('SELECT stage, mizan_number FROM legal_cases WHERE case_id = $1 AND office_id = $2', [caseId, actor.office_id]),
    actor.role === 'client'
      ? { rows: [] }
      : query(
          `SELECT h.history_id, h.from_stage, h.to_stage, h.note, h.changed_at, h.changed_by_user_id, u.full_name AS changed_by_name
             FROM case_stage_history h JOIN app_users u ON u.user_id = h.changed_by_user_id
            WHERE h.case_id = $1 AND h.office_id = $2
            ORDER BY h.changed_at DESC
            LIMIT 100`,
          [caseId, actor.office_id]
        ),
  ]);
  const row = current.rows[0] ?? { stage: 'registration', mizan_number: null };
  return {
    stage: row.stage,
    // The client sees where their case stands, not the office's internal notes or the Mizan number.
    ...(actor.role === 'client'
      ? {}
      : {
          mizan_number: row.mizan_number,
          mizan_url: mizanUrl(),
          history: history.rows.map((entry) => ({
            history_id: entry.history_id,
            from_stage: entry.from_stage,
            to_stage: entry.to_stage,
            note: entry.note,
            changed_at: entry.changed_at,
            changed_by: { user_id: entry.changed_by_user_id, full_name: entry.changed_by_name },
          })),
        }),
  };
}

/** Moves the case to another stage and records why. Moving to the stage it is in is refused. */
export async function changeStage(actor, caseId, body) {
  assertActor(actor, STAFF);
  assertMover(actor);
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('A JSON object is required.');
  const unknown = Object.keys(body).filter((key) => !['stage', 'note'].includes(key));
  if (unknown.length) invalid(`Unknown fields: ${unknown.join(', ')}.`);
  if (!STAGES.includes(body.stage)) invalid(`stage must be one of: ${STAGES.join(', ')}.`);
  let note = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string' || body.note.trim().length > MAX_NOTE) invalid(`note must be at most ${MAX_NOTE} characters.`);
    note = body.note.trim() || null;
  }
  const caseRecord = await assertCase(actor, caseId);
  // The previous stage is read and replaced in one statement, so two moves at once cannot both
  // record the same "from".
  const moved = await query(
    `WITH previous AS (
       SELECT stage FROM legal_cases WHERE case_id = $1 AND office_id = $2 FOR UPDATE
     ), updated AS (
       UPDATE legal_cases lc SET stage = $3
         FROM previous
        WHERE lc.case_id = $1 AND lc.office_id = $2 AND previous.stage <> $3
       RETURNING previous.stage AS from_stage
     )
     INSERT INTO case_stage_history (office_id, case_id, from_stage, to_stage, note, changed_by_user_id)
     SELECT $2, $1, updated.from_stage, $3, $4, $5 FROM updated
     RETURNING from_stage`,
    [caseId, actor.office_id, body.stage, note, actor.user_id]
  );
  if (!moved.rowCount) throw new CaseStageError(409, 'The case is already at this stage.', 'SAME_STAGE');
  auditLater(actor, {
    action: 'case_stage_changed',
    entityType: 'case',
    entityId: caseId,
    details: { subject: caseRecord.title, from: moved.rows[0].from_stage, to: body.stage },
  });
  return getCaseStage(actor, caseId);
}

export async function setMizanNumber(actor, caseId, body) {
  assertActor(actor, STAFF);
  assertMover(actor);
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'mizan_number')) {
    invalid('Only mizan_number can be set.');
  }
  const value = body.mizan_number;
  if (value !== null && (typeof value !== 'string' || value.trim().length > MAX_MIZAN || /[\u0000-\u001f]/.test(value))) {
    invalid(`mizan_number must be text of at most ${MAX_MIZAN} characters.`);
  }
  await assertCase(actor, caseId);
  await query('UPDATE legal_cases SET mizan_number = $3 WHERE case_id = $1 AND office_id = $2', [caseId, actor.office_id, value?.trim() || null]);
  auditLater(actor, { action: 'case_mizan_set', entityType: 'case', entityId: caseId, details: { mizan_number: value?.trim() || null } });
  return getCaseStage(actor, caseId);
}
