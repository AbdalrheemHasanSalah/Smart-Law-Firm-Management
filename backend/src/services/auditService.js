import { query } from '../config/db.js';
import { officeCondition } from './officeScope.js';

/**
 * The office activity log: who added or changed what, when, and the values before and after.
 * Rows go into the existing audit_logs table; `details` holds { changes: { field: { from, to } } }
 * for an update, or { values: {...} } for something added or removed.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 25;
const ENTITY_TYPES = new Set(['case', 'client', 'task', 'opponent', 'invoice', 'office', 'invitation', 'membership', 'subscription']);

export class AuditServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AuditServiceError';
    this.status = status;
  }
}

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Dates compare as ISO strings: row_to_json writes "+00:00" where the API writes "Z". */
const comparable = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && TIMESTAMP_PATTERN.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return value ?? null;
};

/** The fields whose value differs between two snapshots of a row, limited to `fields`. */
export function diffValues(before, after, fields) {
  const changes = {};
  if (!before || !after) return changes;
  for (const field of fields) {
    if (!Object.hasOwn(after, field)) continue;
    const from = comparable(before[field]);
    const to = comparable(after[field]);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[field] = { from, to };
  }
  return changes;
}

/** A snapshot of the listed fields, for something added or removed. */
export function pickValues(row, fields) {
  return Object.fromEntries(fields.filter((field) => row && Object.hasOwn(row, field)).map((field) => [field, comparable(row[field])]));
}

export async function recordAudit(actor, { action, entityType, entityId, details }, run = query) {
  if (!actor?.office_id || !actor?.user_id) return;
  await run(
    `INSERT INTO audit_logs (action, entity_type, entity_id, details, user_id, office_id)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [action, entityType, entityId ?? null, JSON.stringify(details ?? {}), actor.user_id, actor.office_id]
  );
}

/**
 * Fire-and-forget, after the request has been answered, like notifications. An update that
 * changed nothing is not logged. Unit tests of other features do not expect the extra query,
 * so it stays off under NODE_ENV=test unless AUDIT_IN_TESTS is set.
 */
export function auditLater(actor, entry) {
  if (process.env.NODE_ENV === 'test' && process.env.AUDIT_IN_TESTS !== 'true') return;
  if (entry.details?.changes && Object.keys(entry.details.changes).length === 0) return;
  setImmediate(() => {
    recordAudit(actor, entry).catch((error) => {
      console.error('Audit entry could not be recorded.', { action: entry.action, name: error?.name ?? 'Error' });
    });
  });
}

function parsePositiveInteger(value, fallback, field) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new AuditServiceError(400, `${field} must be a positive integer.`);
  }
  return Number(value);
}

/** The office's activity log, newest first. Office administrators only. */
export async function listAuditLog(actor, queryParameters = {}) {
  if (!actor || actor.role !== 'admin' || typeof actor.user_id !== 'string' || !UUID_PATTERN.test(actor.user_id)) {
    throw new AuditServiceError(403, 'You do not have permission to access this resource.');
  }
  const page = parsePositiveInteger(queryParameters.page, 1, 'page');
  const pageSize = Math.min(parsePositiveInteger(queryParameters.pageSize, DEFAULT_PAGE_SIZE, 'pageSize'), MAX_PAGE_SIZE);
  const entityType = queryParameters.entity_type;
  if (entityType !== undefined && !ENTITY_TYPES.has(entityType)) {
    throw new AuditServiceError(400, 'entity_type is not supported.');
  }

  const parameters = [];
  const conditions = [officeCondition(actor, parameters, 'log')];
  if (entityType) {
    parameters.push(entityType);
    conditions.push(`log.entity_type = $${parameters.length}`);
  }
  const where = conditions.join(' AND ');

  const total = await query(`SELECT COUNT(*)::int AS total FROM audit_logs log WHERE ${where}`, parameters);
  parameters.push(pageSize, (page - 1) * pageSize);
  const rows = await query(
    `SELECT log.audit_log_id, log.action, log.entity_type, log.entity_id, log.details, log.created_at,
            u.full_name AS user_name
       FROM audit_logs log
       LEFT JOIN app_users u ON u.user_id = log.user_id
      WHERE ${where}
      ORDER BY log.created_at DESC, log.audit_log_id
      LIMIT $${parameters.length - 1} OFFSET $${parameters.length}`,
    parameters
  );
  const count = total.rows[0]?.total ?? 0;
  return {
    entries: rows.rows,
    pagination: { page, pageSize, total: count, totalPages: Math.ceil(count / pageSize) },
  };
}
