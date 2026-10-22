import { pool, query } from '../config/db.js';

const CLIENT_FIELDS = [
  'client_id',
  'client_type',
  'full_name_or_org',
  'phone',
  'email',
  'address',
  'created_at',
];
const CLIENT_FIELD_SET = new Set([
  'client_type',
  'full_name_or_org',
  'phone',
  'email',
  'address',
]);
const CONTACT_FIELD_SET = new Set(['phone', 'email', 'address']);
const CLIENT_TYPES = new Set(['individual', 'organization']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
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

export class ClientServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ClientServiceError';
    this.status = status;
  }
}

function invalid(message) {
  throw new ClientServiceError(400, message);
}

function validateObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('Request body must be a JSON object.');
  }
}

function validateAndNormalizeFields(body, { selfService = false, create = false } = {}) {
  validateObject(body);
  const allowedFields = selfService ? CONTACT_FIELD_SET : CLIENT_FIELD_SET;
  const unknownFields = Object.keys(body).filter((field) => !allowedFields.has(field));

  if (unknownFields.length) {
    invalid('Request contains unsupported fields.');
  }

  if (create && (!Object.hasOwn(body, 'client_type') || !Object.hasOwn(body, 'full_name_or_org'))) {
    invalid('client_type and full_name_or_org are required.');
  }

  if (!create && Object.keys(body).length === 0) {
    invalid('At least one permitted field is required.');
  }

  const fields = {};
  if (Object.hasOwn(body, 'client_type')) {
    if (!CLIENT_TYPES.has(body.client_type)) {
      invalid('client_type must be individual or organization.');
    }
    fields.client_type = body.client_type;
  }

  if (Object.hasOwn(body, 'full_name_or_org')) {
    if (typeof body.full_name_or_org !== 'string') {
      invalid('full_name_or_org must be a string.');
    }
    const name = body.full_name_or_org.trim();
    if (!name || name.length > 200) {
      invalid('full_name_or_org must contain 1 to 200 characters.');
    }
    fields.full_name_or_org = name;
  }

  if (Object.hasOwn(body, 'phone')) {
    if (body.phone === null) {
      fields.phone = null;
    } else {
      if (typeof body.phone !== 'string') {
        invalid('phone must be a string or null.');
      }
      const phone = body.phone.trim();
      const digitCount = (phone.match(/\d/g) || []).length;
      if (
        phone.length > 30 ||
        (phone && (!/^[+()\d.\-\s]+$/.test(phone) || digitCount < 3))
      ) {
        invalid('phone must contain at most 30 valid phone characters.');
      }
      fields.phone = phone || null;
    }
  }

  if (Object.hasOwn(body, 'email')) {
    if (body.email === null) {
      fields.email = null;
    } else {
      if (typeof body.email !== 'string') {
        invalid('email must be a string or null.');
      }
      const email = body.email.trim();
      if (
        email.length > 254 ||
        (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      ) {
        invalid('email must be a valid address of at most 254 characters.');
      }
      fields.email = email || null;
    }
  }

  if (Object.hasOwn(body, 'address')) {
    if (body.address === null) {
      fields.address = null;
    } else {
      if (typeof body.address !== 'string') {
        invalid('address must be a string or null.');
      }
      const address = body.address.trim();
      if (address.length > 5000) {
        invalid('address must contain at most 5000 characters.');
      }
      fields.address = address || null;
    }
  }

  return fields;
}

export function validateClientId(clientId) {
  if (typeof clientId !== 'string' || !UUID_PATTERN.test(clientId)) {
    invalid('clientId must be a valid UUID.');
  }
  return clientId;
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
    invalid('Unsupported client-list query parameter.');
  }

  const page = parsePositiveInteger(queryParameters.page, 1, 'page');
  const requestedPageSize = parsePositiveInteger(
    queryParameters.pageSize,
    DEFAULT_PAGE_SIZE,
    'pageSize'
  );
  const pageSize = Math.min(requestedPageSize, MAX_PAGE_SIZE);
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) {
    invalid('page is too large.');
  }

  let search = '';
  if (queryParameters.search !== undefined) {
    if (typeof queryParameters.search !== 'string') {
      invalid('search must be a string.');
    }
    search = queryParameters.search.trim();
    if (search.length > 100) {
      invalid('search must contain at most 100 characters.');
    }
  }

  return {
    page,
    pageSize,
    search,
    offset,
  };
}

