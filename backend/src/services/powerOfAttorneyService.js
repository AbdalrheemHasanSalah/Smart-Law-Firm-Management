import { query } from '../config/db.js';
import { auditLater, diffValues, pickValues } from './auditService.js';
import { officeCondition } from './officeScope.js';
import { createFileStore, RECEIPT_TYPES } from './receiptStorage.js';

/**
 * Powers of attorney (التوكيلات): the authority a client gives the office's lawyers.
 *
 *   one client · one or more authorized lawyers · zero or more of that client's cases
 *
 * Its state is derived, never stored stale: "revoked" when the office revoked it, "expired" once
 * its expiry date has passed, otherwise "active". Who sees what follows the rest of the office:
 *
 *   admin               every power of attorney of the office
 *   lawyer, assistant   those naming them, and those of the clients of the cases assigned to them
 *   client              their own, read only
 *
 * Assistants record and update powers of attorney but cannot revoke or reactivate one.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = ['general', 'special', 'litigation'];
const STATES = ['active', 'expired', 'revoked', 'expiring'];
const STAFF = ['admin', 'lawyer', 'assistant'];
const READERS = [...STAFF, 'client'];
const MAX_LAWYERS = 20;
const MAX_CASES = 50;
/** Days before expiry from which a power of attorney counts as expiring. */
export const EXPIRING_WITHIN_DAYS = 30;
const AUDITED_FIELDS = ['poa_number', 'poa_type', 'issuing_authority', 'issued_on', 'expires_on', 'scope', 'status'];

const scans = createFileStore({ folder: 'powers-of-attorney', noun: 'scan' });

export class PowerOfAttorneyServiceError extends Error {
  constructor(status, message, publicCode) {
    super(message);
    this.name = 'PowerOfAttorneyServiceError';
    this.status = status;
    if (publicCode) this.publicCode = publicCode;
  }
}

const invalid = (message) => {
  throw new PowerOfAttorneyServiceError(400, message, 'VALIDATION');
};
const notFound = () => {
  throw new PowerOfAttorneyServiceError(404, 'Power of attorney not found.', 'NOT_FOUND');
};
const forbidden = () => {
  throw new PowerOfAttorneyServiceError(403, 'You do not have permission to access this resource.', 'FORBIDDEN');
};

function assertActor(actor, roles) {
  if (!actor || !roles.includes(actor.role) || typeof actor.user_id !== 'string' || !UUID_PATTERN.test(actor.user_id)) {
    forbidden();
  }
}

function assertBody(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Request body must be a JSON object.');
  if (Object.keys(body).some((field) => !allowed.includes(field))) invalid('Request contains unsupported fields.');
}

const uuid = (value, field) => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) invalid(`${field} must be a valid UUID.`);
  return value;
};

function text(value, field, max, { required = false } = {}) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    if (required) invalid(`${field} is required.`);
    return null;
  }
  if (typeof value !== 'string' || value.trim().length > max) invalid(`${field} must contain at most ${max} characters.`);
  return value.trim();
}

function date(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) invalid(`${field} is required.`);
    return null;
  }
  if (typeof value !== 'string' || !DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    invalid(`${field} must be a date (YYYY-MM-DD).`);
  }
  return value;
}

function uuidList(value, field, { min = 0, max }) {
  if (!Array.isArray(value)) invalid(`${field} must be a list.`);
  const unique = [...new Set(value.map((entry) => uuid(entry, field)))];
  if (unique.length < min) invalid(`${field} must contain at least ${min} item${min === 1 ? '' : 's'}.`);
  if (unique.length > max) invalid(`${field} may contain at most ${max} items.`);
  return unique;
}

function positiveInteger(value, fallback, field) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    invalid(`${field} must be a positive integer.`);
  }
  return Number(value);
}

// PostgreSQL refuses values a statement never uses, so only the used ones are sent.
function usedParameters(sql, parameters) {
  const highest = Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])));
  return parameters.slice(0, highest);
}

async function execute(sql, parameters) {
  try {
    return await query(sql, usedParameters(sql, parameters));
  } catch (error) {
    if (error?.code === '23505') {
      throw new PowerOfAttorneyServiceError(409, 'A power of attorney with this number already exists in the office.', 'POA_NUMBER_TAKEN');
    }
    if (['23502', '23503', '23514', '22001', '22007', '22008', '22P02'].includes(error?.code)) {
      invalid('Power of attorney data violates a database constraint.');
    }
    throw error;
  }
}

