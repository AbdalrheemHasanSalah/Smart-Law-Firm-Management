import { pool, query } from '../config/db.js';
import { hasOfficeContext } from './officeScope.js';

const USER_ROLES = new Set(['admin', 'lawyer', 'assistant', 'client']);
const USER_STATUSES = new Set(['active', 'suspended']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export class UserServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'UserServiceError';
    this.status = status;
  }
}

function invalid(message) {
  throw new UserServiceError(400, message);
}

function assertAdministrator(actor) {
  if (
    actor?.role !== 'admin'
    || typeof actor.user_id !== 'string'
    || !UUID_PATTERN.test(actor.user_id)
    || !hasOfficeContext(actor)
  ) {
    throw new UserServiceError(403, 'You do not have permission to access this resource.');
  }
}

function validateUserId(userId) {
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) {
    invalid('userId must be a valid UUID.');
  }
  return userId;
}

function validateBody(body, allowedFields) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    invalid('Request body must be a JSON object.');
  }

  const fields = Object.keys(body);
  if (fields.length !== 1 || !allowedFields.has(fields[0])) {
    invalid('Request must contain exactly one supported field.');
  }

  return body[fields[0]];
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
  const allowedParameters = new Set(['page', 'pageSize', 'search', 'role', 'status']);
  if (Object.keys(queryParameters).some((key) => !allowedParameters.has(key))) {
    invalid('Unsupported user-list query parameter.');
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

  const role = queryParameters.role;
  if (role !== undefined && !USER_ROLES.has(role)) {
    invalid('role is not supported.');
  }

  const status = queryParameters.status;
  if (status !== undefined && !USER_STATUSES.has(status)) {
    invalid('status is not supported.');
  }

  return { page, pageSize, search, role, status, offset };
}

function publicUser(row) {
  if (!row) return null;

  const user = {
    user_id: row.user_id,
    full_name: row.full_name,
    email: row.email,
    email_verified: row.email_verified,
    status: row.status,
    account_status: row.account_status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    role: row.role,
  };

  if (row.lawyer_profile_id) {
    user.lawyer_profile = {
      lawyer_profile_id: row.lawyer_profile_id,
      bar_number: row.bar_number,
      specialty: row.specialty,
      years_experience: row.years_experience,
      license_status: row.license_status,
    };
  } else {
    user.lawyer_profile = null;
  }

  return user;
}

function buildFilters({ search, role, status }, initialParameters = []) {
  const conditions = [];
  const parameters = [...initialParameters];

  if (search) {
    parameters.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
    const searchParameter = `$${parameters.length}`;
    conditions.push(`(u.full_name ILIKE ${searchParameter} ESCAPE E'\\\\' OR u.email ILIKE ${searchParameter} ESCAPE E'\\\\')`);
  }
  if (role) {
    parameters.push(role);
    conditions.push(`r.role_name = $${parameters.length}`);
  }
  if (status) {
    parameters.push(status);
    conditions.push(`membership.status = $${parameters.length}`);
  }

  return {
    parameters,
    clause: conditions.length ? `AND ${conditions.join(' AND ')}` : '',
  };
}

function userSelectSql(whereClause) {
  return `
    SELECT
      u.user_id,
      u.full_name,
      u.email,
      u.email_verified,
      membership.status,
      u.status AS account_status,
      membership.created_at,
      membership.updated_at,
      r.role_name AS role,
      lp.lawyer_profile_id,
      lp.bar_number,
      lp.specialty,
      lp.years_experience,
      lp.license_status
    FROM office_memberships membership
    JOIN app_users u ON u.user_id = membership.user_id
    JOIN roles r ON r.role_id = membership.role_id
    LEFT JOIN lawyer_profiles lp ON lp.user_id = u.user_id
    ${whereClause}
  `;
}

export async function listUsers(actor, queryParameters = {}) {
  assertAdministrator(actor);
  const options = parseListOptions(queryParameters);
  const { parameters, clause } = buildFilters(options, [actor.office_id]);

  const countResult = await query(
    `
      SELECT COUNT(*)::int AS total
      FROM office_memberships membership
      JOIN app_users u ON u.user_id = membership.user_id
      JOIN roles r ON r.role_id = membership.role_id
      WHERE membership.office_id = $1
      ${clause}
    `,
    parameters
  );
  const pageParameters = [...parameters, options.pageSize, options.offset];
  const listResult = await query(
    `${userSelectSql(`WHERE membership.office_id = $1 ${clause}`)}
      ORDER BY membership.created_at DESC, u.user_id ASC
      LIMIT $${pageParameters.length - 1}
      OFFSET $${pageParameters.length}
    `,
    pageParameters
  );
  const total = countResult.rows[0].total;

  return {
    users: listResult.rows.map(publicUser),
    pagination: {
      page: options.page,
      pageSize: options.pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / options.pageSize),
    },
  };
}

