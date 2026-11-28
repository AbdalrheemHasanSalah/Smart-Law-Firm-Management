/**
 * The office permission rules, the same as backend/src/config/permissions.js: role defaults, a
 * member's effective permissions, and the permission each API route needs (used by demo mode to
 * behave like the server). Plain TypeScript with no React or DOM, so anything can import it.
 */
import type { OfficeRole } from './types'

export type Permission =
  | 'cases.view'
  | 'cases.edit'
  | 'clients.edit'
  | 'documents.edit'
  | 'schedule.edit'
  | 'finance.manage'
  | 'delete'
  | 'print'
  | 'ai.use'
  | 'office.manage'

export const PERMISSIONS: Permission[] = ['cases.view', 'cases.edit', 'clients.edit', 'documents.edit', 'schedule.edit', 'finance.manage', 'delete', 'print', 'ai.use', 'office.manage']
export const GRANTABLE: Permission[] = PERMISSIONS.filter((key) => key !== 'office.manage')

export const NEW_ROLES: readonly OfficeRole[] = ['accountant', 'data_entry', 'print_only']
/** Office roles that work in the office area (all but the client). */
export const STAFF_ROLES: readonly OfficeRole[] = ['admin', 'lawyer', 'assistant', ...NEW_ROLES]

const STAFF_DEFAULTS: Permission[] = ['cases.view', 'cases.edit', 'clients.edit', 'documents.edit', 'schedule.edit', 'print', 'ai.use', 'delete']
export const ROLE_DEFAULTS: Partial<Record<OfficeRole, Permission[]>> = {
  admin: PERMISSIONS,
  lawyer: STAFF_DEFAULTS,
  assistant: STAFF_DEFAULTS,
  accountant: ['cases.view', 'finance.manage', 'print'],
  data_entry: ['cases.view', 'cases.edit', 'clients.edit', 'documents.edit', 'schedule.edit', 'print'],
  print_only: ['cases.view', 'print'],
}

/** The member's permissions: the role's, plus grants, minus revocations. The owner keeps all. */
export const effectivePermissions = (member: { role: OfficeRole | null; is_owner?: boolean; granted?: readonly string[]; revoked?: readonly string[] }) => {
  if (!member.role || member.role === 'client') return new Set<Permission>()
  if (member.is_owner || (member.role === 'admin' && !member.revoked?.length)) return new Set(PERMISSIONS)
  const result = new Set(ROLE_DEFAULTS[member.role] ?? [])
  for (const key of member.granted ?? []) if ((GRANTABLE as string[]).includes(key)) result.add(key as Permission)
  for (const key of member.revoked ?? []) result.delete(key as Permission)
  return result
}

type SessionLike = { role: OfficeRole | null; active_office: { permissions?: string[] } | null } | null

/** True when the member holds the permission in the active office. */
export const hasPermission = (session: SessionLike, permission: Permission) => {
  if (!session?.role || session.role === 'client') return false
  const granted = session.active_office?.permissions
  return granted ? granted.includes(permission) : (ROLE_DEFAULTS[session.role] ?? []).includes(permission)
}

/**
 * True when the member acts as the office admin for this permission, as the server's gate decides:
 * the admin and the three new roles whenever they hold it, and a lawyer or assistant when the owner
 * granted it beyond their role.
 */
export const actsAsAdminFor = (session: SessionLike, permission: Permission) => {
  if (!hasPermission(session, permission) || !session?.role) return false
  if (session.role === 'admin' || NEW_ROLES.includes(session.role)) return true
  return !(ROLE_DEFAULTS[session.role] ?? []).includes(permission)
}

export type RouteNeed = Permission | 'session' | 'open' | 'client' | null

const READ = ['get', 'head']
const WRITE = ['post', 'put', 'patch']
const DELETE = ['delete']
const ANY = [...READ, ...WRITE, ...DELETE]

/** The same map as the server's (backend/src/config/permissions.js); the first match wins. */
const RULES: [string[], RegExp, Exclude<RouteNeed, null>][] = [
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
]

export const permissionFor = (method: string, path: string): RouteNeed => {
  const clean = path.split('?')[0]!.replace(/\/+$/, '') || '/'
  const verb = method.toLowerCase()
  for (const [methods, pattern, need] of RULES) if (methods.includes(verb) && pattern.test(clean)) return need
  return null
}