/**
 * The SQL that limits rows of `powers_of_attorney ${alias}` to what the actor may read. It pushes
 * the office (always) and, outside the administrator, the actor's user ID.
 */
function readScope(actor, parameters, alias = 'p') {
  const office = officeCondition(actor, parameters, alias);
  if (actor.role === 'admin') return office;
  parameters.push(actor.user_id);
  const me = `$${parameters.length}`;
  if (actor.role === 'client') {
    return `${office} AND ${alias}.client_id IN (
      SELECT own.client_id FROM clients own WHERE own.user_id = ${me} AND own.office_id = ${alias}.office_id)`;
  }
  return `${office} AND (
    EXISTS (SELECT 1 FROM power_of_attorney_lawyers named
             WHERE named.poa_id = ${alias}.poa_id AND named.user_id = ${me})
    OR EXISTS (SELECT 1 FROM involves party
                 JOIN assigned_to mine ON mine.case_id = party.case_id AND mine.user_id = ${me}
                WHERE party.client_id = ${alias}.client_id AND party.office_id = ${alias}.office_id))`;
}

const SELECT_POWER = (alias = 'p') => `
  SELECT ${alias}.poa_id, ${alias}.poa_number, ${alias}.poa_type, ${alias}.issuing_authority,
         to_char(${alias}.issued_on, 'YYYY-MM-DD') AS issued_on,
         to_char(${alias}.expires_on, 'YYYY-MM-DD') AS expires_on,
         ${alias}.scope, ${alias}.status, ${alias}.revoked_at, ${alias}.created_at, ${alias}.updated_at,
         ${alias}.client_id, client.full_name_or_org AS client_name,
         (${alias}.scan_key IS NOT NULL) AS has_scan,
         CASE WHEN ${alias}.status = 'revoked' THEN 'revoked'
              WHEN ${alias}.expires_on IS NOT NULL AND ${alias}.expires_on < CURRENT_DATE THEN 'expired'
              ELSE 'active' END AS state,
         CASE WHEN ${alias}.expires_on IS NULL THEN NULL ELSE (${alias}.expires_on - CURRENT_DATE) END AS days_left,
         COALESCE((SELECT json_agg(json_build_object('user_id', u.user_id, 'full_name', u.full_name) ORDER BY u.full_name)
                     FROM power_of_attorney_lawyers named JOIN app_users u ON u.user_id = named.user_id
                    WHERE named.poa_id = ${alias}.poa_id), '[]'::json) AS lawyers,
         COALESCE((SELECT json_agg(json_build_object('case_id', lc.case_id, 'case_number', lc.case_number, 'title', lc.title) ORDER BY lc.case_number)
                     FROM power_of_attorney_cases covered JOIN legal_cases lc ON lc.case_id = covered.case_id
                    WHERE covered.poa_id = ${alias}.poa_id), '[]'::json) AS cases
    FROM powers_of_attorney ${alias}
    JOIN clients client ON client.client_id = ${alias}.client_id AND client.office_id = ${alias}.office_id`;

const publicPower = (row) => ({
  poa_id: row.poa_id,
  poa_number: row.poa_number,
  poa_type: row.poa_type,
  issuing_authority: row.issuing_authority,
  issued_on: row.issued_on,
  expires_on: row.expires_on,
  scope: row.scope,
  status: row.status,
  state: row.state,
  days_left: row.days_left === null || row.days_left === undefined ? null : Number(row.days_left),
  expiring: row.state === 'active' && row.days_left !== null && row.days_left !== undefined
    && Number(row.days_left) <= EXPIRING_WITHIN_DAYS,
  revoked_at: row.revoked_at,
  has_scan: Boolean(row.has_scan),
  client_id: row.client_id,
  client_name: row.client_name,
  lawyers: Array.isArray(row.lawyers) ? row.lawyers : [],
  cases: Array.isArray(row.cases) ? row.cases : [],
  created_at: row.created_at,
  updated_at: row.updated_at,
});

