/**
 * Office permissions as the app sees them, mirroring backend/src/config/permissions.js: what the
 * member may do (from the session), and whether a screen should offer an action. The server is the
 * one that enforces; this only decides what to show. No DOM code, for the React Native port.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/auth/auth'
import { api } from './api'
import type { OfficeRole } from './types'
import { actsAsAdminFor, hasPermission, type Permission } from './permissionRules'

export * from './permissionRules'

export const PERMISSION: Record<Permission, { label: string; note: string }> = {
  'cases.view': { label: 'الاطلاع على القضايا', note: 'القضايا والموكّلون والمستندات والجلسات والمكتبة' },
  'cases.edit': { label: 'تعديل القضايا', note: 'إنشاء القضايا وتعديلها ومراحلها وملاحظاتها ومسوّداتها' },
  'clients.edit': { label: 'إدارة الموكّلين', note: 'إضافة الموكّلين وتعديلهم، وطلبات الاستشارة، ودليل الزملاء' },
  'documents.edit': { label: 'المستندات', note: 'رفع المستندات والعقود والتوكيلات وأوراق المحضرين' },
  'schedule.edit': { label: 'الجلسات والمهام', note: 'الجلسات والمواعيد والمهام ونتائج الجلسات' },
  'finance.manage': { label: 'المالية', note: 'الفواتير والدفعات والمصاريف واتفاقيات الأتعاب والتقارير المالية' },
  delete: { label: 'الحذف', note: 'حذف السجلات' },
  print: { label: 'الطباعة', note: 'الطباعة والتصدير والنماذج والترويسة' },
  'ai.use': { label: 'أدوات الذكاء الاصطناعي', note: 'تحليل القضايا والتحضير للجلسات والصياغة الآلية' },
  'office.manage': { label: 'إدارة المكتب', note: 'الفريق والصلاحيات والإعدادات والسجل والتصدير — لصاحب المكتب وحده' },
}
export const useCan = () => {
  const { session } = useAuth()
  return (permission: Permission) => hasPermission(session, permission)
}
export const useAdminFor = (permission: Permission) => actsAsAdminFor(useAuth().session, permission)

/* ───────────── the owner's security page ───────────── */

export type MemberSecurity = {
  user_id: string
  full_name: string
  email: string
  role: OfficeRole
  is_owner: boolean
  status: 'active' | 'suspended'
  permissions_granted: Permission[]
  permissions_revoked: Permission[]
  permissions: Permission[]
  role_defaults: Permission[]
  locked_until: string | null
}

export const useMemberSecurity = (enabled = true) =>
  useQuery({
    queryKey: ['member-security'],
    enabled,
    queryFn: async () => (await api.get<{ members: MemberSecurity[]; grantable: Permission[] }>('/offices/current/members/security')).data,
  })

const useSecurityMutation = <Input,>(run: (input: Input) => Promise<unknown>) => {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: run, onSettled: () => void queryClient.invalidateQueries({ queryKey: ['member-security'] }) })
}
export const useSetPermissions = () =>
  useSecurityMutation(({ userId, granted, revoked }: { userId: string; granted: Permission[]; revoked: Permission[] }) =>
    api.put(`/offices/current/members/${userId}/permissions`, { granted, revoked }))
export const useUnlockMember = () => useSecurityMutation((userId: string) => api.post(`/offices/current/members/${userId}/unlock`))

/** Toggling a permission for a member: a role's own one is revoked or restored, any other granted or withdrawn. */
export const togglePermission = (member: Pick<MemberSecurity, 'role_defaults' | 'permissions_granted' | 'permissions_revoked'>, permission: Permission) => {
  const granted = new Set(member.permissions_granted)
  const revoked = new Set(member.permissions_revoked)
  if (member.role_defaults.includes(permission)) {
    if (revoked.has(permission)) revoked.delete(permission)
    else revoked.add(permission)
  } else if (granted.has(permission)) granted.delete(permission)
  else granted.add(permission)
  return { granted: [...granted].sort(), revoked: [...revoked].sort() }
}

export type ChainCheck = {
  ok: boolean
  checked: number
  legacy: number
  head: { seq: number; hash: string; at: string } | null
  problems: { seq: number; at: string; kind: 'modified' | 'missing_before' | 'broken_link' }[]
  checked_at: string
}
export const CHAIN_PROBLEM: Record<ChainCheck['problems'][number]['kind'], string> = {
  modified: 'عُدّل بعد كتابته',
  missing_before: 'حُذف قيد أو أكثر قبله',
  broken_link: 'لا يشير إلى القيد الذي قبله',
}
export const useVerifyChain = () => useMutation({ mutationFn: async () => (await api.get<ChainCheck>('/audit-logs/verify')).data })

export type OfficeExport = {
  manifest: { format: string; version: number; office: { office_id: string; name: string }; exported_at: string; counts: Record<string, number>; sha256: string; verified: boolean }
  data: Record<string, unknown[]>
}
export const fetchOfficeExport = async () => (await api.get<OfficeExport>('/offices/current/export')).data

/* ───────────── server backups (platform admin) ───────────── */

export type BackupRun = {
  stamp: string
  started_at?: string
  finished_at: string
  database?: { file: string; bytes: number; sha256: string; verified: boolean; tables: number }
  documents?: { file: string; bytes: number; sha256: string; verified: boolean; entries: number }
  ok: boolean
  error?: string | null
}
export type BackupStatus = { configured: boolean; backups: BackupRun[]; latest_ok_at: string | null; stale: boolean }
export const useBackups = () =>
  useQuery({ queryKey: ['platform-backups'], queryFn: async () => (await api.get<BackupStatus>('/platform/backups')).data })
