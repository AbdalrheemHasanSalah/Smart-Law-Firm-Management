import { pool, query } from '../config/db.js';
import { auditLater, diffValues, pickValues } from './auditService.js';
import { officeCondition } from './officeScope.js';
import { auditClientCreated, insertClient, validateNewClient } from './clientService.js';

const CASE_FIELDS = [
  'case_id',
  'case_number',
  'title',
  'case_type',
  'status',
  'priority',
  'opened_at',
  'closed_at',
  'description',
  'court_id',
];
const CASE_TYPES = new Set([
  'case_number',
  'title',
  'case_type',
  'status',
  'priority',
  'opened_at',
  'closed_at',
  'description',
  'court_id',
]);
const AUDITED_CASE_FIELDS = ['case_number', 'title', 'case_type', 'status', 'priority', 'opened_at', 'closed_at', 'description', 'court_id'];
const CASE_STATUSES = new Set(['open', 'in_progress', 'on_hold', 'closed', 'cancelled']);
const CASE_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;

export class CaseServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'CaseServiceError';
    this.status = status;
  }
}

function invalid(message) {
  throw new CaseServiceError(400, message);
}

function validateObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('Request body must be a JSON object.');
  }
}

function validateCaseId(caseId) {
  if (typeof caseId !== 'string' || !UUID_PATTERN.test(caseId)) {
    invalid('caseId must be a valid UUID.');
  }
  return caseId;
}

function validateDate(value, field) {
  if (value === null) return null;
  if (typeof value !== 'string') {
    invalid(`${field} must be a valid ISO date or timestamp.`);
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) {
    invalid(`${field} must be a valid ISO date or timestamp.`);
  }
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    invalid(`${field} must be a valid ISO date or timestamp.`);
  }
  return value;
}

function validateAndNormalizeFields(body, { create = false } = {}) {
  validateObject(body);
  const unknownFields = Object.keys(body).filter((field) => !CASE_TYPES.has(field));
  if (unknownFields.length) {
    invalid('Request contains unsupported fields.');
  }

  if (create && (!Object.hasOwn(body, 'case_number') || !Object.hasOwn(body, 'title') || !Object.hasOwn(body, 'case_type'))) {
    invalid('case_number, title, and case_type are required.');
  }
  if (!create && Object.keys(body).length === 0) {
    invalid('At least one permitted field is required.');
  }

  const fields = {};
  for (const [field, maxLength] of [
    ['case_number', 50],
    ['title', 200],
    ['case_type', 50],
  ]) {
    if (!Object.hasOwn(body, field)) continue;
    if (typeof body[field] !== 'string') {
      invalid(`${field} must be a string.`);
    }
    const value = body[field].trim();
    if (!value || value.length > maxLength) {
      invalid(`${field} must contain 1 to ${maxLength} characters.`);
    }
    fields[field] = value;
  }

  if (Object.hasOwn(body, 'status')) {
    if (!CASE_STATUSES.has(body.status)) {
      invalid('status is not an allowed case status.');
    }
    fields.status = body.status;
  }
  if (Object.hasOwn(body, 'priority')) {
    if (!CASE_PRIORITIES.has(body.priority)) {
      invalid('priority is not an allowed case priority.');
    }
    fields.priority = body.priority;
  }

  for (const field of ['opened_at', 'closed_at']) {
    if (Object.hasOwn(body, field)) {
      if (field === 'opened_at' && body[field] === null) {
        invalid('opened_at cannot be null.');
      }
      fields[field] = validateDate(body[field], field);
    }
  }

  if (Object.hasOwn(body, 'description')) {
    if (body.description === null) {
      fields.description = null;
    } else if (typeof body.description === 'string' && body.description.length <= 10000) {
      fields.description = body.description;
    } else {
      invalid('description must be a string or null of at most 10000 characters.');
    }
  }

  if (Object.hasOwn(body, 'court_id')) {
    if (body.court_id === null) {
      fields.court_id = null;
    } else if (typeof body.court_id === 'string' && UUID_PATTERN.test(body.court_id)) {
      fields.court_id = body.court_id;
    } else {
      invalid('court_id must be a valid UUID or null.');
    }
  }

  if (fields.opened_at && fields.closed_at) {
    if (Date.parse(fields.closed_at) < Date.parse(fields.opened_at)) {
      invalid('closed_at cannot be earlier than opened_at.');
    }
  }

  return fields;
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

function parseListOptions(queryParameters = {}) {
  const allowedParameters = new Set(['page', 'pageSize', 'search']);
  if (Object.keys(queryParameters).some((key) => !allowedParameters.has(key))) {
    invalid('Unsupported case-list query parameter.');
  }

  const page = parsePositiveInteger(queryParameters.page, 1, 'page');
  const pageSize = Math.min(
    parsePositiveInteger(queryParameters.pageSize, DEFAULT_PAGE_SIZE, 'pageSize'),
    MAX_PAGE_SIZE
  );
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) invalid('page is too large.');

  let search = '';
  if (queryParameters.search !== undefined) {
    if (typeof queryParameters.search !== 'string') {
      invalid('search must be a string.');
    }
    search = queryParameters.search.trim();
    if (search.length > 100) invalid('search must contain at most 100 characters.');
  }
  return { page, pageSize, offset, search };
}