function assertRole(actor, roles) {
  if (!actor || !roles.includes(actor.role)) {
    throw new ClientServiceError(403, 'You do not have permission to access this resource.');
  }
}

function staffScope(actor, parameters) {
  if (actor.role !== 'lawyer' && actor.role !== 'assistant') {
    return '';
  }

  if (typeof actor.user_id !== 'string' || !UUID_PATTERN.test(actor.user_id)) {
    throw new ClientServiceError(403, 'You do not have permission to access this resource.');
  }

  parameters.push(actor.user_id);
  return `
    AND EXISTS (
      SELECT 1
      FROM involves i
      JOIN assigned_to assignment ON assignment.case_id = i.case_id
      WHERE i.client_id = c.client_id
        AND assignment.user_id = $${parameters.length}
    )
  `;
}

function publicClient(row) {
  if (!row) return null;
  return Object.fromEntries(CLIENT_FIELDS.map((field) => [field, row[field]]));
}

function publicCase(row) {
  return Object.fromEntries(CASE_FIELDS.map((field) => [field, row[field]]));
}

function handleDatabaseError(error) {
  if (error?.code === '23505') {
    throw new ClientServiceError(409, 'A client record conflicts with existing data.');
  }
  if (error?.code === '23503' || error?.code === '23514' || error?.code === '22001') {
    throw new ClientServiceError(400, 'Client data violates a database constraint.');
  }
  throw error;
}

async function execute(text, parameters) {
  try {
    return await query(text, parameters);
  } catch (error) {
    return handleDatabaseError(error);
  }
}