export async function getUserById(actor, userId) {
  assertAdministrator(actor);
  validateUserId(userId);
  const result = await query(
    `${userSelectSql('WHERE u.user_id = $1 AND membership.office_id = $2')} LIMIT 1`,
    [userId, actor.office_id]
  );

  if (!result.rowCount) {
    throw new UserServiceError(404, 'User not found.');
  }
  return publicUser(result.rows[0]);
}

export async function updateUserRole(actor, userId, body) {
  assertAdministrator(actor);
  validateUserId(userId);
  const role = validateBody(body, new Set(['role']));
  if (typeof role !== 'string' || !USER_ROLES.has(role)) {
    invalid('role must be admin, lawyer, assistant, or client.');
  }
  if (actor.user_id?.toLowerCase() === userId.toLowerCase()) {
    throw new UserServiceError(400, 'Administrators cannot change their own role.');
  }

  const result = await query(
    `
      UPDATE office_memberships AS membership
      SET role_id = r.role_id, updated_at = NOW()
      FROM roles AS r
      WHERE membership.user_id = $1
        AND membership.office_id = $3
        AND r.role_name = $2
      RETURNING membership.user_id
    `,
    [userId, role, actor.office_id]
  );

  if (!result.rowCount) {
    const exists = await query(
      'SELECT 1 FROM office_memberships WHERE user_id = $1 AND office_id = $2',
      [userId, actor.office_id]
    );
    if (!exists.rowCount) {
      throw new UserServiceError(404, 'User not found.');
    }
    throw new UserServiceError(500, 'The requested role is not configured.');
  }

  return getUserById(actor, userId);
}

export async function updateUserStatus(actor, userId, body) {
  assertAdministrator(actor);
  validateUserId(userId);
  const status = validateBody(body, new Set(['status']));
  if (typeof status !== 'string' || !USER_STATUSES.has(status)) {
    invalid('status must be active or suspended.');
  }
  if (
    actor.user_id?.toLowerCase() === userId.toLowerCase()
    && status !== 'active'
  ) {
    throw new UserServiceError(400, 'Administrators cannot deactivate or suspend their own account.');
  }

  let client;
  let transactionStarted = false;
  let releaseError;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;

    const accountResult = await client.query(
      `SELECT membership.status, u.auth_user_id
         FROM office_memberships membership
         JOIN app_users u ON u.user_id = membership.user_id
        WHERE membership.user_id = $1 AND membership.office_id = $2
        FOR UPDATE OF membership`,
      [userId, actor.office_id]
    );
    if (!accountResult.rowCount) {
      throw new UserServiceError(404, 'User not found.');
    }

    const result = await client.query(
      `
        UPDATE office_memberships
        SET status = $2, updated_at = NOW()
        WHERE user_id = $1 AND office_id = $3
        RETURNING user_id
      `,
      [userId, status, actor.office_id]
    );
    if (!result.rowCount) {
      throw new UserServiceError(404, 'User not found.');
    }

    // A suspended member loses this office from every open session immediately.
    if (status !== 'active' && accountResult.rows[0].auth_user_id) {
      await client.query(
        'UPDATE sessions SET active_office_id = NULL WHERE user_id = $1 AND active_office_id = $2',
        [accountResult.rows[0].auth_user_id, actor.office_id]
      );
    }

    await client.query('COMMIT');
    transactionStarted = false;
  } catch (error) {
    let reportedError = error;
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
        transactionStarted = false;
      } catch (rollbackError) {
        releaseError = rollbackError;
        console.error('Account status rollback failed.', {
          name: typeof rollbackError?.name === 'string' ? rollbackError.name : 'Error',
          code: typeof rollbackError?.code === 'string' ? rollbackError.code : undefined,
        });
        reportedError = new UserServiceError(
          500,
          'Unable to safely roll back the account status change.'
        );
      }
    } else if (client) {
      releaseError = error;
    }
    throw reportedError;
  } finally {
    client?.release(releaseError);
  }

  return getUserById(actor, userId);
}