function parseListOptions(parameters = {}) {
  const allowed = ['page', 'pageSize', 'clientId', 'caseId', 'state', 'search'];
  if (!parameters || typeof parameters !== 'object' || Object.keys(parameters).some((key) => !allowed.includes(key))) {
    invalid('Unsupported power-of-attorney query parameter.');
  }
  const page = positiveInteger(parameters.page, 1, 'page');
  const pageSize = Math.min(positiveInteger(parameters.pageSize, 25, 'pageSize'), 50);
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) invalid('page is too large.');
  const clientId = parameters.clientId === undefined ? undefined : uuid(parameters.clientId, 'clientId');
  const caseId = parameters.caseId === undefined ? undefined : uuid(parameters.caseId, 'caseId');
  if (parameters.state !== undefined && !STATES.includes(parameters.state)) invalid('state is not supported.');
  const search = parameters.search === undefined ? '' : text(parameters.search, 'search', 100) ?? '';
  return { page, pageSize, offset, clientId, caseId, state: parameters.state, search };
}

const STATE_FILTERS = {
  active: `p.status = 'active' AND (p.expires_on IS NULL OR p.expires_on >= CURRENT_DATE)`,
  expired: `p.status = 'active' AND p.expires_on < CURRENT_DATE`,
  revoked: `p.status = 'revoked'`,
  expiring: `p.status = 'active' AND p.expires_on >= CURRENT_DATE AND p.expires_on <= CURRENT_DATE + ${EXPIRING_WITHIN_DAYS}`,
};

export async function listPowersOfAttorney(actor, queryParameters) {
  assertActor(actor, READERS);
  const { page, pageSize, offset, clientId, caseId, state, search } = parseListOptions(queryParameters);
  const parameters = [];
  let filters = readScope(actor, parameters);
  if (clientId) {
    parameters.push(clientId);
    filters += ` AND p.client_id = $${parameters.length}`;
  }
  if (caseId) {
    parameters.push(caseId);
    filters += ` AND EXISTS (SELECT 1 FROM power_of_attorney_cases covered
                               WHERE covered.poa_id = p.poa_id AND covered.case_id = $${parameters.length})`;
  }
  if (state) filters += ` AND ${STATE_FILTERS[state]}`;
  if (search) {
    parameters.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
    filters += ` AND (p.poa_number ILIKE $${parameters.length} ESCAPE E'\\\\'
                  OR p.issuing_authority ILIKE $${parameters.length} ESCAPE E'\\\\')`;
  }
  const count = await execute(`SELECT COUNT(*)::int AS total FROM powers_of_attorney p WHERE ${filters}`, parameters);
  const total = count.rows[0]?.total ?? 0;
  const pageParameters = [...parameters, pageSize, offset];
  const result = await execute(
    `${SELECT_POWER()}
      WHERE ${filters}
      ORDER BY (p.status = 'revoked'), p.expires_on ASC NULLS LAST, p.created_at DESC, p.poa_id
      LIMIT $${pageParameters.length - 1} OFFSET $${pageParameters.length}`,
    pageParameters
  );
  return {
    powers_of_attorney: result.rows.map(publicPower),
    pagination: { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) },
  };
}

async function findPower(actor, poaId) {
  uuid(poaId, 'poaId');
  const parameters = [poaId];
  const scope = readScope(actor, parameters);
  const result = await execute(`${SELECT_POWER()} WHERE p.poa_id = $1 AND ${scope} LIMIT 1`, parameters);
  if (!result.rowCount) notFound();
  return result.rows[0];
}

export async function getPowerOfAttorney(actor, poaId) {
  assertActor(actor, READERS);
  return publicPower(await findPower(actor, poaId));
}

/**
 * Checks, in one query, that the client belongs to the office (and, for a lawyer or assistant, is
 * a client of one of their cases), that every lawyer is an active lawyer or administrator of the
 * office, and that every case is the client's own (and, for a lawyer or assistant, assigned to them).
 */
