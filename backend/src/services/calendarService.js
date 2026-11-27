import { query } from '../config/db.js';
import { auditLater } from './auditService.js';
import { officeCondition } from './officeScope.js';

/**
 * The office calendar: one dated view of what the office has to attend to.
 *
 *   hearing       court sessions of the office's cases (scheduled here)
 *   appointment   client meetings, expert sessions, court visits and other appointments
 *   notice        court notices (bailiff papers), on the day they were sent
 *   task          deadlines of tasks the office assigned (private tasks stay private)
 *   invoice       due dates of claims not yet settled
 *
 * The office administrator reads it and schedules hearings and appointments, and may narrow it
 * to one lawyer's agenda (userId).
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const MAX_RANGE_DAYS = 62;
const HEARING_STATUSES = new Set(['scheduled', 'completed', 'postponed', 'cancelled']);
const APPOINTMENT_STATUSES = new Set(['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show']);
const APPOINTMENT_TYPES = new Set(['meeting', 'expert_session', 'court_visit', 'other']);

export class CalendarServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'CalendarServiceError';
    this.status = status;
  }
}

const invalid = (message) => {
  throw new CalendarServiceError(400, message);
};

function assertAdmin(actor) {
  if (!actor || actor.role !== 'admin') {
    throw new CalendarServiceError(403, 'You do not have permission to access this resource.');
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

const timestamp = (value, field) => {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    invalid(`${field} must be an ISO timestamp.`);
  }
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

// PostgreSQL refuses values the statement never uses, and some calendar queries skip the
// trailing ones (the owner's view has no "assigned to me" filter), so only the used ones are sent.
function usedParameters(sql, parameters) {
  const highest = Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])));
  return parameters.slice(0, highest);
}

async function execute(sql, parameters) {
  try {
    return await query(sql, usedParameters(sql, parameters));
  } catch (error) {
    if (['23503', '23514', '22007', '22008', '22P02'].includes(error?.code)) {
      throw new CalendarServiceError(400, 'Calendar data violates a database constraint.');
    }
    throw error;
  }
}

/** The days to show: from and to are calendar dates, at most two months apart. */
function parseRange(parameters = {}) {
  if (!parameters || Object.keys(parameters).some((key) => !['from', 'to', 'userId'].includes(key))) {
    invalid('Unsupported calendar query parameter.');
  }
  const { from, to } = parameters;
  if (typeof from !== 'string' || !DATE_PATTERN.test(from) || typeof to !== 'string' || !DATE_PATTERN.test(to)) {
    invalid('from and to must be dates (YYYY-MM-DD).');
  }
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) invalid('to must not be before from.');
  if ((end - start) / 86_400_000 > MAX_RANGE_DAYS) invalid(`The range may cover at most ${MAX_RANGE_DAYS} days.`);
  // Inclusive of the last day; a day of margin either side covers every time zone.
  return { from: new Date(start - 86_400_000).toISOString(), to: new Date(end + 2 * 86_400_000).toISOString() };
}

const STAFF_ROLES = ['admin', 'lawyer', 'assistant'];

/** A case the actor works on: lawyers and assistants see only the cases assigned to them. */
const assignedCase = (caseColumn) =>
  `EXISTS (SELECT 1 FROM assigned_to mine WHERE mine.case_id = ${caseColumn} AND mine.user_id = $4)`;

/**
 * The administrator sees the whole office. A lawyer or assistant sees the hearings of their cases,
 * their own appointments and the tasks assigned to them; claims are the administrator's alone.
 * Private tasks appear only on their writer's calendar.
 */
