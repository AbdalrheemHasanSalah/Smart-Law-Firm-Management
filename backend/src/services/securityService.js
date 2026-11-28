import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pool, query } from '../config/db.js';
import { can, effectivePermissions, GRANTABLE, ROLE_DEFAULTS, STAFF_ROLES } from '../config/permissions.js';
import { auditLater } from './auditService.js';
import { clearLockout } from './lockoutService.js';

/**
 * The owner's security page (phase 8): each member's role, permissions and sign-in lock; the
 * verified export of the office's own data; and, for the platform admin, the nightly backups.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SecurityError extends Error {
  constructor(status, message, publicCode) {
    super(message);
    this.name = 'SecurityError';
    this.status = status;
    if (publicCode) this.publicCode = publicCode;
  }
}
const invalid = (message) => {
  throw new SecurityError(400, message, 'VALIDATION');
};
const forbidden = () => {
  throw new SecurityError(403, 'You do not have permission to access this resource.', 'FORBIDDEN');
};

function assertOwnerAdmin(actor) {
  if (!actor || actor.role !== 'admin' || !can(actor, 'office.manage') || !UUID_PATTERN.test(String(actor.user_id)) || !UUID_PATTERN.test(String(actor.office_id))) forbidden();
}

/* ───────────── members ───────────── */

const memberView = (row) => ({
  user_id: row.user_id,
  full_name: row.full_name,
  email: row.email,
  role: row.role,
  is_owner: row.is_owner,
  status: row.status,
  permissions_granted: row.permissions_granted ?? [],
  permissions_revoked: row.permissions_revoked ?? [],
  permissions: [...effectivePermissions(row)],
  role_defaults: ROLE_DEFAULTS[row.role] ?? [],
  locked_until: row.locked_until,
});

const MEMBERS_SQL = `
  SELECT u.user_id, u.full_name, u.email, r.role_name AS role, m.is_owner, m.status,
         m.permissions_granted, m.permissions_revoked,
         (SELECT l.locked_until FROM sign_in_lockouts l WHERE l.email = lower(u.email) AND l.locked_until > NOW()) AS locked_until
    FROM office_memberships m
    JOIN app_users u ON u.user_id = m.user_id
    JOIN roles r ON r.role_id = m.role_id
   WHERE m.office_id = $1 AND r.role_name <> 'client'`;

export async function listMemberSecurity(actor) {
  assertOwnerAdmin(actor);
  const result = await query(`${MEMBERS_SQL} ORDER BY m.is_owner DESC, u.full_name`, [actor.office_id]);
  return { members: result.rows.map(memberView), grantable: GRANTABLE, role_defaults: ROLE_DEFAULTS };
}

async function findMember(actor, userId) {
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) invalid('userId must be a valid UUID.');
  const result = await query(`${MEMBERS_SQL} AND m.user_id = $2`, [actor.office_id, userId]);
  if (!result.rowCount) throw new SecurityError(404, 'Member not found.', 'NOT_FOUND');
  return result.rows[0];
}

/**
 * Sets what is granted and revoked for one member on top of their role. A grant must be a
 * grantable permission the role lacks; a revocation must be one the role has. The owner's
 * permissions and the actor's own cannot be changed.
 */
export async function setMemberPermissions(actor, userId, body) {
  assertOwnerAdmin(actor);
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !['granted', 'revoked'].includes(key))) {
    invalid('Send granted and revoked lists only.');
  }
  const member = await findMember(actor, userId);
  if (member.is_owner || member.user_id === actor.user_id) throw new SecurityError(400, 'The owner\'s permissions cannot be changed.', 'OWNER_PERMISSIONS');
  if (!STAFF_ROLES.has(member.role)) invalid('Only office staff have permissions.');
  const defaults = new Set(ROLE_DEFAULTS[member.role] ?? []);
  const list = (value, name) => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((key) => typeof key !== 'string')) invalid(`${name} must be a list of permissions.`);
    return [...new Set(value)].sort();
  };
  const granted = list(body.granted, 'granted');
  const revoked = list(body.revoked, 'revoked');
  if (granted.some((key) => !GRANTABLE.includes(key) || defaults.has(key))) invalid('Only permissions the role does not have can be granted.');
  if (revoked.some((key) => !defaults.has(key) || key === 'office.manage')) invalid('Only permissions the role has can be revoked.');
  await query(
    `UPDATE office_memberships SET permissions_granted = $3, permissions_revoked = $4, updated_at = NOW()
      WHERE office_id = $1 AND user_id = $2`,
    [actor.office_id, userId, granted, revoked]
  );
  auditLater(actor, {
    action: 'permissions_changed',
    entityType: 'membership',
    entityId: userId,
    details: {
      subject: member.full_name,
      changes: {
        permissions_granted: { from: member.permissions_granted ?? [], to: granted },
        permissions_revoked: { from: member.permissions_revoked ?? [], to: revoked },
      },
    },
  });
  return { member: memberView(await findMember(actor, userId)) };
}

/** Lifts a member's sign-in lock early. */
export async function unlockMember(actor, userId) {
  assertOwnerAdmin(actor);
  const member = await findMember(actor, userId);
  await clearLockout(member.email.toLowerCase());
  auditLater(actor, { action: 'sign_in_unlocked', entityType: 'membership', entityId: userId, details: { subject: member.full_name } });
  return { member: memberView({ ...member, locked_until: null }) };
}

/* ───────────── the office's own data ───────────── */