async function assertRelated(actor, clientId, lawyerIds, caseIds) {
  const parameters = [clientId, lawyerIds ?? [], caseIds ?? []];
  const office = officeCondition(actor, parameters, 'c');
  let mine = '';
  let mineCase = '';
  if (actor.role !== 'admin') {
    parameters.push(actor.user_id);
    const me = `$${parameters.length}`;
    mine = `AND EXISTS (SELECT 1 FROM involves party JOIN assigned_to mine ON mine.case_id = party.case_id AND mine.user_id = ${me}
                         WHERE party.client_id = c.client_id AND party.office_id = c.office_id)`;
    mineCase = `AND EXISTS (SELECT 1 FROM assigned_to mine WHERE mine.case_id = lc.case_id AND mine.user_id = ${me})`;
  }
  const result = await execute(
    `SELECT c.client_id,
            (SELECT COUNT(*)::int FROM office_memberships m JOIN roles r ON r.role_id = m.role_id
              WHERE m.office_id = c.office_id AND m.status = 'active'
                AND r.role_name IN ('admin', 'lawyer') AND m.user_id = ANY($2::uuid[])) AS lawyers,
            (SELECT COUNT(*)::int FROM legal_cases lc
               JOIN involves party ON party.case_id = lc.case_id AND party.client_id = c.client_id
              WHERE lc.office_id = c.office_id AND lc.case_id = ANY($3::uuid[]) ${mineCase}) AS cases
       FROM clients c
      WHERE c.client_id = $1 AND ${office} ${mine}
      LIMIT 1`,
    parameters
  );
  if (!result.rowCount) throw new PowerOfAttorneyServiceError(404, 'Client not found.', 'NOT_FOUND');
  const { lawyers, cases } = result.rows[0];
  if (lawyerIds && lawyers !== lawyerIds.length) invalid('Every authorized lawyer must be an active lawyer of the office.');
  if (caseIds && cases !== caseIds.length) invalid("Every case must be one of this client's cases that you work on.");
}

function parseFields(body, { creating }) {
  const fields = {};
  if (creating || Object.hasOwn(body, 'poa_number')) fields.poa_number = text(body.poa_number, 'poa_number', 60, { required: true });
  if (creating || Object.hasOwn(body, 'poa_type')) {
    if (!TYPES.includes(body.poa_type)) invalid('poa_type must be general, special or litigation.');
    fields.poa_type = body.poa_type;
  }
  if (Object.hasOwn(body, 'issuing_authority')) fields.issuing_authority = text(body.issuing_authority, 'issuing_authority', 200);
  if (creating || Object.hasOwn(body, 'issued_on')) fields.issued_on = date(body.issued_on, 'issued_on', { required: true });
  if (Object.hasOwn(body, 'expires_on')) fields.expires_on = date(body.expires_on, 'expires_on');
  if (Object.hasOwn(body, 'scope')) fields.scope = text(body.scope, 'scope', 4000);
  if (fields.issued_on && fields.expires_on && fields.expires_on < fields.issued_on) {
    invalid('expires_on must not be before issued_on.');
  }
  return fields;
}

const CREATE_FIELDS = ['client_id', 'poa_number', 'poa_type', 'issuing_authority', 'issued_on', 'expires_on', 'scope', 'lawyer_ids', 'case_ids'];

export async function createPowerOfAttorney(actor, body) {
  assertActor(actor, STAFF);
  assertBody(body, CREATE_FIELDS);
  const clientId = uuid(body.client_id, 'client_id');
  const fields = parseFields(body, { creating: true });
  const lawyerIds = uuidList(body.lawyer_ids, 'lawyer_ids', { min: 1, max: MAX_LAWYERS });
  const caseIds = body.case_ids === undefined ? [] : uuidList(body.case_ids, 'case_ids', { max: MAX_CASES });
  await assertRelated(actor, clientId, lawyerIds, caseIds);

  const parameters = [
    fields.poa_number, fields.poa_type, fields.issuing_authority ?? null, fields.issued_on,
    fields.expires_on ?? null, fields.scope ?? null, clientId, actor.user_id, lawyerIds, caseIds,
  ];
  const office = officeCondition(actor, parameters, 'c');
  // One statement, so the power of attorney never exists without its lawyers and cases.
  const result = await execute(
    `WITH created AS (
       INSERT INTO powers_of_attorney
         (poa_number, poa_type, issuing_authority, issued_on, expires_on, scope, client_id, created_by_user_id, office_id)
       SELECT $1, $2, $3, $4::date, $5::date, $6, c.client_id, $8, c.office_id
         FROM clients c WHERE c.client_id = $7 AND ${office}
       RETURNING poa_id, office_id
     ), lawyers AS (
       INSERT INTO power_of_attorney_lawyers (poa_id, user_id, office_id)
       SELECT created.poa_id, lawyer, created.office_id FROM created, unnest($9::uuid[]) AS lawyer
     ), cases AS (
       INSERT INTO power_of_attorney_cases (poa_id, case_id, office_id)
       SELECT created.poa_id, covered, created.office_id FROM created, unnest($10::uuid[]) AS covered
     )
     SELECT poa_id FROM created`,
    parameters
  );
  if (!result.rowCount) throw new PowerOfAttorneyServiceError(404, 'Client not found.', 'NOT_FOUND');
  const poaId = result.rows[0].poa_id;
  const power = publicPower(await findPower(actor, poaId));
  auditLater(actor, {
    action: 'poa_created',
    entityType: 'power_of_attorney',
    entityId: poaId,
    details: { subject: power.poa_number, client_id: clientId, values: pickValues(power, AUDITED_FIELDS) },
  });
  return power;
}

