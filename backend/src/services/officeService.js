import { pool, query } from '../config/db.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[+()\d.\-\s]+$/;
const OFFICE_FIELDS = new Set(['name', 'email', 'phone', 'city', 'address', 'license_number']);
const LAWYER_FIELDS = new Set(['bar_number', 'specialty', 'years_experience']);
const MAX_PENDING_REGISTRATIONS = 1;

export class OfficeServiceError extends Error {
  constructor(status, message, publicCode) {
    super(message);
    this.name = 'OfficeServiceError';
    this.status = status;
    if (publicCode) this.publicCode = publicCode;
  }
}

function invalid(message) {
  throw new OfficeServiceError(400, message, 'VALIDATION');
}

function assertAccount(account) {
  if (typeof account?.user_id !== 'string' || !UUID_PATTERN.test(account.user_id)) {
    throw new OfficeServiceError(401, 'Authentication required.', 'UNAUTHORIZED');
  }
}

function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${name} must be a JSON object.`);
  }
}

function requiredText(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    invalid(`${field} must contain 1 to ${maxLength} characters.`);
  }
  return value.trim();
}

function optionalText(value, field, maxLength) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.trim().length > maxLength) {
    invalid(`${field} must be a string of at most ${maxLength} characters.`);
  }
  return value.trim() || null;
}

function validateOffice(body) {
  assertObject(body, 'office');
  if (Object.keys(body).some((field) => !OFFICE_FIELDS.has(field))) {
    invalid('office contains unsupported fields.');
  }
  const office = {
    name: requiredText(body.name, 'office.name', 200),
    email: optionalText(body.email, 'office.email', 254),
    phone: requiredText(body.phone, 'office.phone', 30),
    city: requiredText(body.city, 'office.city', 100),
    address: optionalText(body.address, 'office.address', 2000),
    license_number: optionalText(body.license_number, 'office.license_number', 100),
  };
  if (office.email && !EMAIL_PATTERN.test(office.email)) invalid('office.email must be a valid address.');
  if (!PHONE_PATTERN.test(office.phone) || (office.phone.match(/\d/g) || []).length < 6) {
    invalid('office.phone must be a valid phone number.');
  }
  return office;
}

function validateLawyer(body) {
  assertObject(body, 'lawyer');
  if (Object.keys(body).some((field) => !LAWYER_FIELDS.has(field))) {
    invalid('lawyer contains unsupported fields.');
  }
  const years = body.years_experience;
  if (years !== undefined && years !== null && (!Number.isInteger(years) || years < 0 || years > 70)) {
    invalid('lawyer.years_experience must be a whole number between 0 and 70.');
  }
  return {
    bar_number: requiredText(body.bar_number, 'lawyer.bar_number', 50),
    specialty: optionalText(body.specialty, 'lawyer.specialty', 100),
    years_experience: years ?? null,
  };
}

export function validateRegistration(body) {
  assertObject(body, 'Request body');
  if (Object.keys(body).some((field) => field !== 'office' && field !== 'lawyer')) {
    invalid('Request contains unsupported fields.');
  }
  return { office: validateOffice(body.office), lawyer: validateLawyer(body.lawyer) };
}

function publicMembership(row) {
  return {
    office_id: row.office_id,
    office_name: row.office_name,
    office_status: row.office_status,
    office_city: row.office_city,
    role: row.role,
    membership_status: row.membership_status,
    is_owner: row.is_owner,
  };
}

async function rollbackQuietly(client) {
  try {
    await client.query('ROLLBACK');
  } catch (rollbackError) {
    console.error('Office transaction rollback failed.', {
      code: typeof rollbackError?.code === 'string' ? rollbackError.code : undefined,
    });
    return rollbackError;
  }
  return undefined;
}

/**
 * Registers a new office owned by the signed-in account. The office starts as `pending` and
 * grants no data access until a platform administrator approves it.
 */
export async function registerOffice(account, body) {
  assertAccount(account);
  const { office, lawyer } = validateRegistration(body);

  const client = await pool.connect();
  let releaseError;
  try {
    await client.query('BEGIN');

    const pending = await client.query(
      `SELECT COUNT(*)::int AS total
         FROM law_offices
        WHERE created_by_user_id = $1 AND status = 'pending'`,
      [account.user_id]
    );
    if (pending.rows[0].total >= MAX_PENDING_REGISTRATIONS) {
      throw new OfficeServiceError(
        409,
        'An office registration is already awaiting review.',
        'REGISTRATION_PENDING'
      );
    }

    const profile = await client.query(
      'SELECT bar_number FROM lawyer_profiles WHERE user_id = $1 FOR UPDATE',
      [account.user_id]
    );
    if (profile.rowCount && profile.rows[0].bar_number !== lawyer.bar_number) {
      throw new OfficeServiceError(
        409,
        'The bar number does not match the lawyer profile on this account.',
        'BAR_NUMBER_MISMATCH'
      );
    }
    if (!profile.rowCount) {
      await client.query(
        `INSERT INTO lawyer_profiles (bar_number, specialty, years_experience, user_id)
         VALUES ($1, $2, $3, $4)`,
        [lawyer.bar_number, lawyer.specialty, lawyer.years_experience, account.user_id]
      );
    }

    const created = await client.query(
      `INSERT INTO law_offices (name, email, phone, city, address, license_number, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING office_id, name, status, created_at`,
      [office.name, office.email, office.phone, office.city, office.address,
        office.license_number, account.user_id]
    );
    const officeId = created.rows[0].office_id;

    await client.query(
      `INSERT INTO office_memberships (office_id, user_id, role_id, is_owner)
       SELECT $1, $2, role_id, TRUE FROM roles WHERE role_name = 'admin'`,
      [officeId, account.user_id]
    );
    await client.query(
      `INSERT INTO audit_logs (action, entity_type, entity_id, user_id, office_id)
       VALUES ('office_registered', 'law_office', $1, $2, $1)`,
      [officeId, account.user_id]
    );

    await client.query('COMMIT');
    return {
      office_id: officeId,
      name: created.rows[0].name,
      status: created.rows[0].status,
      created_at: created.rows[0].created_at,
    };
  } catch (error) {
    releaseError = await rollbackQuietly(client);
    if (error?.code === '23505' && error.constraint === 'lawyer_profiles_bar_number_key') {
      throw new OfficeServiceError(409, 'This bar number is already registered.', 'BAR_NUMBER_TAKEN');
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

export async function listMemberships(account) {
  assertAccount(account);
  const result = await query(
    `SELECT
        office.office_id,
        office.name AS office_name,
        office.status AS office_status,
        office.city AS office_city,
        r.role_name AS role,
        membership.status AS membership_status,
        membership.is_owner
       FROM office_memberships membership
       JOIN law_offices office ON office.office_id = membership.office_id
       JOIN roles r ON r.role_id = membership.role_id
      WHERE membership.user_id = $1
      ORDER BY office.name, office.office_id`,
    [account.user_id]
  );
  return result.rows.map(publicMembership);
}

/**
 * Stores the chosen office on the server-side session after re-checking membership. The
 * office ID from the request body is never trusted on its own.
 */
export async function selectActiveOffice(account, sessionId, body) {
  assertAccount(account);
  assertObject(body, 'Request body');
  if (Object.keys(body).length !== 1 || typeof body.office_id !== 'string'
    || !UUID_PATTERN.test(body.office_id)) {
    invalid('Request must contain only a valid office_id.');
  }
  if (typeof sessionId !== 'string' || !sessionId) {
    throw new OfficeServiceError(401, 'Authentication required.', 'UNAUTHORIZED');
  }

  const membership = await query(
    `SELECT office.status AS office_status, membership.status AS membership_status
       FROM office_memberships membership
       JOIN law_offices office ON office.office_id = membership.office_id
      WHERE membership.office_id = $1 AND membership.user_id = $2`,
    [body.office_id, account.user_id]
  );
  // A non-member gets the same answer as an unknown office, so office IDs cannot be probed.
  if (!membership.rowCount) {
    throw new OfficeServiceError(404, 'Office not found.', 'NOT_FOUND');
  }
  const { office_status: officeStatus, membership_status: membershipStatus } = membership.rows[0];
  if (membershipStatus !== 'active') {
    throw new OfficeServiceError(403, 'Your access to this office is suspended.', 'MEMBERSHIP_SUSPENDED');
  }
  if (officeStatus !== 'active') {
    throw new OfficeServiceError(403, 'This office is not active.', officeStatus === 'pending'
      ? 'OFFICE_PENDING'
      : 'OFFICE_INACTIVE');
  }

  await query(
    'UPDATE sessions SET active_office_id = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
    [body.office_id, sessionId, account.auth_user_id]
  );
  return { office_id: body.office_id };
}

export async function clearActiveOffice(account, sessionId) {
  assertAccount(account);
  await query(
    'UPDATE sessions SET active_office_id = NULL, updated_at = NOW() WHERE id = $1 AND user_id = $2',
    [sessionId, account.auth_user_id]
  );
}
