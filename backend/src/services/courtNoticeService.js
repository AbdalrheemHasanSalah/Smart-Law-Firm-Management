import { query } from '../config/db.js';
import { auditLater } from './auditService.js';
import { officeCondition } from './officeScope.js';
import { createFileStore, RECEIPT_TYPES } from './receiptStorage.js';

/**
 * Court notices (أوراق المحضرين): the papers the office sends through a bailiff — notifications,
 * summonses, service of judgments, execution papers — and whether they reached the other side.
 *
 * The administrator sees and records them for the whole office; a lawyer or assistant for the
 * cases assigned to them. A copy of the paper (PDF or image) may be attached.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STAFF = ['admin', 'lawyer', 'assistant'];
const TYPES = ['notification', 'summons', 'judgment_service', 'execution'];
const STATUSES = ['pending', 'delivered', 'returned', 'refused'];
const FIELDS = ['notice_type', 'recipient', 'bailiff_office', 'sent_on', 'delivery_status', 'delivered_on', 'notes'];

const attachments = createFileStore({ folder: 'court-notices', noun: 'attachment' });

export class CourtNoticeServiceError extends Error {
  constructor(status, message, publicCode) {
    super(message);
    this.name = 'CourtNoticeServiceError';
    this.status = status;
    if (publicCode) this.publicCode = publicCode;
  }
}

const invalid = (message) => {
  throw new CourtNoticeServiceError(400, message, 'VALIDATION');
};
const notFound = () => {
  throw new CourtNoticeServiceError(404, 'Court notice not found.', 'NOT_FOUND');
};

function assertStaff(actor) {
  if (!actor || !STAFF.includes(actor.role) || typeof actor.user_id !== 'string' || !UUID_PATTERN.test(actor.user_id)) {
    throw new CourtNoticeServiceError(403, 'You do not have permission to access this resource.', 'FORBIDDEN');
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

function date(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) invalid(`${field} is required.`);
    return null;
  }
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)
    || Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    invalid(`${field} must be a date (YYYY-MM-DD).`);
  }
  return value;
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
    if (['23502', '23503', '23514', '22001', '22007', '22008', '22P02'].includes(error?.code)) {
      invalid('Court notice data violates a database constraint.');
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

const COLUMNS = `
  n.notice_id, n.notice_type, n.recipient, n.bailiff_office,
  to_char(n.sent_on, 'YYYY-MM-DD') AS sent_on, n.delivery_status,
  to_char(n.delivered_on, 'YYYY-MM-DD') AS delivered_on, n.notes,
  (n.attachment_key IS NOT NULL) AS has_attachment, n.created_at, n.updated_at,
  n.case_id, lc.case_number, lc.title AS case_title, creator.full_name AS created_by_name`;
const FROM = `
  FROM court_notices n
  JOIN legal_cases lc ON lc.case_id = n.case_id AND lc.office_id = n.office_id
  JOIN app_users creator ON creator.user_id = n.created_by_user_id`;

const publicNotice = (row) => ({ ...row, has_attachment: Boolean(row.has_attachment) });

/**
 * Checks the fields of a notice; `current` holds the stored values on an update, so the delivery
 * rules are checked against the notice as it will be after the change.
 */