export async function listCalendar(actor, queryParameters) {
  if (!actor || !STAFF_ROLES.includes(actor.role) || typeof actor.user_id !== 'string') {
    throw new CalendarServiceError(403, 'You do not have permission to access this resource.');
  }
  const range = parseRange(queryParameters);
  const parameters = [range.from, range.to];
  // Pushes the active office as $3 (and refuses a request without one); every query below filters on it.
  officeCondition(actor, parameters, 'office');
  // Only the administrator may look at another member's agenda; that view is limited like theirs.
  const focus = queryParameters?.userId === undefined ? null : uuid(queryParameters.userId, 'userId');
  if (focus && actor.role !== 'admin') {
    throw new CalendarServiceError(403, 'You do not have permission to access this resource.');
  }
  const admin = actor.role === 'admin' && !focus;
  parameters.push(focus ?? actor.user_id);
  const office = (alias) => `${alias}.office_id = $3`;
  const scope = {
    hearing: admin ? '' : `AND (${assignedCase('h.case_id')} OR h.attended_by_user_id = $4)`,
    appointment: admin ? '' : `AND (a.user_id = $4 OR (a.case_id IS NOT NULL AND ${assignedCase('a.case_id')}))`,
    notice: admin ? '' : `AND ${assignedCase('n.case_id')}`,
    task: admin ? '' : `AND t.assigned_to_user_id = $4 AND (t.case_id IS NULL OR ${assignedCase('t.case_id')})`,
  };
  const noRows = { rows: [] };

  const [hearings, appointments, notices, tasks, invoices] = await Promise.all([
    execute(
      `SELECT h.hearing_id AS id, h.hearing_at AS at, h.hearing_type, h.court_room, h.status, h.outcome, h.notes,
              lc.case_id, lc.case_number, lc.title AS case_title, co.name AS court_name
         FROM hearings h
         JOIN legal_cases lc ON lc.case_id = h.case_id AND lc.office_id = h.office_id
         LEFT JOIN courts co ON co.court_id = h.court_id
        WHERE h.hearing_at >= $1 AND h.hearing_at < $2 AND ${office('h')} ${scope.hearing}
        ORDER BY h.hearing_at`,
      parameters
    ),
    execute(
      `SELECT a.appointment_id AS id, a.starts_at AS at, a.ends_at, a.status, a.purpose, a.location,
              a.appointment_type, c.client_id, c.full_name_or_org AS client_name, u.full_name AS staff_name,
              lc.case_id, lc.case_number
         FROM appointments a
         LEFT JOIN clients c ON c.client_id = a.client_id AND c.office_id = a.office_id
         JOIN app_users u ON u.user_id = a.user_id
         LEFT JOIN legal_cases lc ON lc.case_id = a.case_id AND lc.office_id = a.office_id
        WHERE a.starts_at >= $1 AND a.starts_at < $2 AND ${office('a')} ${scope.appointment}
        ORDER BY a.starts_at`,
      parameters
    ),
    execute(
      `SELECT n.notice_id AS id, n.sent_on AS at, n.notice_type, n.recipient, n.bailiff_office,
              n.delivery_status, lc.case_id, lc.case_number
         FROM court_notices n
         JOIN legal_cases lc ON lc.case_id = n.case_id AND lc.office_id = n.office_id
        WHERE n.sent_on >= $1::date AND n.sent_on < $2::date AND ${office('n')} ${scope.notice}
        ORDER BY n.sent_on`,
      parameters
    ),
    execute(
      `SELECT t.task_id AS id, t.due_at AS at, t.title, t.status, t.priority, t.is_private,
              u.full_name AS assignee_name, lc.case_id, lc.case_number
         FROM tasks t
         JOIN app_users u ON u.user_id = t.assigned_to_user_id
         LEFT JOIN legal_cases lc ON lc.case_id = t.case_id AND lc.office_id = t.office_id
        WHERE (NOT t.is_private OR t.created_by_user_id = $4) AND t.status <> 'cancelled'
          AND t.due_at >= $1 AND t.due_at < $2 AND ${office('t')} ${scope.task}
        ORDER BY t.due_at`,
      parameters
    ),
    // Claims are the whole office's business; a single member's agenda leaves them out.
    admin ? execute(
      `SELECT i.invoice_id AS id, i.due_at AS at, i.invoice_number, i.amount, i.currency, i.status,
              c.full_name_or_org AS client_name, lc.case_id, lc.case_number
         FROM invoices i
         JOIN clients c ON c.client_id = i.client_id
         LEFT JOIN legal_cases lc ON lc.case_id = i.case_id
        WHERE i.status IN ('unpaid', 'partially_paid')
          AND i.due_at >= $1 AND i.due_at < $2 AND ${office('i')}
        ORDER BY i.due_at`,
      parameters
    ) : noRows,
  ]);

  const events = [
    ...hearings.rows.map((row) => ({
      kind: 'hearing', id: row.id, at: row.at, status: row.status,
      title: `جلسة ${row.hearing_type}`, case_id: row.case_id, case_number: row.case_number,
      details: { case_title: row.case_title, court_name: row.court_name, court_room: row.court_room, outcome: row.outcome, notes: row.notes, hearing_type: row.hearing_type },
    })),
    ...appointments.rows.map((row) => ({
      kind: 'appointment', id: row.id, at: row.at, ends_at: row.ends_at, status: row.status,
      title: row.purpose, case_id: row.case_id, case_number: row.case_number,
      details: { client_name: row.client_name, staff_name: row.staff_name, location: row.location, appointment_type: row.appointment_type },
    })),
    ...notices.rows.map((row) => ({
      kind: 'notice', id: row.id, at: row.at, status: row.delivery_status,
      title: row.recipient ? `تبليغ إلى ${row.recipient}` : 'ورقة محضر', case_id: row.case_id, case_number: row.case_number,
      details: { notice_type: row.notice_type, recipient: row.recipient, bailiff_office: row.bailiff_office },
    })),
    ...tasks.rows.map((row) => ({
      kind: 'task', id: row.id, at: row.at, status: row.status,
      title: row.title, case_id: row.case_id, case_number: row.case_number,
      details: { assignee_name: row.assignee_name, priority: row.priority, private: row.is_private ? 1 : 0 },
    })),
    ...invoices.rows.map((row) => ({
      kind: 'invoice', id: row.id, at: row.at, status: row.status,
      title: `استحقاق مطالبة ${row.invoice_number}`, case_id: row.case_id, case_number: row.case_number,
      details: { client_name: row.client_name, amount: Number(row.amount), currency: row.currency },
    })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));

  return { events };
}