export async function listClients(actor, queryParameters) {
  assertRole(actor, ['admin', 'lawyer', 'assistant']);
  const { page, pageSize, search, offset } = parseListOptions(queryParameters);
  const parameters = [];
  const scope = staffScope(actor, parameters);
  let searchClause = '';

  if (search) {
    parameters.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
    const searchParameter = `$${parameters.length}`;
    searchClause = `
      AND (
        c.full_name_or_org ILIKE ${searchParameter} ESCAPE E'\\\\'
        OR c.email ILIKE ${searchParameter} ESCAPE E'\\\\'
      )
    `;
  }

  const countResult = await execute(
    `
      SELECT COUNT(*)::int AS total
      FROM clients c
      WHERE TRUE
      ${scope}
      ${searchClause}
    `,
    parameters
  );

  const total = countResult.rows[0].total;
  const pageParameters = [...parameters, pageSize, offset];
  const listResult = await execute(
    `
      SELECT
        c.client_id,
        c.client_type,
        c.full_name_or_org,
        c.phone,
        c.email,
        c.address,
        c.created_at
      FROM clients c
      WHERE TRUE
      ${scope}
      ${searchClause}
      ORDER BY c.created_at DESC, c.client_id ASC
      LIMIT $${pageParameters.length - 1}
      OFFSET $${pageParameters.length}
    `,
    pageParameters
  );

  return {
    clients: listResult.rows.map(publicClient),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}

export async function getClientById(actor, clientId) {
  assertRole(actor, ['admin', 'lawyer', 'assistant']);
  validateClientId(clientId);
  const parameters = [clientId];
  const scope = staffScope(actor, parameters);
  const result = await execute(
    `
      SELECT
        c.client_id,
        c.client_type,
        c.full_name_or_org,
        c.phone,
        c.email,
        c.address,
        c.created_at
      FROM clients c
      WHERE c.client_id = $1
      ${scope}
      LIMIT 1
    `,
    parameters
  );

  if (!result.rowCount) {
    throw new ClientServiceError(404, 'Client not found.');
  }
  return publicClient(result.rows[0]);
}

export async function listClientCases(actor, clientId, queryParameters = {}) {
  validateClientId(clientId);
  assertRole(actor, ['admin', 'lawyer', 'assistant', 'client']);

  const { page, pageSize, search, offset } = parseListOptions(queryParameters);
  const parameters = [clientId];
  let accessClause = '';

  if (actor.role === 'client') {
    if (typeof actor.user_id !== 'string' || !UUID_PATTERN.test(actor.user_id)) {
      throw new ClientServiceError(403, 'You do not have permission to access this resource.');
    }
    parameters.push(actor.user_id);
    accessClause = `AND c.user_id = $${parameters.length}`;
  } else if (actor.role === 'lawyer' || actor.role === 'assistant') {
    if (typeof actor.user_id !== 'string' || !UUID_PATTERN.test(actor.user_id)) {
      throw new ClientServiceError(403, 'You do not have permission to access this resource.');
    }
    parameters.push(actor.user_id);
    accessClause = `
      AND EXISTS (
        SELECT 1
        FROM assigned_to assignment
        WHERE assignment.case_id = i.case_id
          AND assignment.user_id = $${parameters.length}
      )
    `;
  }

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

  const countResult = await execute(
    `
      SELECT COUNT(*)::int AS total
      FROM involves i
      JOIN clients c ON c.client_id = i.client_id
      JOIN legal_cases lc ON lc.case_id = i.case_id
      WHERE i.client_id = $1
      ${accessClause}
      ${searchClause}
    `,
    parameters
  );

  const total = countResult.rows[0].total;
  const pageParameters = [...parameters, pageSize, offset];
  const listResult = await execute(
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
      FROM involves i
      JOIN clients c ON c.client_id = i.client_id
      JOIN legal_cases lc ON lc.case_id = i.case_id
      WHERE i.client_id = $1
      ${accessClause}
      ${searchClause}
      ORDER BY lc.opened_at DESC, lc.case_id ASC
      LIMIT $${pageParameters.length - 1}
      OFFSET $${pageParameters.length}
    `,
    pageParameters
  );

  if (!total) {
    let clientAccessClause = '';
    const clientAccessParameters = [clientId];
    if (actor.role === 'client') {
      clientAccessParameters.push(actor.user_id);
      clientAccessClause = 'AND user_id = $2';
    } else if (actor.role === 'lawyer' || actor.role === 'assistant') {
      clientAccessParameters.push(actor.user_id);
      clientAccessClause = `
        AND EXISTS (
          SELECT 1
          FROM involves linked_case
          JOIN assigned_to assignment
            ON assignment.case_id = linked_case.case_id
          WHERE linked_case.client_id = clients.client_id
            AND assignment.user_id = $2
        )
      `;
    }
    const clientResult = await execute(
      `SELECT 1 FROM clients WHERE client_id = $1 ${clientAccessClause} LIMIT 1`,
      clientAccessParameters
    );
    if (!clientResult.rowCount) {
      throw new ClientServiceError(404, 'Client not found.');
    }
  }

  return {
    cases: listResult.rows.map(publicCase),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}

export async function createClient(actor, body) {
  assertRole(actor, ['admin']);
  const fields = validateAndNormalizeFields(body, { create: true });
  const result = await execute(
    `
      INSERT INTO clients (
        client_type,
        full_name_or_org,
        phone,
        email,
        address
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
        client_id,
        client_type,
        full_name_or_org,
        phone,
        email,
        address,
        created_at
    `,
    [
      fields.client_type,
      fields.full_name_or_org,
      fields.phone ?? null,
      fields.email ?? null,
      fields.address ?? null,
    ]
  );

  return publicClient(result.rows[0]);
}

export async function linkClientAccount(actor, clientId, body) {
  assertRole(actor, ['admin']);
  if (typeof actor.user_id !== 'string' || !UUID_PATTERN.test(actor.user_id)) {
    throw new ClientServiceError(403, 'You do not have permission to access this resource.');
  }
  validateClientId(clientId);
  validateObject(body);
  if (
    Object.keys(body).length !== 1
    || !Object.hasOwn(body, 'user_id')
    || typeof body.user_id !== 'string'
    || !UUID_PATTERN.test(body.user_id)
  ) {
    invalid('Request must contain only a valid user_id.');
  }

  const userId = body.user_id;
  let client;
  let transactionStarted = false;
  let releaseError;

  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;

    const clientResult = await client.query(
      'SELECT client_id, user_id FROM clients WHERE client_id = $1 FOR UPDATE',
      [clientId]
    );
    if (!clientResult.rowCount) {
      throw new ClientServiceError(404, 'Client not found.');
    }
    if (clientResult.rows[0].user_id !== null) {
      throw new ClientServiceError(409, 'Client record is already linked.');
    }

    const userResult = await client.query(
      `SELECT u.user_id
       FROM app_users u
       JOIN roles r ON r.role_id = u.role_id
       WHERE u.user_id = $1
         AND r.role_name = 'client'
         AND u.status = 'active'
         AND u.auth_user_id IS NOT NULL
       FOR UPDATE OF u`,
      [userId]
    );
    if (!userResult.rowCount) {
      throw new ClientServiceError(404, 'Eligible client account not found.');
    }

    const existingLink = await client.query(
      'SELECT client_id FROM clients WHERE user_id = $1 AND client_id <> $2 LIMIT 1',
      [userId, clientId]
    );
    if (existingLink.rowCount) {
      throw new ClientServiceError(409, 'Application user is already linked to another client.');
    }

    let linked;
    try {
      linked = await client.query(
        `UPDATE clients
         SET user_id = $2
         WHERE client_id = $1 AND user_id IS NULL
         RETURNING client_id, user_id`,
        [clientId, userId]
      );
    } catch (error) {
      if (error?.code === '23505' && error.constraint === 'clients_user_id_key') {
        throw new ClientServiceError(409, 'Application user is already linked to another client.');
      }
      throw error;
    }
    if (!linked.rowCount) {
      throw new ClientServiceError(409, 'Client record is already linked.');
    }

    const auditResult = await client.query(
      `INSERT INTO audit_logs (action, entity_type, entity_id, details, user_id)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [
        'client_account_linked',
        'client',
        clientId,
        JSON.stringify({ linked_user_id: userId }),
        actor.user_id,
      ]
    );
    if (auditResult.rowCount !== 1) {
      throw new Error('Client account link audit record was not inserted.');
    }
    await client.query('COMMIT');
    transactionStarted = false;

    return {
      client_id: linked.rows[0].client_id,
      user_id: linked.rows[0].user_id,
      linked: true,
    };
  } catch (error) {
    let reportedError = error;
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
        transactionStarted = false;
      } catch (rollbackError) {
        releaseError = rollbackError;
        console.error('Client account link rollback failed.', {
          name: typeof rollbackError?.name === 'string' ? rollbackError.name : 'Error',
          code: typeof rollbackError?.code === 'string' ? rollbackError.code : undefined,
        });
        reportedError = new ClientServiceError(
          500,
          'Unable to safely roll back the client account link.'
        );
      }
    } else if (client) {
      releaseError = error;
    }
    throw reportedError;
  } finally {
    client?.release(releaseError);
  }
}