const UPDATE_FIELDS = ['poa_number', 'poa_type', 'issuing_authority', 'issued_on', 'expires_on', 'scope', 'status', 'lawyer_ids', 'case_ids'];

export async function updatePowerOfAttorney(actor, poaId, body) {
  assertActor(actor, STAFF);
  uuid(poaId, 'poaId');
  assertBody(body, UPDATE_FIELDS);
  if (Object.keys(body).length === 0) invalid('At least one permitted field is required.');
  if (Object.hasOwn(body, 'status')) {
    if (!['active', 'revoked'].includes(body.status)) invalid('status must be active or revoked.');
    if (actor.role === 'assistant') forbidden();
  }
  const fields = parseFields(body, { creating: false });
  const lawyerIds = Object.hasOwn(body, 'lawyer_ids') ? uuidList(body.lawyer_ids, 'lawyer_ids', { min: 1, max: MAX_LAWYERS }) : null;
  const caseIds = Object.hasOwn(body, 'case_ids') ? uuidList(body.case_ids, 'case_ids', { max: MAX_CASES }) : null;

  const before = await findPower(actor, poaId);
  const issuedOn = fields.issued_on ?? before.issued_on;
  const expiresOn = Object.hasOwn(fields, 'expires_on') ? fields.expires_on : before.expires_on;
  if (expiresOn && issuedOn && expiresOn < issuedOn) invalid('expires_on must not be before issued_on.');
  if (lawyerIds || caseIds) {
    // A lawyer may keep cases they do not work on that someone else linked: only additions are checked.
    const added = caseIds ? caseIds.filter((id) => !before.cases.some((entry) => entry.case_id === id)) : null;
    await assertRelated(actor, before.client_id, lawyerIds, added);
  }

  const entries = Object.entries(fields);
  const parameters = entries.map(([, value]) => value);
  const assignments = entries.map(([field], index) => `${field} = $${index + 1}${field.endsWith('_on') ? '::date' : ''}`);
  if (Object.hasOwn(body, 'status')) {
    parameters.push(body.status);
    assignments.push(`status = $${parameters.length}`,
      `revoked_at = CASE WHEN $${parameters.length} = 'revoked' THEN COALESCE(p.revoked_at, NOW()) ELSE NULL END`);
  }
  assignments.push('updated_at = NOW()');
  parameters.push(poaId);
  const idParameter = `$${parameters.length}`;
  const office = officeCondition(actor, parameters, 'p');
  parameters.push(lawyerIds ?? [], caseIds ?? []);
  const lawyersParameter = `$${parameters.length - 1}`;
  const casesParameter = `$${parameters.length}`;
  const result = await execute(
    `WITH updated AS (
       UPDATE powers_of_attorney AS p SET ${assignments.join(', ')}
        WHERE p.poa_id = ${idParameter} AND ${office}
       RETURNING p.poa_id, p.office_id
     )${lawyerIds ? `, dropped_lawyers AS (
       DELETE FROM power_of_attorney_lawyers named USING updated
        WHERE named.poa_id = updated.poa_id AND NOT (named.user_id = ANY(${lawyersParameter}::uuid[]))
     ), added_lawyers AS (
       INSERT INTO power_of_attorney_lawyers (poa_id, user_id, office_id)
       SELECT updated.poa_id, lawyer, updated.office_id FROM updated, unnest(${lawyersParameter}::uuid[]) AS lawyer
       ON CONFLICT DO NOTHING
     )` : ''}${caseIds ? `, dropped_cases AS (
       DELETE FROM power_of_attorney_cases covered USING updated
        WHERE covered.poa_id = updated.poa_id AND NOT (covered.case_id = ANY(${casesParameter}::uuid[]))
     ), added_cases AS (
       INSERT INTO power_of_attorney_cases (poa_id, case_id, office_id)
       SELECT updated.poa_id, covered, updated.office_id FROM updated, unnest(${casesParameter}::uuid[]) AS covered
       ON CONFLICT DO NOTHING
     )` : ''}
     SELECT poa_id FROM updated`,
    parameters
  );
  if (!result.rowCount) notFound();
  const after = publicPower(await findPower(actor, poaId));
  const changes = diffValues(publicPower(before), after, AUDITED_FIELDS);
  if (lawyerIds) changes.lawyers = { from: before.lawyers.map((entry) => entry.full_name), to: after.lawyers.map((entry) => entry.full_name) };
  if (caseIds) changes.cases = { from: before.cases.map((entry) => entry.case_number), to: after.cases.map((entry) => entry.case_number) };
  for (const field of ['lawyers', 'cases']) {
    if (changes[field] && JSON.stringify(changes[field].from) === JSON.stringify(changes[field].to)) delete changes[field];
  }
  auditLater(actor, {
    action: body.status === 'revoked' && before.status !== 'revoked' ? 'poa_revoked' : 'poa_updated',
    entityType: 'power_of_attorney',
    entityId: poaId,
    details: { subject: after.poa_number, client_id: after.client_id, changes },
  });
  return after;
}