/* ───────────────────────── hearings ───────────────────────── */

export async function createHearing(actor, body) {
  assertAdmin(actor);
  assertBody(body, ['case_id', 'hearing_at', 'hearing_type', 'court_room', 'notes']);
  const caseId = uuid(body.case_id, 'case_id');
  const hearingAt = timestamp(body.hearing_at, 'hearing_at');
  const hearingType = text(body.hearing_type, 'hearing_type', 50, { required: true });
  const courtRoom = text(body.court_room, 'court_room', 50);
  const notes = text(body.notes, 'notes', 2000);
  const parameters = [caseId];
  const officeClause = officeCondition(actor, parameters, 'lc');
  const result = await execute(
    `INSERT INTO hearings (hearing_at, hearing_type, court_room, notes, case_id, office_id)
     SELECT $3::timestamptz, $4::text, $5::text, $6::text, lc.case_id, lc.office_id
       FROM legal_cases lc
      WHERE lc.case_id = $1 AND ${officeClause}
     RETURNING hearing_id, hearing_at, hearing_type, court_room, status, notes, case_id`,
    [...parameters, hearingAt, hearingType, courtRoom, notes]
  );
  if (!result.rowCount) throw new CalendarServiceError(404, 'Case not found.');
  const hearing = result.rows[0];
  auditLater(actor, {
    action: 'hearing_scheduled',
    entityType: 'case',
    entityId: caseId,
    details: { values: { hearing_type: hearingType, hearing_at: hearingAt, court_room: courtRoom } },
  });
  return hearing;
}

export async function updateHearing(actor, hearingId, body) {
  assertAdmin(actor);
  uuid(hearingId, 'hearingId');
  assertBody(body, ['status', 'hearing_at', 'outcome', 'court_room', 'notes']);
  const fields = {};
  if (Object.hasOwn(body, 'status')) {
    if (!HEARING_STATUSES.has(body.status)) invalid('status is not an allowed hearing status.');
    fields.status = body.status;
  }
  if (Object.hasOwn(body, 'hearing_at')) fields.hearing_at = timestamp(body.hearing_at, 'hearing_at');
  if (Object.hasOwn(body, 'outcome')) fields.outcome = text(body.outcome, 'outcome', 2000);
  if (Object.hasOwn(body, 'court_room')) fields.court_room = text(body.court_room, 'court_room', 50);
  if (Object.hasOwn(body, 'notes')) fields.notes = text(body.notes, 'notes', 2000);
  const entries = Object.entries(fields);
  if (!entries.length) invalid('At least one field is required.');
  const parameters = entries.map(([, value]) => value);
  const sets = entries.map(([field], index) => `${field} = $${index + 1}${field === 'hearing_at' ? '::timestamptz' : ''}`);
  parameters.push(hearingId);
  const idParameter = `$${parameters.length}`;
  const officeClause = officeCondition(actor, parameters, 'h');
  const result = await execute(
    `UPDATE hearings h SET ${sets.join(', ')}
      WHERE h.hearing_id = ${idParameter} AND ${officeClause}
      RETURNING hearing_id, hearing_at, hearing_type, court_room, status, outcome, notes, case_id`,
    parameters
  );
  if (!result.rowCount) throw new CalendarServiceError(404, 'Hearing not found.');
  return result.rows[0];
}