function assertRole(actor, roles) {
  if (!actor || !roles.includes(actor.role)) {
    throw new CaseServiceError(403, 'You do not have permission to access this resource.');
  }
  if (typeof actor.user_id !== 'string' || !UUID_PATTERN.test(actor.user_id)) {
    throw new CaseServiceError(403, 'You do not have permission to access this resource.');
  }
}

function accessScope(actor, parameters, alias = 'lc') {
  const office = `AND ${officeCondition(actor, parameters, alias)}`;
  if (actor.role === 'admin') return office;
  parameters.push(actor.user_id);
  const userParameter = `$${parameters.length}`;

  if (actor.role === 'lawyer' || actor.role === 'assistant') {
    return `
      ${office}
      AND EXISTS (
        SELECT 1
        FROM assigned_to assignment
        WHERE assignment.case_id = ${alias}.case_id
          AND assignment.user_id = ${userParameter}
      )
    `;
  }
  if (actor.role === 'client') {
    return `
      ${office}
      AND EXISTS (
        SELECT 1
        FROM involves i
        JOIN clients c ON c.client_id = i.client_id
        WHERE i.case_id = ${alias}.case_id
          AND c.user_id = ${userParameter}
      )
    `;
  }
  throw new CaseServiceError(403, 'You do not have permission to access this resource.');
}

function publicCase(row) {
  if (!row) return null;
  return Object.fromEntries(CASE_FIELDS.map((field) => [field, row[field]]));
}

function mapDatabaseError(error) {
  if (error?.code === '23505') {
    throw new CaseServiceError(409, 'A record conflicts with existing data.');
  }
  if (['23502', '23503', '23514', '22001', '22007', '22P02'].includes(error?.code)) {
    throw new CaseServiceError(400, 'Case data violates a database constraint.');
  }
  throw error;
}

async function execute(sql, parameters) {
  try {
    return await query(sql, parameters);
  } catch (error) {
    return mapDatabaseError(error);
  }
}

