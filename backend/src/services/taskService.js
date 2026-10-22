import { query } from '../config/db.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK_STATUSES = new Set(['pending', 'in_progress', 'completed', 'cancelled']);
const TASK_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const LIST_FIELDS = new Set(['page', 'pageSize', 'status', 'priority', 'caseId', 'search']);
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
const TASK_FIELDS = [
  'task_id',
  'title',
  'description',
  'status',
  'priority',
  'due_at',
  'completed_at',
  'case_id',
  'assigned_to_name',
  'created_by_name',
];
const BODY_FIELDS = new Set(['title', 'description', 'status', 'priority', 'due_at']);
const CREATE_FIELDS = new Set([
  ...BODY_FIELDS,
  'assigned_to_user_id',
  'case_id',
]);

export class TaskServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'TaskServiceError';
    this.status = status;
  }
}

function invalid(message) {
  throw new TaskServiceError(400, message);
}

function validateUuid(value, field) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    invalid(`${field} must be a valid UUID.`);
  }
  return value;
}

function assertActor(actor, roles) {
  if (!actor || !roles.includes(actor.role)) {
    throw new TaskServiceError(403, 'You do not have permission to access this resource.');
  }
  if (typeof actor.user_id !== 'string' || !UUID_PATTERN.test(actor.user_id)) {
    throw new TaskServiceError(403, 'You do not have permission to access this resource.');
  }
}

function parseInteger(value, fallback, field) {
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
    !parameters ||
    typeof parameters !== 'object' ||
    Object.keys(parameters).some((key) => !LIST_FIELDS.has(key))
  ) {
    invalid('Unsupported task-list query parameter.');
  }

  const page = parseInteger(parameters.page, 1, 'page');
  const pageSize = Math.min(
    parseInteger(parameters.pageSize, DEFAULT_PAGE_SIZE, 'pageSize'),
    MAX_PAGE_SIZE
  );
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) invalid('page is too large.');

  let status;
  if (parameters.status !== undefined) {
    if (!TASK_STATUSES.has(parameters.status)) invalid('status is not an allowed task status.');
    status = parameters.status;
  }
  let priority;
  if (parameters.priority !== undefined) {
    if (!TASK_PRIORITIES.has(parameters.priority)) invalid('priority is not an allowed task priority.');
    priority = parameters.priority;
  }
  let caseId;
  if (parameters.caseId !== undefined) caseId = validateUuid(parameters.caseId, 'caseId');

  let search = '';
  if (parameters.search !== undefined) {
    if (typeof parameters.search !== 'string') invalid('search must be a string.');
    search = parameters.search.trim();
    if (search.length > 100) invalid('search must contain at most 100 characters.');
  }
  return { page, pageSize, offset, status, priority, caseId, search };
}

function validateTimestamp(value, field) {
  if (value === null) return null;
  if (typeof value !== 'string') {
    invalid(`${field} must be an ISO timestamp or null.`);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) {
    invalid(`${field} must be an ISO timestamp or null.`);
  }
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    invalid(`${field} must be an ISO timestamp or null.`);
  }
  return value;
}

function validateBody(body, allowedFields, { create = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    invalid('Request body must be a JSON object.');
  }
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    invalid('Request contains unsupported task fields.');
  }
  if (Object.keys(body).length === 0) invalid('At least one permitted field is required.');

  if (create) {
    for (const field of ['title', 'assigned_to_user_id']) {
      if (!Object.hasOwn(body, field)) invalid(`${field} is required.`);
    }
  }

  const fields = {};
  if (Object.hasOwn(body, 'title')) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 200) {
      invalid('title must contain 1 to 200 characters.');
    }
    fields.title = body.title.trim();
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
  if (Object.hasOwn(body, 'status')) {
    if (!TASK_STATUSES.has(body.status)) invalid('status is not an allowed task status.');
    fields.status = body.status;
  }
  if (Object.hasOwn(body, 'priority')) {
    if (!TASK_PRIORITIES.has(body.priority)) invalid('priority is not an allowed task priority.');
    fields.priority = body.priority;
  }
  if (Object.hasOwn(body, 'due_at')) {
    fields.due_at = validateTimestamp(body.due_at, 'due_at');
  }
  if (Object.hasOwn(body, 'assigned_to_user_id')) {
    fields.assigned_to_user_id = validateUuid(body.assigned_to_user_id, 'assigned_to_user_id');
  }
  if (Object.hasOwn(body, 'case_id')) {
    fields.case_id = body.case_id === null ? null : validateUuid(body.case_id, 'case_id');
  }

  if (fields.status === 'completed') {
    fields.completed_at = new Date().toISOString();
  }
  if (fields.status && fields.status !== 'completed') {
    fields.completed_at = null;
  }
  return fields;
}

function taskAccessScope(actor, parameters, alias = 't') {
  if (actor.role === 'admin') return '';
  parameters.push(actor.user_id);
  const userParameter = `$${parameters.length}`;
  return `
    AND ${alias}.assigned_to_user_id = ${userParameter}
    AND (
      ${alias}.case_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM assigned_to case_assignment
        WHERE case_assignment.case_id = ${alias}.case_id
          AND case_assignment.user_id = ${userParameter}
      )
    )
  `;
}

function safeTask(row) {
  return Object.fromEntries(TASK_FIELDS.map((field) => [field, row[field]]));
}