/* ───────────────────────── appointments ───────────────────────── */

export async function createAppointment(actor, body) {
  assertAdmin(actor);
  assertBody(body, ['client_id', 'user_id', 'case_id', 'starts_at', 'ends_at', 'purpose', 'location', 'appointment_type']);
  const appointmentType = body.appointment_type ?? 'meeting';
  if (!APPOINTMENT_TYPES.has(appointmentType)) invalid('appointment_type is not supported.');
  if (appointmentType === 'meeting' && body.client_id == null) invalid('A client meeting needs a client.');
  const clientId = body.client_id == null ? null : uuid(body.client_id, 'client_id');
  const userId = uuid(body.user_id, 'user_id');
  const caseId = body.case_id == null ? null : uuid(body.case_id, 'case_id');
  const startsAt = timestamp(body.starts_at, 'starts_at');
  const endsAt = timestamp(body.ends_at, 'ends_at');
  if (Date.parse(endsAt) <= Date.parse(startsAt)) invalid('ends_at must be after starts_at.');
  const purpose = text(body.purpose, 'purpose', 300, { required: true });
  const location = text(body.location, 'location', 200);
  const parameters = [clientId, userId, caseId];
  const officeClause = officeCondition(actor, parameters, 'membership');
  // Client (when given), staff member and case must all belong to this office; the staff member
  // must be active staff.
  const result = await execute(
    `INSERT INTO appointments (starts_at, ends_at, purpose, location, appointment_type, client_id, user_id, case_id, office_id)
     SELECT $5::timestamptz, $6::timestamptz, $7::text, $8::text, $9::text, c.client_id, membership.user_id, lc.case_id, membership.office_id
       FROM office_memberships membership
       JOIN roles r ON r.role_id = membership.role_id AND r.role_name IN ('admin', 'lawyer', 'assistant')
       LEFT JOIN clients c ON c.client_id = $1::uuid AND c.office_id = membership.office_id
       LEFT JOIN legal_cases lc ON lc.case_id = $3::uuid AND lc.office_id = membership.office_id
      WHERE membership.user_id = $2 AND membership.status = 'active' AND ${officeClause}
        AND ($1::uuid IS NULL OR c.client_id IS NOT NULL)
        AND ($3::uuid IS NULL OR lc.case_id IS NOT NULL)
     RETURNING appointment_id, starts_at, ends_at, status, purpose, location, appointment_type, client_id, user_id, case_id`,
    [...parameters, startsAt, endsAt, purpose, location, appointmentType]
  );
  if (!result.rowCount) throw new CalendarServiceError(404, 'Client, staff member or case not found.');
  auditLater(actor, {
    action: 'appointment_scheduled',
    entityType: clientId ? 'client' : caseId ? 'case' : 'office',
    entityId: clientId ?? caseId ?? actor.office_id,
    details: { values: { purpose, starts_at: startsAt, location, appointment_type: appointmentType } },
  });
  return result.rows[0];
}

export async function updateAppointment(actor, appointmentId, body) {
  assertAdmin(actor);
  uuid(appointmentId, 'appointmentId');
  assertBody(body, ['status']);
  if (!APPOINTMENT_STATUSES.has(body.status)) invalid('status is not an allowed appointment status.');
  const parameters = [body.status, appointmentId];
  const officeClause = officeCondition(actor, parameters, 'a');
  const result = await execute(
    `UPDATE appointments a SET status = $1
      WHERE a.appointment_id = $2 AND ${officeClause}
      RETURNING appointment_id, status`,
    parameters
  );
  if (!result.rowCount) throw new CalendarServiceError(404, 'Appointment not found.');
  return result.rows[0];
}
