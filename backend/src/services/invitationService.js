import { createHash, randomBytes } from 'node:crypto';

import { pool, query } from '../config/db.js';
import { getSecurityConfig } from '../config/security.js';
import { hasOfficeContext } from './officeScope.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const INVITABLE_ROLES = new Set(['lawyer', 'assistant', 'client']);
const INVITATION_TTL_DAYS = 7;
const INVITATION_FIELDS = new Set(['email', 'role', 'client_id']);
const ACCEPT_FIELDS = new Set(['bar_number', 'specialty', 'years_experience']);

export class InvitationServiceError extends Error {
  constructor(status, message, publicCode) {
    super(message);
    this.name = 'InvitationServiceError';
    this.status = status;
    if (publicCode) this.publicCode = publicCode;
  }
}

function invalid(message) {
  throw new InvitationServiceError(400, message, 'VALIDATION');
}

function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function validateToken(token) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
    throw new InvitationServiceError(404, 'Invitation not found.', 'INVITATION_INVALID');
  }
  return token;
}

function assertOfficeAdmin(actor) {
  if (actor?.role !== 'admin' || !hasOfficeContext(actor)) {
    throw new InvitationServiceError(403, 'You do not have permission to access this resource.', 'FORBIDDEN');
  }
}

function normalizeEmail(value) {
  if (typeof value !== 'string') invalid('email must be a valid address.');
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    invalid('email must be a valid address.');
  }
  return email;
}

function invitationState(row) {
  if (row.revoked_at) return 'revoked';
  if (row.accepted_at) return 'accepted';
  if (new Date(row.expires_at).getTime() <= Date.now()) return 'expired';
  return 'pending';
}

