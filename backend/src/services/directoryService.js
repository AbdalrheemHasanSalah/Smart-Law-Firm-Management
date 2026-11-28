import { query } from '../config/db.js';
import { auditLater } from './auditService.js';

/**
 * The professional directory (phase 7):
 *
 *   courts      one shared list for every office, kept by the platform admin; each office may add
 *               its own private note to a court
 *   colleagues  lawyers from other offices, each office's own list; staff add and edit them, the
 *               office admin deletes them
 *   templates   the office's own message templates to colleagues (the ready ones are in the app);
 *               the office admin keeps them. The system never sends these messages itself.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF = ['admin', 'lawyer', 'assistant'];

export class DirectoryError extends Error {
  constructor(status, message, publicCode) {
    super(message);
    this.name = 'DirectoryError';
    this.status = status;
    if (publicCode) this.publicCode = publicCode;
  }
}

const invalid = (message) => {
  throw new DirectoryError(400, message, 'VALIDATION');
};
const forbidden = () => {
  throw new DirectoryError(403, 'You do not have permission to access this resource.', 'FORBIDDEN');
};
const notFound = () => {
  throw new DirectoryError(404, 'Not found.', 'NOT_FOUND');
};

function assertStaff(actor, roles = STAFF) {
  if (!actor || !roles.includes(actor.role) || !UUID_PATTERN.test(String(actor.user_id)) || !UUID_PATTERN.test(String(actor.office_id))) forbidden();
}
const assertId = (value, name) => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) invalid(`${name} must be a valid UUID.`);
};

/**
 * Reads the allowed text fields of a body. Each field is optional on update; `required` ones must be
 * present (on create) and non-empty. Empty strings clear an optional field.
 */
function readFields(body, spec, { partial }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('The body must be an object.');
  const unknown = Object.keys(body).filter((key) => !(key in spec));
  if (unknown.length) invalid(`Unknown fields: ${unknown.join(', ')}.`);
  const values = {};
  for (const [key, { max, required, pattern }] of Object.entries(spec)) {
    if (!(key in body)) {
      if (required && !partial) invalid(`${key} is required.`);
      continue;
    }
    const raw = body[key];
    if (raw !== null && typeof raw !== 'string') invalid(`${key} must be text.`);
    const value = raw === null ? '' : raw.trim();
    if (!value) {
      if (required) invalid(`${key} is required.`);
      values[key] = null;
      continue;
    }
    if (value.length > max) invalid(`${key} is too long (at most ${max} characters).`);
    if (pattern && !pattern.test(value)) invalid(`${key} is not valid.`);
    values[key] = value;
  }
  if (partial && Object.keys(values).length === 0) invalid('Nothing to change.');
  return values;
}

const PHONE = /^[0-9+()\-\s]{4,40}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ───────────── courts ───────────── */

const COURT_FIELDS = {
  name: { max: 150, required: true },
  court_type: { max: 50 },
  city: { max: 80 },
  location: { max: 300 },
  phone: { max: 40, pattern: PHONE },
  email: { max: 150, pattern: EMAIL },
  working_hours: { max: 150 },
};
const COURT_COLUMNS = 'c.court_id, c.name, c.court_type, c.city, c.location, c.phone, c.email, c.working_hours, c.is_active';

export async function listCourts(actor, { search } = {}) {
  const platform = actor?.is_platform_admin === true;
  if (!platform) assertStaff(actor);
  const text = typeof search === 'string' ? search.trim().slice(0, 100) : '';
  const parameters = [];
  const conditions = [];
  if (!platform) conditions.push('c.is_active');
  if (text) {
    parameters.push(`%${text.replace(/[\\%_]/g, (match) => `\\${match}`)}%`);
    conditions.push(`(c.name ILIKE $${parameters.length} OR c.city ILIKE $${parameters.length})`);
  }
  let noteColumn = 'NULL::text AS office_note';
  let join = '';
  if (!platform || UUID_PATTERN.test(String(actor.office_id))) {
    parameters.push(actor.office_id);
    noteColumn = 'n.note AS office_note';
    join = `LEFT JOIN court_office_notes n ON n.court_id = c.court_id AND n.office_id = $${parameters.length}`;
  }
  const result = await query(
    `SELECT ${COURT_COLUMNS}, ${noteColumn}
       FROM courts c ${join}
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY c.city NULLS LAST, c.name
      LIMIT 500`,
    parameters
  );
  return { courts: result.rows };
}