/** Tables never exported: secrets, delivery keys and invitation tokens. */
const EXCLUDED_TABLES = new Set(['push_subscriptions', 'office_invitations', 'sessions', 'accounts', 'verifications', 'auth_users', 'sign_in_lockouts']);
/** Columns never exported from any table. */
const EXCLUDED_COLUMN = /(password|token|secret|_hash$|^keys?$|endpoint|storage_key|storage_path|stored_name|file_path)/i;

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Every row of the office's own tables, as one JSON file with a manifest. Read in one
 * REPEATABLE READ transaction, so the tables agree with each other. The manifest's sha256 is the
 * hash of JSON.stringify(data), which anyone can recompute to check the file. Before it is handed
 * over, the file is parsed back and its tables and row counts compared with the database.
 * Uploaded files themselves are not included, only their records.
 */
export async function exportOfficeData(actor) {
  assertOwnerAdmin(actor);
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const office = (await client.query('SELECT office_id, name, city, phone, created_at FROM law_offices WHERE office_id = $1', [actor.office_id])).rows[0];
    if (!office) throw new SecurityError(404, 'Office not found.', 'NOT_FOUND');
    const columns = await client.query(
      `SELECT c.table_name, array_agg(c.column_name::text ORDER BY c.ordinal_position) FILTER (WHERE c.data_type <> 'bytea') AS columns
         FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
        WHERE c.table_schema = 'public'
          AND EXISTS (SELECT 1 FROM information_schema.columns o
                       WHERE o.table_schema = 'public' AND o.table_name = c.table_name AND o.column_name = 'office_id')
        GROUP BY c.table_name
        ORDER BY c.table_name`
    );
    const data = {};
    const counts = {};
    for (const { table_name: table, columns: all } of columns.rows) {
      if (EXCLUDED_TABLES.has(table) || !/^[a-z_][a-z0-9_]*$/.test(table)) continue;
      const kept = all.filter((column) => !EXCLUDED_COLUMN.test(column) && /^[a-z_][a-z0-9_]*$/.test(column));
      const rows = (await client.query(`SELECT ${kept.map((column) => `"${column}"`).join(', ')} FROM "${table}" WHERE office_id = $1 ORDER BY 1`, [actor.office_id])).rows;
      data[table] = rows;
      counts[table] = rows.length;
    }
    data.members = (await client.query(
      `SELECT u.user_id, u.full_name, u.email, r.role_name AS role, m.is_owner, m.status
         FROM office_memberships m JOIN app_users u ON u.user_id = m.user_id JOIN roles r ON r.role_id = m.role_id
        WHERE m.office_id = $1 ORDER BY u.full_name`,
      [actor.office_id]
    )).rows;
    counts.members = data.members.length;
    const totals = {};
    for (const table of Object.keys(counts)) {
      if (table === 'members') continue;
      totals[table] = Number((await client.query(`SELECT COUNT(*) AS n FROM "${table}" WHERE office_id = $1`, [actor.office_id])).rows[0].n);
    }
    await client.query('COMMIT');

    const payload = JSON.stringify(data);
    const hash = sha256(payload);
    // Verification: the file parses back to the same tables and counts as the database holds.
    const parsed = JSON.parse(payload);
    const problems = Object.entries(totals)
      .filter(([table, total]) => (parsed[table]?.length ?? -1) !== total)
      .map(([table]) => table);
    if (sha256(JSON.stringify(parsed)) !== hash) problems.push('serialization');
    if (problems.length) throw new SecurityError(500, `The export did not verify: ${problems.join(', ')}.`, 'EXPORT_UNVERIFIED');

    const exportedAt = new Date().toISOString();
    auditLater(actor, { action: 'office_exported', entityType: 'office', entityId: actor.office_id, details: { subject: office.name, sha256: hash, tables: Object.keys(counts).length } });
    return {
      manifest: {
        format: 'qadiyati-office-export',
        version: 1,
        office: { office_id: office.office_id, name: office.name },
        exported_at: exportedAt,
        exported_by: actor.user_id,
        counts,
        sha256: hash,
        verified: true,
        note: 'sha256 is the SHA-256 of JSON.stringify(data). Uploaded files are not included, only their records.',
      },
      data: parsed,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/* ───────────── server backups (platform admin) ───────────── */

/**
 * The nightly backups as deploy/scripts/backup.sh records them: one JSON object per run with each
 * file's size and SHA-256 and whether the dump lists and the archive opens. Kept in
 * BACKUP_STATUS_FILE (default /var/lib/qadiyati/backup-status.json); missing means not set up.
 */
export async function backupStatus(actor, env = process.env) {
  if (actor?.is_platform_admin !== true) forbidden();
  const file = env.BACKUP_STATUS_FILE || '/var/lib/qadiyati/backup-status.json';
  let runs;
  try {
    runs = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return { configured: false, backups: [], latest_ok_at: null, stale: true };
    throw new SecurityError(500, 'The backup status file could not be read.', 'BACKUP_STATUS_UNREADABLE');
  }
  const backups = (Array.isArray(runs) ? runs : []).filter((run) => run && typeof run === 'object').slice(-30).reverse();
  const latestOk = backups.find((run) => run.ok === true);
  const latestOkAt = latestOk?.finished_at ?? null;
  const stale = !latestOkAt || Date.now() - new Date(latestOkAt).getTime() > 36 * 3600 * 1000;
  return { configured: true, backups, latest_ok_at: latestOkAt, stale };
}
