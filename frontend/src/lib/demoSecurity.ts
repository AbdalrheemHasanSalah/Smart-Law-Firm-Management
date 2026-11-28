/**
 * Security and roles in demo mode: the permission gate (the server's map), sign-in lockout after
 * five wrong passwords, the owner's security page, the audit chain check, the office export and the
 * platform's backup list. Kept in memory; backups are fictional.
 */
import { effectivePermissions, GRANTABLE, NEW_ROLES, permissionFor, ROLE_DEFAULTS, STAFF_ROLES, type Permission } from './permissionRules'
import type { OfficeRole } from './types'

export type DemoMember = {
  user_id: string
  full_name: string
  email: string
  status: string
  role: OfficeRole | null
  is_owner: boolean
  granted?: Permission[]
  revoked?: Permission[]
}
type Ctx = { user: DemoMember; params: string[]; query: Record<string, unknown>; body: Record<string, unknown> }
type SecurityRoute = [method: string, pattern: RegExp, roles: readonly string[], handler: (ctx: Ctx) => unknown]
type Helpers = {
  fail: (status: number, code: string, extra?: object) => Error
  members: () => DemoMember[]
  officeData: () => Record<string, unknown[]>
  officeName: string
}

export const permissionsOf = (member: DemoMember) =>
  [...effectivePermissions({ role: member.role, is_owner: member.is_owner, granted: member.granted, revoked: member.revoked })]

/**
 * The server's gate: returns the member as the routes should see them (new roles act as the admin on
 * routes their permissions open, or as an assistant on their own things), or throws PERMISSION_DENIED.
 */
export const gate = <T extends DemoMember>(member: T, method: string, path: string, fail: Helpers['fail']): T => {
  if (!member.role || !STAFF_ROLES.includes(member.role)) return member
  const need = permissionFor(method, path)
  if (need === 'session') return member
  const held = new Set(permissionsOf(member))
  if (NEW_ROLES.includes(member.role)) {
    if (need === 'open') return { ...member, role: 'assistant' }
    if (need && need !== 'client' && held.has(need)) return { ...member, role: 'admin' }
    throw fail(403, 'PERMISSION_DENIED')
  }
  if (!need || need === 'open' || need === 'client') return member
  const byDefault = (ROLE_DEFAULTS[member.role] ?? []).includes(need)
  if (byDefault && !held.has(need)) throw fail(403, 'PERMISSION_DENIED')
  if (!byDefault && held.has(need)) return { ...member, role: 'admin' }
  return member
}

/* ───────────── lockout ───────────── */

const LOCK_MINUTES = 15
const attempts = new Map<string, { count: number; until: number | null }>()

export const lockedUntil = (email: string) => {
  const entry = attempts.get(email)
  return entry?.until && entry.until > Date.now() ? new Date(entry.until).toISOString() : null
}
export const signInFailed = (email: string) => {
  const entry = attempts.get(email) ?? { count: 0, until: null }
  entry.count += 1
  if (entry.count >= 5) {
    entry.count = 0
    entry.until = Date.now() + LOCK_MINUTES * 60_000
  }
  attempts.set(email, entry)
}
export const signInSucceeded = (email: string) => attempts.delete(email)

/* ───────────── routes ───────────── */

const sha256Hex = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((byte) => byte.toString(16).padStart(2, '0')).join('')

const night = (daysAgo: number, ok = true) => {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  date.setHours(3, 0, 40, 0)
  const stamp = `${date.toISOString().slice(0, 10)}_0300`
  return {
    stamp,
    started_at: new Date(date.getTime() - 40_000).toISOString(),
    finished_at: date.toISOString(),
    database: { file: `db_${stamp}.dump`, bytes: 18_400_000 + daysAgo * 37_000, sha256: (`9f3c1a${daysAgo}e`).padEnd(64, 'b7'), verified: ok, tables: 76 },
    documents: { file: `documents_${stamp}.tar.gz`, bytes: 412_000_000 - daysAgo * 900_000, sha256: (`4be70d${daysAgo}a`).padEnd(64, 'c2'), verified: true, entries: 1384 - daysAgo * 3 },
    ok,
    error: ok ? null : 'dump is missing core tables',
  }
}