function publicInvitation(row) {
  return {
    invitation_id: row.invitation_id,
    email: row.email,
    role: row.role,
    client_id: row.client_id,
    state: invitationState(row),
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}

/** Shows only enough of the address for the invitee to recognise it. */
function maskEmail(email) {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}${'•'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

function invitationUrl(token) {
  const [origin] = getSecurityConfig().trustedOrigins;
  return `${origin}/invite/${token}`;
}

export async function createInvitation(actor, body) {
  assertOfficeAdmin(actor);
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Request body must be a JSON object.');
  if (Object.keys(body).some((field) => !INVITATION_FIELDS.has(field))) {
    invalid('Request contains unsupported fields.');
  }
  const email = normalizeEmail(body.email);
  if (!INVITABLE_ROLES.has(body.role)) invalid('role must be lawyer, assistant, or client.');
  const clientId = body.client_id ?? null;
  if (clientId !== null) {
    if (body.role !== 'client') invalid('client_id can only be used with the client role.');
    if (typeof clientId !== 'string' || !UUID_PATTERN.test(clientId)) invalid('client_id must be a valid UUID.');
    const record = await query(
      'SELECT user_id FROM clients WHERE client_id = $1 AND office_id = $2',
      [clientId, actor.office_id]
    );
    if (!record.rowCount) throw new InvitationServiceError(404, 'Client not found.', 'NOT_FOUND');
    if (record.rows[0].user_id !== null) {
      throw new InvitationServiceError(409, 'This client record already has an account.', 'CLIENT_ALREADY_LINKED');
    }
  }

  const member = await query(
    `SELECT 1
       FROM office_memberships membership
       JOIN app_users u ON u.user_id = membership.user_id
      WHERE membership.office_id = $1 AND lower(u.email) = $2`,
    [actor.office_id, email]
  );
  if (member.rowCount) {
    throw new InvitationServiceError(409, 'This person is already a member of the office.', 'ALREADY_MEMBER');
  }

  // A new invitation replaces any earlier pending one for the same address and office.
  await query(
    `UPDATE office_invitations SET revoked_at = NOW()
      WHERE office_id = $1 AND lower(email) = $2
        AND accepted_at IS NULL AND revoked_at IS NULL`,
    [actor.office_id, email]
  );

  const token = randomBytes(32).toString('base64url');
  const result = await query(
    `INSERT INTO office_invitations
       (office_id, email, role_id, client_id, token_hash, expires_at, invited_by_user_id)
     SELECT $1, $2, role_id, $3, $4, NOW() + make_interval(days => $5), $6
       FROM roles WHERE role_name = $7
     RETURNING invitation_id, email, client_id, expires_at, created_at, accepted_at, revoked_at`,
    [actor.office_id, email, clientId, hashToken(token), INVITATION_TTL_DAYS, actor.user_id, body.role]
  );
  return {
    invitation: publicInvitation({ ...result.rows[0], role: body.role }),
    // No mailer is configured yet, so the administrator shares this single-use link directly.
    invite_url: invitationUrl(token),
  };
}

export async function listInvitations(actor) {
  assertOfficeAdmin(actor);
  const result = await query(
    `SELECT invitation.invitation_id, invitation.email, r.role_name AS role, invitation.client_id,
            invitation.expires_at, invitation.created_at, invitation.accepted_at, invitation.revoked_at
       FROM office_invitations invitation
       JOIN roles r ON r.role_id = invitation.role_id
      WHERE invitation.office_id = $1
      ORDER BY invitation.created_at DESC
      LIMIT 100`,
    [actor.office_id]
  );
  return result.rows.map(publicInvitation);
}

export async function revokeInvitation(actor, invitationId) {
  assertOfficeAdmin(actor);
  if (typeof invitationId !== 'string' || !UUID_PATTERN.test(invitationId)) {
    invalid('invitationId must be a valid UUID.');
  }
  const result = await query(
    `UPDATE office_invitations SET revoked_at = NOW()
      WHERE invitation_id = $1 AND office_id = $2
        AND accepted_at IS NULL AND revoked_at IS NULL
      RETURNING invitation_id`,
    [invitationId, actor.office_id]
  );
  if (!result.rowCount) throw new InvitationServiceError(404, 'Invitation not found.', 'NOT_FOUND');
  return { invitation_id: invitationId, revoked: true };
}

/** Public preview: office name, role and a masked address. Never returns case or client data. */
export async function previewInvitation(token) {
  validateToken(token);
  const result = await query(
    `SELECT invitation.email, invitation.expires_at, invitation.accepted_at, invitation.revoked_at,
            r.role_name AS role, office.name AS office_name, office.status AS office_status
       FROM office_invitations invitation
       JOIN roles r ON r.role_id = invitation.role_id
       JOIN law_offices office ON office.office_id = invitation.office_id
      WHERE invitation.token_hash = $1`,
    [hashToken(token)]
  );
  if (!result.rowCount) throw new InvitationServiceError(404, 'Invitation not found.', 'INVITATION_INVALID');
  const row = result.rows[0];
  return {
    office_name: row.office_name,
    office_active: row.office_status === 'active',
    role: row.role,
    email_hint: maskEmail(row.email),
    state: invitationState(row),
    expires_at: row.expires_at,
  };
}

function validateAcceptBody(body, role) {
  const input = body ?? {};
  if (typeof input !== 'object' || Array.isArray(input)) invalid('Request body must be a JSON object.');
  if (Object.keys(input).some((field) => !ACCEPT_FIELDS.has(field))) {
    invalid('Request contains unsupported fields.');
  }
  if (role !== 'lawyer') return null;
  if (input.bar_number === undefined) return null;
  if (typeof input.bar_number !== 'string' || !input.bar_number.trim() || input.bar_number.trim().length > 50) {
    invalid('bar_number must contain 1 to 50 characters.');
  }
  const years = input.years_experience;
  if (years !== undefined && years !== null && (!Number.isInteger(years) || years < 0 || years > 70)) {
    invalid('years_experience must be a whole number between 0 and 70.');
  }
  const specialty = typeof input.specialty === 'string' ? input.specialty.trim().slice(0, 100) || null : null;
  return { bar_number: input.bar_number.trim(), specialty, years_experience: years ?? null };
}

/**
 * Accepts an invitation for the signed-in account. The account email must match the invited
 * address, so a leaked link cannot be redeemed by a different person. A client invitation links
 * exactly the client record chosen by the office, nothing matched by email.
 */
export async function acceptInvitation(account, sessionId, token, body) {
  if (typeof account?.user_id !== 'string' || !UUID_PATTERN.test(account.user_id)) {
    throw new InvitationServiceError(401, 'Authentication required.', 'UNAUTHORIZED');
  }
  validateToken(token);

  const client = await pool.connect();
  let releaseError;
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT invitation.invitation_id, invitation.office_id, invitation.email, invitation.client_id,
              invitation.role_id, invitation.expires_at, invitation.accepted_at, invitation.revoked_at,
              r.role_name AS role, office.status AS office_status
         FROM office_invitations invitation
         JOIN roles r ON r.role_id = invitation.role_id
         JOIN law_offices office ON office.office_id = invitation.office_id
        WHERE invitation.token_hash = $1
        FOR UPDATE OF invitation`,
      [hashToken(token)]
    );
    if (!found.rowCount) throw new InvitationServiceError(404, 'Invitation not found.', 'INVITATION_INVALID');
    const invitation = found.rows[0];
    const state = invitationState(invitation);
    if (state !== 'pending') {
      throw new InvitationServiceError(410, 'This invitation can no longer be used.', 'INVITATION_INVALID');
    }
    if (invitation.office_status !== 'active') {
      throw new InvitationServiceError(403, 'This office is not active.', 'OFFICE_INACTIVE');
    }
    if (invitation.email.toLowerCase() !== String(account.email).toLowerCase()) {
      throw new InvitationServiceError(
        403,
        'This invitation was sent to a different email address.',
        'INVITATION_EMAIL_MISMATCH'
      );
    }
    const lawyer = validateAcceptBody(body, invitation.role);

    const existing = await client.query(
      'SELECT 1 FROM office_memberships WHERE office_id = $1 AND user_id = $2',
      [invitation.office_id, account.user_id]
    );
    if (existing.rowCount) {
      throw new InvitationServiceError(409, 'You are already a member of this office.', 'ALREADY_MEMBER');
    }

    await client.query(
      'INSERT INTO office_memberships (office_id, user_id, role_id) VALUES ($1, $2, $3)',
      [invitation.office_id, account.user_id, invitation.role_id]
    );

    if (invitation.client_id) {
      const linked = await client.query(
        `UPDATE clients SET user_id = $1
          WHERE client_id = $2 AND office_id = $3 AND user_id IS NULL
          RETURNING client_id`,
        [account.user_id, invitation.client_id, invitation.office_id]
      );
      if (!linked.rowCount) {
        throw new InvitationServiceError(409, 'This client record already has an account.', 'CLIENT_ALREADY_LINKED');
      }
    }

    if (lawyer) {
      await client.query(
        `INSERT INTO lawyer_profiles (bar_number, specialty, years_experience, user_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO NOTHING`,
        [lawyer.bar_number, lawyer.specialty, lawyer.years_experience, account.user_id]
      );
    }

    await client.query(
      `UPDATE office_invitations SET accepted_at = NOW(), accepted_by_user_id = $2
        WHERE invitation_id = $1`,
      [invitation.invitation_id, account.user_id]
    );
    await client.query(
      `INSERT INTO audit_logs (action, entity_type, entity_id, user_id, office_id, details)
       VALUES ('invitation_accepted', 'office_invitation', $1, $2, $3, $4::jsonb)`,
      [invitation.invitation_id, account.user_id, invitation.office_id,
        JSON.stringify({ role: invitation.role, client_id: invitation.client_id })]
    );
    await client.query(
      'UPDATE sessions SET active_office_id = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
      [invitation.office_id, sessionId, account.auth_user_id]
    );
    await client.query('COMMIT');
    return { office_id: invitation.office_id, role: invitation.role };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      releaseError = rollbackError;
    }
    if (error?.code === '23505' && error.constraint === 'lawyer_profiles_bar_number_key') {
      throw new InvitationServiceError(409, 'This bar number is already registered.', 'BAR_NUMBER_TAKEN');
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}