const assertPlatform = (actor) => {
  if (actor?.is_platform_admin !== true) forbidden();
};

export async function createCourt(actor, body) {
  assertPlatform(actor);
  const values = readFields(body, COURT_FIELDS, { partial: false });
  const keys = Object.keys(values);
  const result = await query(
    `INSERT INTO courts (${keys.join(', ')}) VALUES (${keys.map((_, index) => `$${index + 1}`).join(', ')})
     RETURNING court_id, name, court_type, city, location, phone, email, working_hours, is_active`,
    keys.map((key) => values[key])
  );
  return { court: { ...result.rows[0], office_note: null } };
}

export async function updateCourt(actor, courtId, body) {
  assertPlatform(actor);
  assertId(courtId, 'courtId');
  const { is_active: active, ...rest } = body ?? {};
  if (active !== undefined && typeof active !== 'boolean') invalid('is_active must be true or false.');
  const values = Object.keys(rest).length || active === undefined ? readFields(rest, COURT_FIELDS, { partial: true }) : {};
  if (active !== undefined) values.is_active = active;
  const keys = Object.keys(values);
  const result = await query(
    `UPDATE courts SET ${keys.map((key, index) => `${key} = $${index + 2}`).join(', ')}, updated_at = NOW()
      WHERE court_id = $1
     RETURNING court_id, name, court_type, city, location, phone, email, working_hours, is_active`,
    [courtId, ...keys.map((key) => values[key])]
  );
  if (!result.rowCount) notFound();
  return { court: { ...result.rows[0], office_note: null } };
}

/** The office's own note on a court; an empty note removes it. */
export async function setCourtNote(actor, courtId, body) {
  assertStaff(actor);
  assertId(courtId, 'courtId');
  const { note } = readFields(body, { note: { max: 1000 } }, { partial: false });
  if (note === undefined || note === null) {
    await query('DELETE FROM court_office_notes WHERE office_id = $1 AND court_id = $2', [actor.office_id, courtId]);
    return { court_id: courtId, office_note: null };
  }
  const result = await query(
    `INSERT INTO court_office_notes (office_id, court_id, note, updated_by_user_id)
     SELECT $1, c.court_id, $3, $4 FROM courts c WHERE c.court_id = $2 AND c.is_active
     ON CONFLICT (office_id, court_id) DO UPDATE SET note = EXCLUDED.note, updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = NOW()
     RETURNING note`,
    [actor.office_id, courtId, note, actor.user_id]
  );
  if (!result.rowCount) notFound();
  return { court_id: courtId, office_note: result.rows[0].note };
}

/* ───────────── colleagues ───────────── */

const COLLEAGUE_FIELDS = {
  full_name: { max: 150, required: true },
  bar_number: { max: 40 },
  phone: { max: 40, pattern: PHONE },
  email: { max: 150, pattern: EMAIL },
  city: { max: 80 },
  office_name: { max: 150 },
  notes: { max: 1000 },
};
const COLLEAGUE_COLUMNS = 'colleague_id, full_name, bar_number, phone, email, city, office_name, notes, created_at, updated_at';

export async function listColleagues(actor, { search } = {}) {
  assertStaff(actor);
  const text = typeof search === 'string' ? search.trim().slice(0, 100) : '';
  const parameters = [actor.office_id];
  let filter = '';
  if (text) {
    parameters.push(`%${text.replace(/[\\%_]/g, (match) => `\\${match}`)}%`);
    filter = 'AND (full_name ILIKE $2 OR bar_number ILIKE $2 OR city ILIKE $2 OR office_name ILIKE $2 OR phone ILIKE $2)';
  }
  const result = await query(
    `SELECT ${COLLEAGUE_COLUMNS} FROM colleagues WHERE office_id = $1 ${filter} ORDER BY full_name LIMIT 1000`,
    parameters
  );
  return { colleagues: result.rows };
}