export async function listCases(actor, queryParameters) {
  assertRole(actor, ['admin', 'lawyer', 'assistant', 'client']);
  const { page, pageSize, offset, search } = parseListOptions(queryParameters);
  const parameters = [];
  const scope = accessScope(actor, parameters);
  let searchClause = '';

  if (search) {
    parameters.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
    const searchParameter = `$${parameters.length}`;
    searchClause = `
      AND (
        lc.case_number ILIKE ${searchParameter} ESCAPE E'\\\\'
        OR lc.title ILIKE ${searchParameter} ESCAPE E'\\\\'
        OR lc.case_type ILIKE ${searchParameter} ESCAPE E'\\\\'
      )
    `;
  }

  const count = await execute(
    `
      SELECT COUNT(*)::int AS total
      FROM legal_cases lc
      WHERE TRUE
      ${scope}
      ${searchClause}
    `,
    parameters
  );
  const total = count.rows[0].total;
  const pageParameters = [...parameters, pageSize, offset];
  const result = await execute(
    `
      SELECT
        lc.case_id,
        lc.case_number,
        lc.title,
        lc.case_type,
        lc.status,
        lc.priority,
        lc.opened_at,
        lc.closed_at,
        lc.description,
        lc.court_id
      FROM legal_cases lc
      WHERE TRUE
      ${scope}
      ${searchClause}
      ORDER BY lc.opened_at DESC, lc.case_id ASC
      LIMIT $${pageParameters.length - 1}
      OFFSET $${pageParameters.length}
    `,
    pageParameters
  );

  return {
    cases: result.rows.map(publicCase),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}

export async function getCaseById(actor, caseId) {
  assertRole(actor, ['admin', 'lawyer', 'assistant', 'client']);
  validateCaseId(caseId);
  const parameters = [caseId];
  const scope = accessScope(actor, parameters);
  const result = await execute(
    `
      SELECT
        lc.case_id,
        lc.case_number,
        lc.title,
        lc.case_type,
        lc.status,
        lc.priority,
        lc.opened_at,
        lc.closed_at,
        lc.description,
        lc.court_id
      FROM legal_cases lc
      WHERE lc.case_id = $1
      ${scope}
      LIMIT 1
    `,
    parameters
  );
  if (!result.rowCount) throw new CaseServiceError(404, 'Case not found.');
  return publicCase(result.rows[0]);
}

/**
 * The client a case is opened for: `client_id` names an existing client of the office,
 * `new_client` holds the fields of a client created along with it. Either one, or neither.
 */
function readClientChoice(body) {
  validateObject(body);
  const { client_id: clientId, new_client: newClient, ...rest } = body;
  if (clientId !== undefined && newClient !== undefined) {
    invalid('Send either client_id or new_client, not both.');
  }
  if (clientId !== undefined && (typeof clientId !== 'string' || !UUID_PATTERN.test(clientId))) {
    invalid('client_id must be a valid UUID.');
  }
  return { rest, clientId, newClient: newClient === undefined ? null : validateNewClient(newClient) };
}

async function rollbackQuietly(client) {
  try {
    await client.query('ROLLBACK');
    return undefined;
  } catch (rollbackError) {
    return rollbackError;
  }
}

/**
 * Runs `work` in one transaction on a dedicated connection: a case and its client are stored
 * together or not at all. Database errors keep their usual case-service meaning.
 */
async function inTransaction(work) {
  const client = await pool.connect();
  let releaseError;
  try {
    await client.query('BEGIN');
    const result = await work({
      query: async (sql, parameters) => {
        try {
          return await client.query(sql, parameters);
        } catch (error) {
          return mapDatabaseError(error);
        }
      },
      raw: client,
    });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    releaseError = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(releaseError);
  }
}

/** The existing client, checked to belong to the actor's office; locked until the case is stored. */
async function findOfficeClient(db, actor, clientId) {
  const parameters = [clientId];
  const officeClause = officeCondition(actor, parameters, 'c');
  const found = await db.query(
    `SELECT c.client_id, c.full_name_or_org FROM clients c WHERE c.client_id = $1 AND ${officeClause} FOR SHARE`,
    parameters
  );
  if (!found.rowCount) throw new CaseServiceError(404, 'Client not found.');
  return found.rows[0];
}

/**
 * Opens a case. With a client (an existing one, or a new one created here) the case, the client
 * and the link between them are stored in one transaction, the client marked as the primary party.
 */
export async function createCase(actor, body) {
  assertRole(actor, ['admin']);
  const { rest, clientId, newClient } = readClientChoice(body);
  const fields = validateAndNormalizeFields(rest, { create: true });
  if (!clientId && !newClient) {
    const created = publicCase((await execute(INSERT_CASE_SQL, insertCaseParameters(fields, actor))).rows[0]);
    auditCaseCreated(actor, created);
    return created;
  }

  const { created, client, clientIsNew } = await inTransaction(async ({ query: db, raw }) => {
    const party = newClient
      ? await insertClient(raw, actor, newClient)
      : await findOfficeClient({ query: db }, actor, clientId);
    const caseRow = publicCase((await db(INSERT_CASE_SQL, insertCaseParameters(fields, actor))).rows[0]);
    await db(
      `INSERT INTO involves (client_id, case_id, office_id, is_primary) VALUES ($1, $2, $3, TRUE)`,
      [party.client_id, caseRow.case_id, actor.office_id]
    );
    return { created: caseRow, client: party, clientIsNew: Boolean(newClient) };
  });
  if (clientIsNew) auditClientCreated(actor, client);
  auditCaseCreated(actor, created);
  return { ...created, client: { client_id: client.client_id, full_name_or_org: client.full_name_or_org } };
}

function auditCaseCreated(actor, created) {
  auditLater(actor, {
    action: 'case_created',
    entityType: 'case',
    entityId: created.case_id,
    details: { values: pickValues(created, AUDITED_CASE_FIELDS) },
  });
}

function insertCaseParameters(fields, actor) {
  return [
    fields.case_number,
    fields.title,
    fields.case_type,
    fields.status ?? 'open',
    fields.priority ?? 'medium',
    fields.opened_at ?? null,
    fields.closed_at ?? null,
    fields.description ?? null,
    fields.court_id ?? null,
    actor.office_id,
  ];
}

const INSERT_CASE_SQL = `
      INSERT INTO legal_cases (
        case_number,
        title,
        case_type,
        status,
        priority,
        opened_at,
        closed_at,
        description,
        court_id,
        office_id
      )
      VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()), $7, $8, $9, $10)
      RETURNING
        case_id,
        case_number,
        title,
        case_type,
        status,
        priority,
        opened_at,
        closed_at,
        description,
        court_id
    `;

export async function updateCase(actor, caseId, body) {
  assertRole(actor, ['admin', 'lawyer', 'assistant']);
  validateCaseId(caseId);
  const fields = validateAndNormalizeFields(body);
  const entries = Object.entries(fields);
  const parameters = entries.map(([, value]) => value);
  const assignments = entries.map(([field], index) => `${field} = $${index + 1}`);
  parameters.push(caseId);
  const scope = accessScope(actor, parameters, 'lc');

  const result = await execute(
    `
      UPDATE legal_cases AS lc
      SET ${assignments.join(', ')}
      FROM legal_cases previous
      WHERE lc.case_id = $${entries.length + 1}
      AND previous.case_id = lc.case_id
      ${scope}
      RETURNING
        lc.case_id,
        lc.case_number,
        lc.title,
        lc.case_type,
        lc.status,
        lc.priority,
        lc.opened_at,
        lc.closed_at,
        lc.description,
        lc.court_id,
        row_to_json(previous) AS previous
    `,
    parameters
  );
  if (!result.rowCount) throw new CaseServiceError(404, 'Case not found.');
  const updated = publicCase(result.rows[0]);
  // `previous` is the row as the statement found it, for the activity log.
  auditLater(actor, {
    action: 'case_updated',
    entityType: 'case',
    entityId: updated.case_id,
    details: { subject: updated.title, changes: diffValues(result.rows[0].previous, updated, AUDITED_CASE_FIELDS) },
  });
  return updated;
}

export async function getCaseRelationships(actor, caseId) {
  assertRole(actor, ['admin', 'lawyer', 'assistant', 'client']);
  validateCaseId(caseId);
  const parameters = [caseId];
  const scope = accessScope(actor, parameters);
  const clientDetailScope = actor.role === 'client'
    ? `AND c.user_id = $${parameters.length}`
    : '';
  const result = await execute(
    `
      WITH accessible_case AS (
        SELECT lc.case_id
        FROM legal_cases lc
        WHERE lc.case_id = $1
        ${scope}
      )
      SELECT
        ac.case_id,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'client_id', c.client_id,
                'client_type', c.client_type,
                'full_name_or_org', c.full_name_or_org,
                'party_role', i.party_role,
                'is_primary', i.is_primary
              )
              ORDER BY i.is_primary DESC, c.full_name_or_org, c.client_id
            )
            FROM involves i
            JOIN clients c ON c.client_id = i.client_id
            WHERE i.case_id = ac.case_id
              ${clientDetailScope}
          ),
          '[]'::json
        ) AS clients,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'user_id', u.user_id,
                'full_name', u.full_name,
                'role', r.role_name,
                'assignment_role', assignment.assignment_role,
                'assigned_at', assignment.assigned_at,
                'is_lead', assignment.is_lead
              )
              ORDER BY assignment.is_lead DESC, u.full_name, u.user_id
            )
            FROM assigned_to assignment
            JOIN app_users u ON u.user_id = assignment.user_id
            JOIN office_memberships membership
              ON membership.user_id = assignment.user_id
              AND membership.office_id = assignment.office_id
            JOIN roles r ON r.role_id = membership.role_id
            WHERE assignment.case_id = ac.case_id
          ),
          '[]'::json
        ) AS assigned_staff
      FROM accessible_case ac
    `,
    parameters
  );

  if (!result.rowCount) throw new CaseServiceError(404, 'Case not found.');
  if (actor.role === 'client') {
    return {
      assigned_staff: result.rows[0].assigned_staff.map(
        ({ full_name, assignment_role }) => ({ full_name, assignment_role })
      ),
    };
  }

  return {
    case_id: result.rows[0].case_id,
    clients: result.rows[0].clients,
    assigned_staff: result.rows[0].assigned_staff,
  };
}

/**
 * Adds a client to a case: an existing client of the office (`client_id`), or a new one
 * (`new_client`) created and linked in one transaction.
 */
export async function linkClientToCase(actor, caseId, body) {
  assertRole(actor, ['admin']);
  validateCaseId(caseId);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    invalid('Request body must be a JSON object.');
  }
  if (Object.keys(body).some((field) => field !== 'client_id' && field !== 'new_client')) {
    invalid('Request contains unsupported fields.');
  }
  if (body.new_client !== undefined) {
    if (body.client_id !== undefined) invalid('Send either client_id or new_client, not both.');
    const fields = validateNewClient(body.new_client);
    const { link, client } = await inTransaction(async ({ query: db, raw }) => {
      const parameters = [caseId];
      const officeClause = officeCondition(actor, parameters, 'lc');
      const found = await db(`SELECT lc.case_id FROM legal_cases lc WHERE lc.case_id = $1 AND ${officeClause} FOR SHARE`, parameters);
      if (!found.rowCount) throw new CaseServiceError(404, 'Case or client not found.');
      const created = await insertClient(raw, actor, fields);
      const linked = await db(
        `INSERT INTO involves (client_id, case_id, office_id) VALUES ($1, $2, $3)
         RETURNING client_id, case_id, party_role, is_primary`,
        [created.client_id, caseId, actor.office_id]
      );
      return { link: linked.rows[0], client: created };
    });
    auditClientCreated(actor, client);
    return { ...link, client: { client_id: client.client_id, full_name_or_org: client.full_name_or_org } };
  }
  if (typeof body.client_id !== 'string' || !UUID_PATTERN.test(body.client_id)) {
    invalid('client_id must be a valid UUID.');
  }

  const parameters = [body.client_id, caseId];
  const officeClause = officeCondition(actor, parameters, 'c');
  const result = await execute(
    `
      INSERT INTO involves (client_id, case_id, office_id)
      SELECT c.client_id, lc.case_id, c.office_id
      FROM clients c
      JOIN legal_cases lc ON lc.case_id = $2 AND lc.office_id = c.office_id
      WHERE c.client_id = $1
        AND ${officeClause}
      RETURNING client_id, case_id, party_role, is_primary
    `,
    parameters
  );
  if (!result.rowCount) {
    throw new CaseServiceError(404, 'Case or client not found.');
  }
  return result.rows[0];
}