async function updateClientFields(actor, clientId, body, { selfService = false } = {}) {
  validateClientId(clientId);
  assertRole(actor, selfService ? ['client'] : ['admin', 'lawyer', 'assistant']);
  const fields = validateAndNormalizeFields(body, { selfService });
  const entries = Object.entries(fields);
  const parameters = entries.map(([, value]) => value);
  const assignments = entries.map(
    ([field], index) => `${field} = $${index + 1}`
  );
  parameters.push(clientId);
  let where = `c.client_id = $${parameters.length}`;

  if (selfService) {
    parameters.push(actor.user_id);
    where += ` AND c.user_id = $${parameters.length}`;
  } else {
    where += staffScope(actor, parameters);
  }

  const result = await execute(
    `
      UPDATE clients c
      SET ${assignments.join(', ')}
      WHERE ${where}
      RETURNING
        c.client_id,
        c.client_type,
        c.full_name_or_org,
        c.phone,
        c.email,
        c.address,
        c.created_at
    `,
    parameters
  );

  if (!result.rowCount) {
    throw new ClientServiceError(404, 'Client not found.');
  }
  return publicClient(result.rows[0]);
}

export function updateClient(actor, clientId, body) {
  return updateClientFields(actor, clientId, body);
}

export async function getOwnClient(actor) {
  assertRole(actor, ['client']);
  const result = await execute(
    `
      SELECT
        c.client_id,
        c.client_type,
        c.full_name_or_org,
        c.phone,
        c.email,
        c.address,
        c.created_at
      FROM clients c
      WHERE c.user_id = $1
      LIMIT 1
    `,
    [actor.user_id]
  );

  if (!result.rowCount) {
    throw new ClientServiceError(404, 'Client profile not found.');
  }
  return publicClient(result.rows[0]);
}

export async function updateOwnClient(actor, body) {
  assertRole(actor, ['client']);
  const fields = validateAndNormalizeFields(body, { selfService: true });
  const entries = Object.entries(fields);
  const parameters = entries.map(([, value]) => value);
  const assignments = entries.map(
    ([field], index) => `${field} = $${index + 1}`
  );
  parameters.push(actor.user_id);
  const result = await execute(
    `
      UPDATE clients c
      SET ${assignments.join(', ')}
      WHERE c.user_id = $${parameters.length}
      RETURNING
        c.client_id,
        c.client_type,
        c.full_name_or_org,
        c.phone,
        c.email,
        c.address,
        c.created_at
    `,
    parameters
  );

  if (!result.rowCount) {
    throw new ClientServiceError(404, 'Client profile not found.');
  }
  return publicClient(result.rows[0]);
}