function parseFields(body, current = null) {
  const fields = {};
  if (!current || Object.hasOwn(body, 'notice_type')) {
    if (!TYPES.includes(body.notice_type)) invalid('notice_type is not supported.');
    fields.notice_type = body.notice_type;
  }
  if (Object.hasOwn(body, 'recipient')) fields.recipient = text(body.recipient, 'recipient', 200);
  if (Object.hasOwn(body, 'bailiff_office')) fields.bailiff_office = text(body.bailiff_office, 'bailiff_office', 200);
  if (!current || Object.hasOwn(body, 'sent_on')) fields.sent_on = date(body.sent_on, 'sent_on', { required: true });
  if (Object.hasOwn(body, 'delivery_status')) {
    if (!STATUSES.includes(body.delivery_status)) invalid('delivery_status is not supported.');
    fields.delivery_status = body.delivery_status;
  }
  if (Object.hasOwn(body, 'delivered_on')) fields.delivered_on = date(body.delivered_on, 'delivered_on');
  if (Object.hasOwn(body, 'notes')) fields.notes = text(body.notes, 'notes', 2000);

  const merged = { delivery_status: 'pending', delivered_on: null, ...(current ?? {}), ...fields };
  if (merged.delivery_status === 'pending') {
    if (fields.delivered_on) invalid('A pending notice has no delivery date.');
    if (current?.delivered_on) fields.delivered_on = null;
  } else if (!merged.delivered_on) {
    invalid('delivered_on is required once the notice is delivered, returned or refused.');
  }
  const sentOn = merged.sent_on;
  const deliveredOn = Object.hasOwn(fields, 'delivered_on') ? fields.delivered_on : merged.delivered_on;
  if (deliveredOn && sentOn && deliveredOn < sentOn) invalid('delivered_on must not be before sent_on.');
  return fields;
}

export async function listCourtNotices(actor, queryParameters = {}) {
  assertStaff(actor);
  const allowed = ['caseId', 'status', 'page', 'pageSize'];
  if (!queryParameters || Object.keys(queryParameters).some((key) => !allowed.includes(key))) {
    invalid('Unsupported court-notice query parameter.');
  }
  const page = positiveInteger(queryParameters.page, 1, 'page');
  const pageSize = Math.min(positiveInteger(queryParameters.pageSize, 25, 'pageSize'), 50);
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) invalid('page is too large.');
  const parameters = [];
  let filters = caseAccess(actor, parameters, 'n');
  if (queryParameters.caseId !== undefined) {
    parameters.push(uuid(queryParameters.caseId, 'caseId'));
    filters += ` AND n.case_id = $${parameters.length}`;
  }
  if (queryParameters.status !== undefined) {
    if (!STATUSES.includes(queryParameters.status)) invalid('status is not supported.');
    parameters.push(queryParameters.status);
    filters += ` AND n.delivery_status = $${parameters.length}`;
  }
  const count = await execute(`SELECT COUNT(*)::int AS total FROM court_notices n WHERE ${filters}`, parameters);
  const total = count.rows[0]?.total ?? 0;
  const pageParameters = [...parameters, pageSize, offset];
  const result = await execute(
    `SELECT ${COLUMNS} ${FROM}
      WHERE ${filters}
      ORDER BY n.sent_on DESC, n.created_at DESC, n.notice_id
      LIMIT $${pageParameters.length - 1} OFFSET $${pageParameters.length}`,
    pageParameters
  );
  return {
    court_notices: result.rows.map(publicNotice),
    pagination: { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) },
  };
}

async function findNotice(actor, noticeId, { withKey = false } = {}) {
  uuid(noticeId, 'noticeId');
  const parameters = [noticeId];
  const scope = caseAccess(actor, parameters, 'n');
  const result = await execute(
    `SELECT ${COLUMNS}${withKey ? ', n.attachment_key' : ''} ${FROM} WHERE n.notice_id = $1 AND ${scope} LIMIT 1`,
    parameters
  );
  if (!result.rowCount) notFound();
  return result.rows[0];
}

