import { auditLater } from './auditService.js';
import { createClient } from './clientService.js';
import { assertActor, assertBody, execute, invalid, notFound, OfficeFinanceError, optionalUuid, text, uuid } from './financeInput.js';
import { notifyLater } from './notificationService.js';
import { officeCondition } from './officeScope.js';
import { publishedOfficeId } from './publicPageService.js';

/**
 * Consultation requests sent from an office's public page.
 *
 *   visitor   sends a request (name, phone, optional email, case type, message, preferred time)
 *   admin     sees every request, assigns one to a lawyer, updates it, turns it into a client
 *   lawyer    sees the requests assigned to them and updates their status and notes
 *
 * The form carries a hidden field and the time it was opened: a request that fills the hidden
 * field, or arrives within seconds of the page opening, is taken for a bot and quietly dropped.
 * The public route is also rate limited.
 */

const STATUSES = ['new', 'contacted', 'converted', 'rejected'];
const MIN_FILL_MS = 3000;
const MAX_FILL_MS = 24 * 60 * 60 * 1000;
const PHONE_PATTERN = /^\+?[0-9 ()-]{7,20}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isAdmin = (actor) => actor.role === 'admin';

/**
 * Files a visitor's request with the office behind the page. Returns whether it was kept; a
 * request taken for a bot answers the same as a real one, so the bot learns nothing.
 */
export async function submitConsultation(slug, body, { now = Date.now() } = {}) {
  assertBody(body, ['full_name', 'phone', 'email', 'case_type', 'message', 'preferred_time', 'website', 'opened_at']);
  const fullName = text(body.full_name, 'full_name', 150, { required: true });
  const phone = text(body.phone, 'phone', 30, { required: true });
  if (!PHONE_PATTERN.test(phone)) invalid('phone must be a phone number.');
  const email = text(body.email, 'email', 254);
  if (email && !EMAIL_PATTERN.test(email)) invalid('email must be an email address.');
  const caseType = text(body.case_type, 'case_type', 50);
  const message = text(body.message, 'message', 3000, { required: true });
  const preferredTime = text(body.preferred_time, 'preferred_time', 200);
  const officeId = await publishedOfficeId(slug);

  const openedAt = Number(body.opened_at);
  const elapsed = now - openedAt;
  const looksLikeBot = Boolean(body.website) || !Number.isFinite(openedAt) || elapsed < MIN_FILL_MS || elapsed > MAX_FILL_MS;
  if (looksLikeBot) return { received: true, kept: false };

  const result = await execute(
    `INSERT INTO consultation_requests (full_name, phone, email, case_type, message, preferred_time, office_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING request_id`,
    [fullName, phone, email, caseType, message, preferredTime, officeId]
  );
  notifyLater('consultation.received', { officeId, actorUserId: null });
  return { received: true, kept: true, request_id: result.rows[0].request_id };
}

/* ───────────── the office's inbox ───────────── */

const COLUMNS = `
  r.request_id, r.full_name, r.phone, r.email, r.case_type, r.message, r.preferred_time, r.status, r.notes,
  r.assigned_to_user_id, assignee.full_name AS assigned_to_name, r.client_id, c.full_name_or_org AS client_name,
  r.created_at, r.updated_at`;
const FROM = `
  FROM consultation_requests r
  LEFT JOIN app_users assignee ON assignee.user_id = r.assigned_to_user_id
  LEFT JOIN clients c ON c.client_id = r.client_id AND c.office_id = r.office_id`;

/** The administrator sees every request; a lawyer or assistant those assigned to them. */
function scope(actor, parameters) {
  const office = officeCondition(actor, parameters, 'r');
  if (isAdmin(actor)) return office;
  parameters.push(actor.user_id);
  return `${office} AND r.assigned_to_user_id = $${parameters.length}`;
}

export async function listConsultations(actor, queryParameters = {}) {
  assertActor(actor, ['admin', 'lawyer', 'assistant']);
  if (Object.keys(queryParameters).some((key) => key !== 'status')) invalid('Unsupported query parameter.');
  const parameters = [];
  let filters = scope(actor, parameters);
  if (queryParameters.status !== undefined) {
    if (!STATUSES.includes(queryParameters.status)) invalid('status is not supported.');
    parameters.push(queryParameters.status);
    filters += ` AND r.status = $${parameters.length}`;
  }
  const result = await execute(
    `SELECT ${COLUMNS} ${FROM} WHERE ${filters}
      ORDER BY (r.status = 'new') DESC, r.created_at DESC LIMIT 200`,
    parameters
  );
  return { requests: result.rows };
}

