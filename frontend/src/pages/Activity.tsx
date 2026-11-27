import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { PATHS } from '@/auth/auth'
import { api } from '@/lib/api'
import { APPOINTMENT_TYPE, CASE_STATUS, CASE_TYPE, formatDate, formatMoney, formatTime, INVOICE_STATE, PRIORITY, ROLE, TASK_STATUS } from '@/lib/labels'
import { POA_TYPE } from '@/lib/powersOfAttorney'
import { DELIVERY_STATUS, NOTICE_TYPE } from '@/lib/courtNotices'
import { HEARING_STATUS } from '@/lib/hearings'
import type { AuditEntry } from '@/lib/types'
import { Button, cn } from '@/ui/kit'
import { Empty, Failed, Loading, SheetHeader } from '@/ui/Shell'

const ACTION: Record<string, string> = {
  case_created: 'فتح قضية',
  case_updated: 'عدّل قضية',
  client_created: 'أضاف موكّلاً',
  client_updated: 'عدّل بيانات موكّل',
  client_account_linked: 'ربط حساب موكّل ببوابته',
  task_created: 'أنشأ مهمة',
  task_updated: 'حدّث مهمة',
  opponent_added: 'سجّل خصماً',
  opponent_removed: 'أزال خصماً',
  case_staff_removed: 'أزال عضواً من فريق قضية',
  hearing_scheduled: 'حدّد جلسة',
  appointment_scheduled: 'حدّد موعداً مع موكّل',
  invoice_created: 'أصدر مطالبة مالية',
  invoice_cancelled: 'ألغى مطالبة مالية',
  payment_recorded: 'سجّل دفعة',
  hearing_prep_generated: 'أعدّ ورقة تحضير جلسة',
  invitation_accepted: 'قبل دعوة الانضمام',
  office_registered: 'سجّل المكتب',
  office_reviewed: 'راجع طلب المكتب',
  account_status_changed: 'غيّر حالة حساب',
  subscription_payment_recorded: 'سجّل دفعة اشتراك',
  subscription_paid_online: 'دفع الاشتراك إلكترونياً',
  poa_created: 'سجّل توكيلاً',
  hearing_held: 'سجّل نتيجة جلسة',
  hearing_postponed: 'سجّل تأجيل جلسة',
  hearing_cancelled: 'سجّل إلغاء جلسة',
  court_notice_recorded: 'سجّل ورقة محضر',
  court_notice_updated: 'حدّث ورقة محضر',
  poa_updated: 'عدّل توكيلاً',
  poa_revoked: 'ألغى توكيلاً',
  poa_scan_attached: 'أرفق صورة توكيل',
}

const FIELD: Record<string, string> = {
  case_number: 'رقم القضية',
  title: 'العنوان',
  case_type: 'النوع',
  status: 'الحالة',
  priority: 'الأولوية',
  opened_at: 'تاريخ الفتح',
  closed_at: 'تاريخ الإغلاق',
  description: 'الوصف',
  court_id: 'المحكمة',
  client_type: 'نوع الموكّل',
  full_name_or_org: 'الاسم',
  full_name: 'الاسم',
  assignment_role: 'الدور في القضية',
  new_lead: 'المحامي الرئيسي الجديد',
  hearing_type: 'نوع الجلسة',
  hearing_at: 'موعد الجلسة',
  court_room: 'القاعة',
  purpose: 'الغرض',
  starts_at: 'يبدأ',
  location: 'المكان',
  phone: 'الهاتف',
  email: 'البريد',
  address: 'العنوان',
  national_id: 'رقم الهوية',
  due_at: 'موعد الإنجاز',
  completed_at: 'تاريخ الإنجاز',
  case_id: 'القضية',
  assigned_to_name: 'المسؤول',
  poa_number: 'رقم التوكيل',
  outcome: 'النتيجة',
  postponement_reason: 'سبب التأجيل',
  notice_type: 'نوع الورقة',
  recipient: 'المبلَّغ إليه',
  bailiff_office: 'دائرة المحضرين',
  sent_on: 'تاريخ الإرسال',
  delivery_status: 'حالة التبليغ',
  delivered_on: 'تاريخ التبليغ',
  notes: 'ملاحظات',
  appointment_type: 'نوع الموعد',
  poa_type: 'نوع التوكيل',
  issuing_authority: 'جهة الإصدار',
  issued_on: 'تاريخ الإصدار',
  expires_on: 'تاريخ الانتهاء',
  scope: 'نطاق التوكيل',
  lawyers: 'المحامون المفوَّضون',
  cases: 'القضايا',
}

const FILTERS = [
  ['', 'الكل'],
  ['case', 'القضايا'],
  ['client', 'الموكّلون'],
  ['task', 'المهام'],
  ['opponent', 'الخصوم'],
  ['invoice', 'المالية'],
  ['power_of_attorney', 'التوكيلات'],
] as const

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/