export async function createCourtNotice(actor, body) {
  assertStaff(actor);
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Request body must be a JSON object.');
  if (Object.keys(body).some((field) => field !== 'case_id' && !FIELDS.includes(field))) invalid('Request contains unsupported fields.');
  const caseId = uuid(body.case_id, 'case_id');
  const fields = parseFields(body);
  const parameters = [
    caseId, fields.notice_type, fields.recipient ?? null, fields.bailiff_office ?? null, fields.sent_on,
    fields.delivery_status ?? 'pending', fields.delivered_on ?? null, fields.notes ?? null, actor.user_id,
  ];
  const scope = caseAccess(actor, parameters, 'lc');
  const result = await execute(
    `INSERT INTO court_notices
       (case_id, notice_type, recipient, bailiff_office, sent_on, delivery_status, delivered_on, notes, created_by_user_id, office_id)
     SELECT lc.case_id, $2, $3, $4, $5::date, $6, $7::date, $8, $9, lc.office_id
       FROM legal_cases lc
      WHERE lc.case_id = $1 AND ${scope}
     RETURNING notice_id`,
    parameters
  );
  if (!result.rowCount) throw new CourtNoticeServiceError(404, 'Case not found.', 'NOT_FOUND');
  const notice = publicNotice(await findNotice(actor, result.rows[0].notice_id));
  auditLater(actor, {
    action: 'court_notice_recorded',
    entityType: 'case',
    entityId: caseId,
    details: { values: { notice_type: notice.notice_type, recipient: notice.recipient, sent_on: notice.sent_on } },
  });
  return notice;
}

export async function updateCourtNotice(actor, noticeId, body) {
  assertStaff(actor);
  uuid(noticeId, 'noticeId');
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Request body must be a JSON object.');
  if (Object.keys(body).some((field) => !FIELDS.includes(field))) invalid('Request contains unsupported fields.');
  if (Object.keys(body).length === 0) invalid('At least one permitted field is required.');
  const before = await findNotice(actor, noticeId);
  const fields = parseFields(body, before);
  const entries = Object.entries(fields);
  const parameters = entries.map(([, value]) => value);
  const sets = entries.map(([field], index) => `${field} = $${index + 1}${field.endsWith('_on') ? '::date' : ''}`);
  sets.push('updated_at = NOW()');
  parameters.push(noticeId);
  const idParameter = `$${parameters.length}`;
  const office = officeCondition(actor, parameters, 'n');
  const result = await execute(
    `UPDATE court_notices n SET ${sets.join(', ')} WHERE n.notice_id = ${idParameter} AND ${office} RETURNING n.notice_id`,
    parameters
  );
  if (!result.rowCount) notFound();
  const notice = publicNotice(await findNotice(actor, noticeId));
  auditLater(actor, {
    action: 'court_notice_updated',
    entityType: 'case',
    entityId: notice.case_id,
    details: {
      changes: Object.fromEntries(Object.keys(fields)
        .filter((field) => before[field] !== notice[field])
        .map((field) => [field, { from: before[field] ?? null, to: notice[field] ?? null }])),
    },
  });
  return notice;
}

/** Attaches (or replaces) a copy of the paper: a PDF, PNG or JPG of at most 5 MB. */
export async function attachCourtNoticeFile(actor, noticeId, request) {
  assertStaff(actor);
  uuid(noticeId, 'noticeId');
  const declared = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (!RECEIPT_TYPES.has(declared)) {
    throw new CourtNoticeServiceError(415, 'The attachment must be a PDF, PNG or JPG file.', 'VALIDATION');
  }
  await findNotice(actor, noticeId);
  const key = await attachments.save(await attachments.readBody(request));
  const parameters = [key, noticeId];
  const office = officeCondition(actor, parameters, 'n');
  let previous;
  try {
    const result = await execute(
      `UPDATE court_notices AS n SET attachment_key = $1, updated_at = NOW()
         FROM court_notices old
        WHERE n.notice_id = $2 AND old.notice_id = n.notice_id AND ${office}
       RETURNING old.attachment_key AS previous_key`,
      parameters
    );
    if (!result.rowCount) notFound();
    previous = result.rows[0].previous_key;
  } catch (error) {
    await attachments.remove(key);
    throw error;
  }
  if (previous) await attachments.remove(previous);
  return { notice_id: noticeId, has_attachment: true };
}

export async function readCourtNoticeFile(actor, noticeId) {
  assertStaff(actor);
  const notice = await findNotice(actor, noticeId, { withKey: true });
  if (!notice.attachment_key) throw new CourtNoticeServiceError(404, 'Attachment not found.', 'NOT_FOUND');
  return attachments.read(notice.attachment_key);
}