async function findConsultation(actor, requestId) {
  uuid(requestId, 'requestId');
  const parameters = [requestId];
  const filters = scope(actor, parameters);
  const result = await execute(`SELECT ${COLUMNS} ${FROM} WHERE r.request_id = $1 AND ${filters}`, parameters);
  if (!result.rowCount) notFound('Request');
  return result.rows[0];
}

/**
 * Updates a request: its status (not "converted", which only conversion sets) and notes, and,
 * for the administrator, who it is assigned to (an active staff member of the office, or nobody).
 */
export async function updateConsultation(actor, requestId, body) {
  assertActor(actor, ['admin', 'lawyer', 'assistant']);
  assertBody(body, ['status', 'notes', 'assigned_to_user_id']);
  if (Object.keys(body).length === 0) invalid('At least one field is required.');
  if (Object.hasOwn(body, 'assigned_to_user_id') && !isAdmin(actor)) {
    throw new OfficeFinanceError(403, 'Only the office administrator assigns requests.', 'FORBIDDEN');
  }
  if (Object.hasOwn(body, 'status') && !['new', 'contacted', 'rejected'].includes(body.status)) {
    invalid('status must be new, contacted or rejected.');
  }
  const before = await findConsultation(actor, requestId);
  if (before.status === 'converted') throw new OfficeFinanceError(409, 'This request already became a client.', 'REQUEST_CONVERTED');

  const sets = [];
  const parameters = [requestId];
  const add = (column, value, cast = '') => {
    parameters.push(value);
    sets.push(`${column} = $${parameters.length}${cast}`);
  };
  if (Object.hasOwn(body, 'status')) add('status', body.status);
  if (Object.hasOwn(body, 'notes')) add('notes', text(body.notes, 'notes', 2000));
  let assignee = null;
  let assigneeParameter = null;
  if (Object.hasOwn(body, 'assigned_to_user_id')) {
    assignee = optionalUuid(body.assigned_to_user_id, 'assigned_to_user_id');
    add('assigned_to_user_id', assignee, '::uuid');
    assigneeParameter = `$${parameters.length}`;
  }
  const office = officeCondition(actor, parameters, 'r');
  // A named assignee must be an active staff member of the same office.
  const assigneeCheck = assignee
    ? `AND EXISTS (SELECT 1 FROM office_memberships m JOIN roles role ON role.role_id = m.role_id
                    WHERE m.office_id = r.office_id AND m.user_id = ${assigneeParameter}::uuid
                      AND m.status = 'active' AND role.role_name IN ('admin', 'lawyer', 'assistant'))`
    : '';
  const ownOnly = isAdmin(actor) ? '' : (() => {
    parameters.push(actor.user_id);
    return `AND r.assigned_to_user_id = $${parameters.length}`;
  })();
  const result = await execute(
    `UPDATE consultation_requests r SET ${sets.join(', ')}, updated_at = NOW()
      WHERE r.request_id = $1 AND r.status <> 'converted' AND ${office} ${ownOnly} ${assigneeCheck}
     RETURNING r.request_id`,
    parameters
  );
  if (!result.rowCount) invalid('The request can no longer change, or the person is not an active staff member.');
  if (assignee && assignee !== before.assigned_to_user_id) {
    notifyLater('consultation.assigned', { officeId: actor.office_id, actorUserId: actor.user_id, userId: assignee });
  }
  return { request: await findConsultation(actor, requestId) };
}

/**
 * Turns a request into a client of the office (through the usual client creation, so the same
 * checks apply) and marks it converted. A case can then be opened for that client as usual.
 */
export async function convertConsultation(actor, requestId, body = {}) {
  assertActor(actor, ['admin']);
  assertBody(body, ['client_type']);
  const clientType = body.client_type ?? 'individual';
  if (!['individual', 'organization'].includes(clientType)) invalid('client_type must be individual or organization.');
  const request = await findConsultation(actor, requestId);
  if (request.status === 'converted') throw new OfficeFinanceError(409, 'This request already became a client.', 'REQUEST_CONVERTED');
  const client = await createClient(actor, {
    client_type: clientType,
    full_name_or_org: request.full_name,
    phone: request.phone,
    ...(request.email ? { email: request.email } : {}),
  });
  const parameters = [requestId, client.client_id];
  const office = officeCondition(actor, parameters, 'r');
  const result = await execute(
    `UPDATE consultation_requests r SET status = 'converted', client_id = $2, updated_at = NOW()
      WHERE r.request_id = $1 AND r.status <> 'converted' AND ${office} RETURNING r.request_id`,
    parameters
  );
  if (!result.rowCount) throw new OfficeFinanceError(409, 'This request already became a client.', 'REQUEST_CONVERTED');
  auditLater(actor, { action: 'consultation_converted', entityType: 'client', entityId: client.client_id, details: { subject: client.full_name_or_org } });
  return { request: await findConsultation(actor, requestId), client };
}