export const securityRoutes = ({ fail, members, officeData, officeName }: Helpers): SecurityRoute[] => {
  const view = (member: DemoMember) => ({
    user_id: member.user_id,
    full_name: member.full_name,
    email: member.email,
    role: member.role,
    is_owner: member.is_owner,
    status: member.status,
    permissions_granted: member.granted ?? [],
    permissions_revoked: member.revoked ?? [],
    permissions: permissionsOf(member),
    role_defaults: ROLE_DEFAULTS[member.role ?? 'client'] ?? [],
    locked_until: lockedUntil(member.email),
  })
  const staff = () => members().filter((member) => member.role && member.role !== 'client')
  const find = (userId: string) => {
    const member = staff().find((entry) => entry.user_id === userId)
    if (!member) throw fail(404, 'NOT_FOUND')
    return member
  }
  return [
    ['get', /^\/offices\/current\/members\/security$/, ['admin'], () => ({
      members: staff().sort((a, b) => Number(b.is_owner) - Number(a.is_owner) || a.full_name.localeCompare(b.full_name, 'ar')).map(view),
      grantable: GRANTABLE,
      role_defaults: ROLE_DEFAULTS,
    })],
    ['put', /^\/offices\/current\/members\/([^/]+)\/permissions$/, ['admin'], ({ user, params, body }) => {
      const member = find(params[0]!)
      if (member.is_owner || member.user_id === user.user_id) throw fail(400, 'OWNER_PERMISSIONS')
      const defaults = ROLE_DEFAULTS[member.role!] ?? []
      const list = (value: unknown) => (Array.isArray(value) ? [...new Set(value.filter((key): key is Permission => typeof key === 'string'))].sort() : [])
      const granted = list(body.granted)
      const revoked = list(body.revoked)
      if (granted.some((key) => !GRANTABLE.includes(key) || defaults.includes(key))) throw fail(400, 'VALIDATION')
      if (revoked.some((key) => !defaults.includes(key) || key === 'office.manage')) throw fail(400, 'VALIDATION')
      member.granted = granted
      member.revoked = revoked
      return { member: view(member) }
    }],
    ['post', /^\/offices\/current\/members\/([^/]+)\/unlock$/, ['admin'], ({ params }) => {
      const member = find(params[0]!)
      signInSucceeded(member.email)
      return { member: view(member) }
    }],
    ['get', /^\/audit-logs\/verify$/, ['admin'], () => {
      const checked = 214
      return {
        ok: true,
        checked,
        legacy: 37,
        head: { seq: checked, hash: '6d1f0c8e2b7a4c9d5e3f1a0b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d', at: new Date(Date.now() - 20 * 60_000).toISOString() },
        problems: [],
        checked_at: new Date().toISOString(),
      }
    }],
    ['get', /^\/offices\/current\/export$/, ['admin'], async ({ user }) => {
      const data = JSON.parse(JSON.stringify(officeData())) as Record<string, unknown[]>
      const counts = Object.fromEntries(Object.entries(data).map(([table, rows]) => [table, rows.length]))
      return {
        manifest: {
          format: 'qadiyati-office-export',
          version: 1,
          office: { office_id: 'o-1', name: officeName },
          exported_at: new Date().toISOString(),
          exported_by: user.user_id,
          counts,
          sha256: await sha256Hex(JSON.stringify(data)),
          verified: true,
          note: 'sha256 is the SHA-256 of JSON.stringify(data). Uploaded files are not included, only their records.',
        },
        data,
      }
    }],
    ['get', /^\/platform\/backups$/, ['platform'], () => {
      const backups = [night(0), night(1), night(2, false), night(3), night(4)]
      return { configured: true, backups, latest_ok_at: backups[0]!.finished_at, stale: false }
    }],
  ]
}