export async function createColleague(actor, body) {
  assertStaff(actor);
  const values = readFields(body, COLLEAGUE_FIELDS, { partial: false });
  const keys = Object.keys(values);
  const result = await query(
    `INSERT INTO colleagues (office_id, created_by_user_id, ${keys.join(', ')})
     VALUES ($1, $2, ${keys.map((_, index) => `$${index + 3}`).join(', ')})
     RETURNING ${COLLEAGUE_COLUMNS}`,
    [actor.office_id, actor.user_id, ...keys.map((key) => values[key])]
  );
  auditLater(actor, { action: 'colleague_added', entityType: 'colleague', entityId: result.rows[0].colleague_id, details: { subject: values.full_name } });
  return { colleague: result.rows[0] };
}

export async function updateColleague(actor, colleagueId, body) {
  assertStaff(actor);
  assertId(colleagueId, 'colleagueId');
  const values = readFields(body, COLLEAGUE_FIELDS, { partial: true });
  const keys = Object.keys(values);
  const result = await query(
    `UPDATE colleagues SET ${keys.map((key, index) => `${key} = $${index + 3}`).join(', ')}, updated_at = NOW()
      WHERE colleague_id = $1 AND office_id = $2
     RETURNING ${COLLEAGUE_COLUMNS}`,
    [colleagueId, actor.office_id, ...keys.map((key) => values[key])]
  );
  if (!result.rowCount) notFound();
  return { colleague: result.rows[0] };
}

export async function deleteColleague(actor, colleagueId) {
  assertStaff(actor, ['admin']);
  assertId(colleagueId, 'colleagueId');
  const result = await query('DELETE FROM colleagues WHERE colleague_id = $1 AND office_id = $2 RETURNING full_name', [colleagueId, actor.office_id]);
  if (!result.rowCount) notFound();
  auditLater(actor, { action: 'colleague_removed', entityType: 'colleague', entityId: colleagueId, details: { subject: result.rows[0].full_name } });
  return { deleted: true };
}

/* ───────────── message templates ───────────── */

const TEMPLATE_FIELDS = { title: { max: 120, required: true }, body: { max: 3000, required: true } };
const TEMPLATE_COLUMNS = 'template_id, title, body, created_at, updated_at';

export async function listTemplates(actor) {
  assertStaff(actor);
  const result = await query(`SELECT ${TEMPLATE_COLUMNS} FROM colleague_message_templates WHERE office_id = $1 ORDER BY title LIMIT 200`, [actor.office_id]);
  return { templates: result.rows };
}

export async function createTemplate(actor, body) {
  assertStaff(actor, ['admin']);
  const values = readFields(body, TEMPLATE_FIELDS, { partial: false });
  const result = await query(
    `INSERT INTO colleague_message_templates (office_id, created_by_user_id, title, body) VALUES ($1, $2, $3, $4) RETURNING ${TEMPLATE_COLUMNS}`,
    [actor.office_id, actor.user_id, values.title, values.body]
  );
  return { template: result.rows[0] };
}

export async function updateTemplate(actor, templateId, body) {
  assertStaff(actor, ['admin']);
  assertId(templateId, 'templateId');
  const values = readFields(body, TEMPLATE_FIELDS, { partial: true });
  const keys = Object.keys(values);
  const result = await query(
    `UPDATE colleague_message_templates SET ${keys.map((key, index) => `${key} = $${index + 3}`).join(', ')}, updated_at = NOW()
      WHERE template_id = $1 AND office_id = $2
     RETURNING ${TEMPLATE_COLUMNS}`,
    [templateId, actor.office_id, ...keys.map((key) => values[key])]
  );
  if (!result.rowCount) notFound();
  return { template: result.rows[0] };
}

export async function deleteTemplate(actor, templateId) {
  assertStaff(actor, ['admin']);
  assertId(templateId, 'templateId');
  const result = await query('DELETE FROM colleague_message_templates WHERE template_id = $1 AND office_id = $2', [templateId, actor.office_id]);
  if (!result.rowCount) notFound();
  return { deleted: true };
}