/** Attaches (or replaces) the scan: a PDF, PNG or JPG of at most 5 MB. */
export async function attachPowerOfAttorneyScan(actor, poaId, request) {
  assertActor(actor, STAFF);
  uuid(poaId, 'poaId');
  const declared = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (!RECEIPT_TYPES.has(declared)) {
    throw new PowerOfAttorneyServiceError(415, 'The scan must be a PDF, PNG or JPG file.', 'VALIDATION');
  }
  await findPower(actor, poaId);
  const buffer = await scans.readBody(request);
  const key = await scans.save(buffer);
  const parameters = [key, poaId];
  const office = officeCondition(actor, parameters, 'p');
  let previous;
  try {
    const result = await execute(
      `UPDATE powers_of_attorney AS p SET scan_key = $1, updated_at = NOW()
         FROM powers_of_attorney old
        WHERE p.poa_id = $2 AND old.poa_id = p.poa_id AND ${office}
       RETURNING old.scan_key AS previous_key`,
      parameters
    );
    if (!result.rowCount) notFound();
    previous = result.rows[0].previous_key;
  } catch (error) {
    await scans.remove(key);
    throw error;
  }
  if (previous) await scans.remove(previous);
  auditLater(actor, {
    action: 'poa_scan_attached',
    entityType: 'power_of_attorney',
    entityId: poaId,
    details: {},
  });
  return { poa_id: poaId, has_scan: true };
}

export async function readPowerOfAttorneyScan(actor, poaId) {
  assertActor(actor, READERS);
  uuid(poaId, 'poaId');
  const parameters = [poaId];
  const scope = readScope(actor, parameters);
  const result = await execute(
    `SELECT p.scan_key, p.poa_number FROM powers_of_attorney p WHERE p.poa_id = $1 AND ${scope} LIMIT 1`,
    parameters
  );
  if (!result.rows[0]?.scan_key) throw new PowerOfAttorneyServiceError(404, 'Scan not found.', 'NOT_FOUND');
  return scans.read(result.rows[0].scan_key);
}

/** The people a power of attorney can name: the office's active lawyers and administrators. */
export async function listAuthorizableLawyers(actor) {
  assertActor(actor, STAFF);
  const parameters = [];
  const office = officeCondition(actor, parameters, 'm');
  const result = await execute(
    `SELECT u.user_id, u.full_name, r.role_name AS role
       FROM office_memberships m
       JOIN roles r ON r.role_id = m.role_id AND r.role_name IN ('admin', 'lawyer')
       JOIN app_users u ON u.user_id = m.user_id AND u.status = 'active'
      WHERE ${office} AND m.status = 'active'
      ORDER BY u.full_name, u.user_id`,
    parameters
  );
  return { lawyers: result.rows.map(({ user_id, full_name, role }) => ({ user_id, full_name, role })) };
}
