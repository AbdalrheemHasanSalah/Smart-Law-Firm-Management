import { query } from '../config/db.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VISIBILITIES = new Set(['internal', 'case_team', 'client_visible']);
const STAFF_VISIBILITIES = new Set(['internal', 'case_team']);
const LIST_FIELDS = new Set(['page', 'pageSize', 'search']);
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
const MAX_BODY_LENGTH = 10000;
const PUBLIC_FIELDS = [
  'note_id',
  'body',
  'visibility',
  'created_at',
  'updated_at',
  'case_id',
];

export class CaseNoteServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'CaseNoteServiceError';
    this.status = status;
  }
}

function invalid(message) {
  throw new CaseNoteServiceError(400, message);
}

function validateUuid(value, field) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    invalid(`${field} must be a valid UUID.`);
  }
  return value;
}

function assertActor(actor, roles) {
  if (!actor || !roles.includes(actor.role)) {
    throw new CaseNoteServiceError(403, 'You do not have permission to access this resource.');
  }
  validateUuid(actor.user_id, 'Authenticated user ID');
}

function parsePositiveInteger(value, fallback, field) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    invalid(`${field} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    invalid(`${field} must be a positive integer.`);
  }
  return parsed;
}

function parseListOptions(parameters = {}) {
  if (
    !parameters
    || typeof parameters !== 'object'
    || Object.keys(parameters).some((key) => !LIST_FIELDS.has(key))
  ) {
    invalid('Unsupported note-list query parameter.');
  }
  const page = parsePositiveInteger(parameters.page, 1, 'page');
  const pageSize = Math.min(
    parsePositiveInteger(parameters.pageSize, DEFAULT_PAGE_SIZE, 'pageSize'),
    MAX_PAGE_SIZE
  );
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) invalid('page is too large.');

  let search = '';
  if (parameters.search !== undefined) {
    if (typeof parameters.search !== 'string') invalid('search must be a string.');
    search = parameters.search.trim();
    if (search.length > 100) invalid('search must contain at most 100 characters.');
  }
  return { page, pageSize, offset, search };
}

function validateBody(body, { create = false, actorRole } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    invalid('Request body must be a JSON object.');
  }
  const allowed = new Set(['body', 'visibility']);
  if (Object.keys(body).some((field) => !allowed.has(field))) {
    invalid('Request contains unsupported note fields.');
  }
  if (create && !Object.hasOwn(body, 'body')) {
    invalid('body is required.');
  }
  if (!create && Object.keys(body).length === 0) {
    invalid('At least one permitted field is required.');
  }

  const fields = {};
  if (Object.hasOwn(body, 'body')) {
    if (typeof body.body !== 'string' || !body.body.trim() || body.body.length > MAX_BODY_LENGTH) {
      invalid(`body must contain 1 to ${MAX_BODY_LENGTH} characters.`);
    }
    fields.body = body.body.trim();
  }
  if (Object.hasOwn(body, 'visibility')) {
    if (!VISIBILITIES.has(body.visibility)) {
      invalid('visibility is not supported.');
    }
    if (actorRole !== 'admin' && !STAFF_VISIBILITIES.has(body.visibility)) {
      throw new CaseNoteServiceError(403, 'Only administrators can publish case notes to clients.');
    }
    fields.visibility = body.visibility;
  }
  return fields;
}

function noteAccessScope(actor, parameters, alias = 'n') {
  if (actor.role === 'admin') return '';

  parameters.push(actor.user_id);
  const userParameter = `$${parameters.length}`;
  if (actor.role === 'lawyer' || actor.role === 'assistant') {
    return `AND EXISTS (
      SELECT 1
      FROM assigned_to assignment
      WHERE assignment.case_id = ${alias}.case_id
        AND assignment.user_id = ${userParameter}
    )`;
  }
  if (actor.role === 'client') {
    return `AND ${alias}.visibility = 'client_visible'
      AND EXISTS (
        SELECT 1
        FROM involves linked_case
        JOIN clients client_record ON client_record.client_id = linked_case.client_id
        WHERE linked_case.case_id = ${alias}.case_id
          AND client_record.user_id = ${userParameter}
      )`;
  }
  throw new CaseNoteServiceError(403, 'You do not have permission to access this resource.');
}

function publicNote(row) {
  return Object.fromEntries(PUBLIC_FIELDS.map((field) => [field, row[field]]));
}

function mapDatabaseError(error) {
  if (['23503', '23514', '22001', '22P02'].includes(error?.code)) {
    throw new CaseNoteServiceError(400, 'Case note data violates a database constraint.');
  }
  throw error;
}

async function execute(text, parameters) {
  try {
    return await query(text, parameters);
  } catch (error) {
    return mapDatabaseError(error);
  }
}

export async function listCaseNotes(actor, caseId, queryParameters = {}) {
  assertActor(actor, ['admin', 'lawyer', 'assistant', 'client']);
  validateUuid(caseId, 'caseId');
  const { page, pageSize, offset, search } = parseListOptions(queryParameters);
  const parameters = [caseId];
  const scope = noteAccessScope(actor, parameters);
  let searchClause = '';
  if (search) {
    parameters.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
    searchClause = `AND n.body ILIKE $${parameters.length} ESCAPE E'\\\\'`;
  }

  const count = await execute(
    `SELECT COUNT(*)::int AS total
       FROM case_notes n
      WHERE n.case_id = $1
        ${scope}
        ${searchClause}`,
    parameters
  );
  const total = count.rows[0].total;
  const pageParameters = [...parameters, pageSize, offset];
  const result = await execute(
    `SELECT n.note_id, n.body, n.visibility, n.created_at, n.updated_at, n.case_id
       FROM case_notes n
      WHERE n.case_id = $1
        ${scope}
        ${searchClause}
      ORDER BY n.created_at DESC, n.note_id ASC
      LIMIT $${pageParameters.length - 1}
      OFFSET $${pageParameters.length}`,
    pageParameters
  );
  return {
    notes: result.rows.map(publicNote),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}

export async function createCaseNote(actor, caseId, body) {
  assertActor(actor, ['admin', 'lawyer', 'assistant']);
  validateUuid(caseId, 'caseId');
  const fields = validateBody(body, { create: true, actorRole: actor.role });
  const result = await execute(
    `INSERT INTO case_notes (body, visibility, case_id, user_id)
     SELECT $1, $2, lc.case_id, creator.user_id
       FROM legal_cases lc
       JOIN app_users creator ON creator.user_id = $3
      WHERE lc.case_id = $4
        AND (
          creator.role_id IN (SELECT role_id FROM roles WHERE role_name = 'admin')
          OR EXISTS (
            SELECT 1
            FROM assigned_to assignment
            WHERE assignment.case_id = lc.case_id
              AND assignment.user_id = creator.user_id
          )
        )
     RETURNING note_id, body, visibility, created_at, updated_at, case_id`,
    [fields.body, fields.visibility ?? 'internal', actor.user_id, caseId]
  );
  if (!result.rowCount) throw new CaseNoteServiceError(404, 'Case not found.');
  return publicNote(result.rows[0]);
}

export async function updateCaseNote(actor, noteId, body) {
  assertActor(actor, ['admin', 'lawyer', 'assistant']);
  validateUuid(noteId, 'noteId');
  const fields = validateBody(body, { actorRole: actor.role });
  const entries = Object.entries(fields);
  const parameters = entries.map(([, value]) => value);
  parameters.push(noteId);
  const scope = noteAccessScope(actor, parameters);
  const assignments = entries.map(([field], index) => `${field} = $${index + 1}`);
  const result = await execute(
    `UPDATE case_notes AS n
        SET ${assignments.join(', ')}, updated_at = NOW()
      WHERE n.note_id = $${entries.length + 1}
        ${scope}
      RETURNING n.note_id, n.body, n.visibility, n.created_at, n.updated_at, n.case_id`,
    parameters
  );
  if (!result.rowCount) throw new CaseNoteServiceError(404, 'Case note not found.');
  return publicNote(result.rows[0]);
}