function mapDatabaseError(error) {
  if (error?.code === '23505') {
    throw new TaskServiceError(409, 'A task record conflicts with existing data.');
  }
  if (['23502', '23503', '23514', '22001', '22007', '22P02'].includes(error?.code)) {
    throw new TaskServiceError(400, 'Task data violates a database constraint.');
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

const TASK_SELECT = `
  SELECT
    t.task_id,
    t.title,
    t.description,
    t.status,
    t.priority,
    t.due_at,
    t.completed_at,
    t.case_id,
    assignee.full_name AS assigned_to_name,
    creator.full_name AS created_by_name
  FROM tasks t
  JOIN app_users assignee ON assignee.user_id = t.assigned_to_user_id
  JOIN app_users creator ON creator.user_id = t.created_by_user_id
`;

export async function listTasks(actor, queryParameters) {
  assertActor(actor, ['admin', 'lawyer', 'assistant']);
  const { page, pageSize, offset, status, priority, caseId, search } = parseListOptions(queryParameters);
  const parameters = [];
  const scope = taskAccessScope(actor, parameters);
  let filters = '';
  if (status) {
    parameters.push(status);
    filters += ` AND t.status = $${parameters.length}`;
  }
  if (priority) {
    parameters.push(priority);
    filters += ` AND t.priority = $${parameters.length}`;
  }
  if (caseId) {
    parameters.push(caseId);
    filters += ` AND t.case_id = $${parameters.length}`;
  }
  if (search) {
    parameters.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
    const searchParameter = `$${parameters.length}`;
    filters += ` AND (t.title ILIKE ${searchParameter} ESCAPE E'\\\\' OR t.description ILIKE ${searchParameter} ESCAPE E'\\\\')`;
  }

  const countResult = await execute(
    `SELECT COUNT(*)::int AS total FROM tasks t WHERE TRUE ${scope} ${filters}`,
    parameters
  );
  const total = countResult.rows[0].total;
  const resultParameters = [...parameters, pageSize, offset];
  const result = await execute(
    `
      ${TASK_SELECT}
      WHERE TRUE
        ${scope}
        ${filters}
      ORDER BY t.due_at ASC NULLS LAST, t.task_id ASC
      LIMIT $${resultParameters.length - 1}
      OFFSET $${resultParameters.length}
    `,
    resultParameters
  );

  return {
    tasks: result.rows.map(safeTask),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}

export async function getTaskById(actor, taskId) {
  assertActor(actor, ['admin', 'lawyer', 'assistant']);
  validateUuid(taskId, 'taskId');
  const parameters = [taskId];
  const scope = taskAccessScope(actor, parameters);
  const result = await execute(
    `
      ${TASK_SELECT}
      WHERE t.task_id = $1
        ${scope}
      LIMIT 1
    `,
    parameters
  );
  if (!result.rowCount) throw new TaskServiceError(404, 'Task not found.');
  return safeTask(result.rows[0]);
}

export async function createTask(actor, body) {
  assertActor(actor, ['admin']);
  const fields = validateBody(body, CREATE_FIELDS, { create: true });

  const parameters = [
    fields.assigned_to_user_id,
    fields.case_id ?? null,
    actor.user_id,
  ];
  const result = await execute(
    `
      INSERT INTO tasks (
        title,
        description,
        status,
        priority,
        due_at,
        completed_at,
        case_id,
        assigned_to_user_id,
        created_by_user_id
      )
      SELECT
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        lc.case_id,
        assignee.user_id,
        creator.user_id
      FROM app_users assignee
      JOIN roles assignee_role ON assignee_role.role_id = assignee.role_id
      JOIN app_users creator ON creator.user_id = $3
      LEFT JOIN legal_cases lc ON lc.case_id = $2
      WHERE assignee.user_id = $1
        AND assignee.status = 'active'
        AND assignee_role.role_name IN ('lawyer', 'assistant')
        AND ($2::uuid IS NULL OR lc.case_id IS NOT NULL)
        AND (
          $2::uuid IS NULL
          OR EXISTS (
            SELECT 1
            FROM assigned_to assignment
            WHERE assignment.case_id = $2
              AND assignment.user_id = assignee.user_id
          )
        )
      RETURNING task_id
    `,
    [
      ...parameters,
      fields.title,
      fields.description ?? null,
      fields.status ?? 'pending',
      fields.priority ?? 'medium',
      fields.due_at ?? null,
      fields.completed_at ?? null,
    ]
  );
  if (!result.rowCount) {
    throw new TaskServiceError(404, 'Eligible assignee or case not found.');
  }
  return getTaskById(actor, result.rows[0].task_id);
}

export async function updateTask(actor, taskId, body) {
  assertActor(actor, ['admin', 'lawyer', 'assistant']);
  validateUuid(taskId, 'taskId');
  const fields = validateBody(body, BODY_FIELDS);
  const entries = Object.entries(fields);
  const parameters = entries.map(([, value]) => value);
  const assignments = entries.map(([field], index) => `${field} = $${index + 1}`);
  parameters.push(taskId);
  const scope = taskAccessScope(actor, parameters);
  const taskIdParameter = `$${entries.length + 1}`;

  const result = await execute(
    `
      UPDATE tasks AS t
      SET ${assignments.join(', ')}
      WHERE t.task_id = ${taskIdParameter}
        ${scope}
      RETURNING t.task_id
    `,
    parameters
  );
  if (!result.rowCount) throw new TaskServiceError(404, 'Task not found.');
  return getTaskById(actor, result.rows[0].task_id);
}
