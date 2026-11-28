/**
 * Office permissions (phase 8).
 *
 * Every office route is mapped below to one permission. A role has default permissions, and the
 * office owner can grant or revoke any grantable one for a single member (office.manage stays with
 * the owner). The gate in middleware/auth.js applies the map before the route's own role check:
 *
 *   accountant, data_entry, print_only   only reach routes whose permission they hold; there they
 *                                        act as the office admin, so office-wide reads and the
 *                                        existing admin logic apply, and nothing outside the map
 *   admin, lawyer, assistant             unchanged, except that a revoked permission is refused
 *                                        and a granted one lets them act as admin on its routes
 *
 * Services that hand the admin more than the route's own subject (money in the client briefcase,
 * finance in the office report, restricted documents) also check the permission themselves.
 */

export const PERMISSIONS = [
  'cases.view',
  'cases.edit',
  'clients.edit',
  'documents.edit',
  'schedule.edit',
  'finance.manage',
  'delete',
  'print',
  'ai.use',
  'office.manage',
];
/** Only the owner manages the office: team, roles, permissions, settings, logs and exports. */
export const GRANTABLE = PERMISSIONS.filter((key) => key !== 'office.manage');

export const NEW_ROLES = new Set(['accountant', 'data_entry', 'print_only']);
export const STAFF_ROLES = new Set(['admin', 'lawyer', 'assistant', ...NEW_ROLES]);

const STAFF_DEFAULTS = ['cases.view', 'cases.edit', 'clients.edit', 'documents.edit', 'schedule.edit', 'print', 'ai.use', 'delete'];
export const ROLE_DEFAULTS = {
  admin: PERMISSIONS,
  lawyer: STAFF_DEFAULTS,
  assistant: STAFF_DEFAULTS,
  accountant: ['cases.view', 'finance.manage', 'print'],
  data_entry: ['cases.view', 'cases.edit', 'clients.edit', 'documents.edit', 'schedule.edit', 'print'],
  print_only: ['cases.view', 'print'],
};

/** The member's permissions: the role's, plus grants, minus revocations. The owner keeps all. */
export function effectivePermissions({ role, is_owner: isOwner, permissions_granted: granted, permissions_revoked: revoked }) {
  if (isOwner || (role === 'admin' && !revoked?.length)) return new Set(PERMISSIONS);
  const result = new Set(ROLE_DEFAULTS[role] ?? []);
  for (const key of granted ?? []) if (GRANTABLE.includes(key)) result.add(key);
  for (const key of revoked ?? []) if (key !== 'office.manage' || role !== 'admin') result.delete(key);
  return result;
}

const READ = ['GET', 'HEAD'];
const WRITE = ['POST', 'PUT', 'PATCH'];
const DELETE = ['DELETE'];
const ANY = [...READ, ...WRITE, ...DELETE];

/**
 * [methods, path pattern, permission]. The first match wins. Two special values:
 *   session   the account's own session and office choice: no role change, open to everyone
 *   open      the member's own things (inbox, messages, notifications, own HR record, saved
 *             library items): new roles use them as an assistant would, seeing only their own
 *   client    routes of the client portal
 * Paths are without the /api prefix.
 */
const RULES = [
  [ANY, /^\/(me|session|logout|sign-out|health)(\/|$)/, 'session'],
  [ANY, /^\/offices\/mine$/, 'session'],
  [WRITE, /^\/offices$/, 'session'],
  [ANY, /^\/invitations\//, 'session'],
  [ANY, /^\/platform\//, 'session'],

  [ANY, /^\/(notifications|messages|push|voice|support)(\/|$)/, 'open'],
  [ANY, /^\/library\/saved(\/|$)/, 'open'],
  [ANY, /^\/hr\/(me|leave)(\/|$)/, 'open'],
  [READ, /^\/hr\/(advances|payslips)$/, 'open'],
  [WRITE, /^\/shared-files$/, 'open'],

  [ANY, /^\/clients\/me$/, 'client'],
  [ANY, /^\/(hearings|notices|shared-files)\/mine$/, 'client'],
  [ANY, /^\/notices\/[^/]+\/acknowledge$/, 'client'],
  [ANY, /^\/finance\/statement$/, 'client'],

  [ANY, /^\/(offices\/current|users|hr|audit-logs|colleague-templates)(\/|$)/, 'office.manage'],
  [WRITE, /^\/letterhead(\/|$)/, 'office.manage'],
  [DELETE, /^\/letterhead(\/|$)/, 'office.manage'],

  [ANY, /^\/(finance|fee-agreements)(\/|$)/, 'finance.manage'],

  [ANY, /^\/cases\/[^/]+\/(analyses|hearing-prep)$/, 'ai.use'],
  [WRITE, /^\/cases\/[^/]+\/drafts\/generate$/, 'ai.use'],
  [WRITE, /^\/prints$/, 'print'],
  [READ, /^\/(letterhead|templates)(\/|$)/, 'print'],
  [READ, /^\/cases\/[^/]+\/drafts(\/|$)/, 'print'],

  [DELETE, /./, 'delete'],

  [WRITE, /^\/shared-files\/[^/]+\/(move|dismiss)$/, 'documents.edit'],
  [WRITE, /^\/(documents|contracts|powers-of-attorney|court-notices)(\/|$)/, 'documents.edit'],
  [WRITE, /^\/(calendar|hearings|tasks)(\/|$)/, 'schedule.edit'],
  [WRITE, /^\/(clients|consultations|colleagues)(\/|$)/, 'clients.edit'],
  [WRITE, /^\/courts\/[^/]+\/note$/, 'clients.edit'],
  [READ, /^\/conflicts\/check$/, 'clients.edit'],
  [READ, /^\/cases\/[^/]+\/notices\/draft$/, 'cases.edit'],
  [WRITE, /^\/(cases|notes|templates|library\/principles|library\/cases)(\/|$)/, 'cases.edit'],

  [READ, /^\/(cases|clients|documents|contracts|tasks|notes|hearings|calendar|powers-of-attorney|court-notices|law|library|courts|colleagues|consultations|shared-files|reports)(\/|$)/, 'cases.view'],
];

/** The permission a request needs, a special value, or null when the route is not mapped. */
export function permissionFor(method, path) {
  const clean = path.split('?')[0].replace(/^\/api(?=\/)/, '').replace(/\/+$/, '') || '/';
  for (const [methods, pattern, permission] of RULES) {
    if (methods.includes(method) && pattern.test(clean)) return permission;
  }
  return null;
}

/** True when the request's member holds the permission (built-in roles without a gate entry hold their defaults). */
export function can(actor, permission) {
  if (!actor) return false;
  if (Array.isArray(actor.permissions)) return actor.permissions.includes(permission);
  return (ROLE_DEFAULTS[actor.role] ?? []).includes(permission);
}