/** A value as a person reads it: labels for statuses, dates as dates, empty as a dash. */
const readable = (field: string, value: unknown, entityType: string): string => {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.length ? value.join('، ') : '—'
  if (typeof value === 'string') {
    if (entityType === 'power_of_attorney' && field === 'status') return value === 'revoked' ? 'ملغى' : 'ساري'
    if (field === 'poa_type') return POA_TYPE[value as keyof typeof POA_TYPE] ?? value
    if (field === 'notice_type') return NOTICE_TYPE[value as keyof typeof NOTICE_TYPE] ?? value
    if (field === 'delivery_status') return DELIVERY_STATUS[value as keyof typeof DELIVERY_STATUS]?.text ?? value
    if (field === 'appointment_type') return APPOINTMENT_TYPE[value] ?? value
    if (field === 'status' && entityType === 'case' && !CASE_STATUS[value]) return HEARING_STATUS[value as keyof typeof HEARING_STATUS]?.text ?? value
    if (field === 'status') return (entityType === 'task' ? TASK_STATUS : entityType === 'invoice' ? INVOICE_STATE : CASE_STATUS)[value]?.text ?? value
    if (field === 'priority') return PRIORITY[value]?.text ?? value
    if (field === 'case_type') return CASE_TYPE[value] ?? value
    if (field === 'client_type') return value === 'organization' ? 'شركة أو جهة' : 'فرد'
    if (field === 'assignment_role') return ROLE[value] ?? value
    if (field === 'case_id' || field === 'court_id') return 'مرتبطة'
    if (TIMESTAMP.test(value)) return formatDate(value)
    return value.length > 80 ? `${value.slice(0, 80)}…` : value
  }
  return String(value)
}

const subjectOf = (entry: AuditEntry) => {
  const values = entry.details?.values ?? {}
  const name = (entry.details?.subject ?? values.title ?? values.full_name_or_org ?? values.full_name ?? values.case_number) as string | undefined
  return name ?? null
}

const linkOf = (entry: AuditEntry) => {
  if (entry.entity_type === 'case' && entry.entity_id) return `${PATHS.office}/cases/${entry.entity_id}`
  if (entry.entity_type === 'opponent' && entry.details?.case_id) return `${PATHS.office}/cases/${entry.details.case_id}`
  return null
}

const Entry = ({ entry }: { entry: AuditEntry }) => {
  const changes = Object.entries(entry.details?.changes ?? {})
  const subject = subjectOf(entry)
  const link = linkOf(entry)
  return (
    <li className="grid gap-1 py-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
      <p className="text-xs text-ink-soft">
        {formatDate(entry.created_at)} · <bdi className="tabular-nums">{formatTime(entry.created_at)}</bdi>
      </p>
      <div className="min-w-0">
        <p className="text-sm text-ink">
          <span className="font-semibold">{entry.user_name ?? 'مستخدم محذوف'}</span> {ACTION[entry.action] ?? entry.action}
          {subject && <span className="text-ink-soft"> — {subject}</span>}
          {link && (
            <Link to={link} className="ms-2 text-xs font-semibold text-stamp-blue underline-offset-4 hover:underline">
              فتح الملف
            </Link>
          )}
          {entry.details?.conflict === true && <span className="ms-2 rounded-full bg-stamp/10 px-2 py-0.5 text-xs font-semibold text-stamp">نُبّه لتعارض مصالح</span>}
        </p>
        {entry.entity_type === 'invoice' && typeof entry.details?.values?.amount === 'number' && (
          <p className="mt-1 text-xs text-ink-soft">
            المبلغ: <span className="font-semibold tabular-nums text-ink">{formatMoney(entry.details.values.amount, String(entry.details.values.currency ?? 'ILS'))}</span>
          </p>
        )}
        {changes.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-xs">
            {changes.map(([field, change]) => (
              <li key={field} className="text-ink-soft">
                <span className="font-semibold text-ink">{FIELD[field] ?? field}:</span>{' '}
                <span className="text-stamp line-through decoration-stamp/50">{readable(field, change.from, entry.entity_type)}</span>
                <span aria-hidden="true"> ← </span>
                <span className="text-stamp-green">{readable(field, change.to, entry.entity_type)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  )
}

export const Activity = () => {
  const [entityType, setEntityType] = useState('')
  const [page, setPage] = useState(1)
  const log = useQuery({
    queryKey: ['audit-logs', entityType, page],
    placeholderData: keepPreviousData,
    queryFn: async () =>
      (
        await api.get<{ entries: AuditEntry[]; pagination: { page: number; totalPages: number; total: number } }>('/audit-logs', {
          params: { page, pageSize: 25, ...(entityType ? { entity_type: entityType } : {}) },
        })
      ).data,
  })
  const choose = (key: string) => {
    setEntityType(key)
    setPage(1)
  }
  return (
    <>
      <SheetHeader
        title="سجل النشاط"
        note="كل إضافة وتعديل في المكتب: من قام به، ومتى، وما الذي تغيّر."
        action={
          <div className="flex rounded-md border border-ink/25 p-0.5">
            {FILTERS.map(([key, label]) => (
              <button key={key} type="button" onClick={() => choose(key)} aria-pressed={entityType === key} className={cn('rounded px-3 py-1.5 text-xs font-semibold transition-colors', entityType === key ? 'bg-ink text-paper' : 'text-ink-soft hover:text-ink')}>
                {label}
              </button>
            ))}
          </div>
        }
      />
      {log.isPending ? (
        <Loading />
      ) : log.isError ? (
        <Failed error={log.error} />
      ) : log.data.entries.length === 0 ? (
        <Empty>لا نشاط مسجّل بعد. يظهر هنا كل تعديل جديد على القضايا والموكّلين والمهام.</Empty>
      ) : (
        <>
          <ul className={cn('divide-y divide-rule border-y border-rule transition-opacity', log.isPlaceholderData && 'opacity-60')}>
            {log.data.entries.map((entry) => (
              <Entry key={entry.audit_log_id} entry={entry} />
            ))}
          </ul>
          {log.data.pagination.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between gap-3 text-sm text-ink-soft">
              <Button variant="line" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
                الأحدث
              </Button>
              <span>
                صفحة {page} من {log.data.pagination.totalPages}
              </span>
              <Button variant="line" size="sm" disabled={page >= log.data.pagination.totalPages} onClick={() => setPage((current) => current + 1)}>
                الأقدم
              </Button>
            </div>
          )}
        </>
      )}
    </>
  )
}