/** Raised when removing a lawyer would leave the case with none. */
function lastLawyer() {
  const error = new CaseServiceError(409, 'A case must keep at least one assigned lawyer.');
  error.publicCode = 'LAST_LAWYER';
  return error;
}

/**
 * Takes a staff member off a case. The case always keeps one lawyer: the last one cannot be
 * removed, and when the lead lawyer leaves, the longest-serving remaining lawyer becomes lead.
 */
export async function removeStaffFromCase(actor, caseId, userId) {
  assertRole(actor, ['admin']);
  validateCaseId(caseId);
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) invalid('userId must be a valid UUID.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Locking the case serializes concurrent removals, so two lawyers cannot both be removed at once.
    const parameters = [caseId];
    const officeClause = officeCondition(actor, parameters, 'lc');
    const caseRow = await client.query(
      `SELECT lc.case_id, lc.office_id FROM legal_cases lc WHERE lc.case_id = $1 AND ${officeClause} FOR UPDATE`,
      parameters
    );
    if (!caseRow.rowCount) throw new CaseServiceError(404, 'Case not found.');
    const { office_id: officeId } = caseRow.rows[0];

    const staff = await client.query(
      `SELECT assignment.user_id, assignment.assignment_role, assignment.is_lead, u.full_name
         FROM assigned_to assignment
         JOIN app_users u ON u.user_id = assignment.user_id
        WHERE assignment.case_id = $1 AND assignment.office_id = $2
        ORDER BY assignment.assigned_at, assignment.user_id`,
      [caseId, officeId]
    );
    const target = staff.rows.find((row) => row.user_id === userId);
    if (!target) throw new CaseServiceError(404, 'Assigned staff member not found.');
    // Lawyers include the lead (assignment role 'lead_lawyer' or flagged is_lead); only assistants are not.
    const isLawyer = (row) => row.is_lead || row.assignment_role !== 'assistant';
    const lawyers = staff.rows.filter(isLawyer);
    if (isLawyer(target) && lawyers.length <= 1) throw lastLawyer();

    await client.query('DELETE FROM assigned_to WHERE case_id = $1 AND user_id = $2 AND office_id = $3', [caseId, userId, officeId]);
    let newLead = null;
    if (target.is_lead) {
      newLead = lawyers.find((row) => row.user_id !== userId) ?? null;
      if (newLead) {
        await client.query('UPDATE assigned_to SET is_lead = TRUE WHERE case_id = $1 AND user_id = $2 AND office_id = $3', [caseId, newLead.user_id, officeId]);
      }
    }
    await client.query('COMMIT');

    auditLater(actor, {
      action: 'case_staff_removed',
      entityType: 'case',
      entityId: caseId,
      details: { values: { full_name: target.full_name, assignment_role: target.assignment_role, ...(newLead ? { new_lead: newLead.full_name } : {}) } },
    });
    return { user_id: userId, case_id: caseId, new_lead_user_id: newLead?.user_id ?? null };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function assignStaffToCase(actor, caseId, body) {
  assertRole(actor, ['admin']);
  validateCaseId(caseId);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    invalid('Request body must be a JSON object.');
  }
  if (Object.keys(body).some((field) => field !== 'user_id')) {
    invalid('Request contains unsupported fields.');
  }
  if (typeof body.user_id !== 'string' || !UUID_PATTERN.test(body.user_id)) {
    invalid('user_id must be a valid UUID.');
  }

  const parameters = [body.user_id, caseId];
  const officeClause = officeCondition(actor, parameters, 'lc');
  const result = await execute(
    `
      INSERT INTO assigned_to (user_id, case_id, assignment_role, office_id)
      SELECT u.user_id, lc.case_id, r.role_name, lc.office_id
      FROM app_users u
      JOIN legal_cases lc ON lc.case_id = $2
      JOIN office_memberships membership
        ON membership.user_id = u.user_id
        AND membership.office_id = lc.office_id
        AND membership.status = 'active'
      JOIN roles r ON r.role_id = membership.role_id
      LEFT JOIN lawyer_profiles lp ON lp.user_id = u.user_id
      WHERE u.user_id = $1
        AND ${officeClause}
        AND u.status = 'active'
        AND (
          r.role_name = 'assistant'
          OR (
            r.role_name = 'lawyer'
            AND lp.license_status = 'active'
          )
        )
      RETURNING user_id, case_id, assignment_role, assigned_at, is_lead
    `,
    parameters
  );
  if (!result.rowCount) {
    throw new CaseServiceError(404, 'Case or eligible staff member not found.');
  }
  return result.rows[0];
}
