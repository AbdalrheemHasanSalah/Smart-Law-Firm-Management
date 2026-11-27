import type { StampTone } from '@/ui/kit'
import { LOCALE } from './i18n'

/** Arabic wording and stamp colour for every status the backend stores. */
type Label = { text: string; tone: StampTone }

export const CASE_STATUS: Record<string, Label> = {
  open: { text: 'مفتوحة', tone: 'blue' },
  in_progress: { text: 'قيد النظر', tone: 'green' },
  on_hold: { text: 'معلّقة', tone: 'ink' },
  closed: { text: 'مغلقة', tone: 'ink' },
  cancelled: { text: 'ملغاة', tone: 'red' },
}

export const PRIORITY: Record<string, Label> = {
  low: { text: 'منخفضة', tone: 'ink' },
  medium: { text: 'متوسطة', tone: 'blue' },
  high: { text: 'عالية', tone: 'red' },
  urgent: { text: 'عاجلة', tone: 'red' },
}

export const TASK_STATUS: Record<string, Label> = {
  pending: { text: 'بانتظار البدء', tone: 'ink' },
  in_progress: { text: 'جارية', tone: 'blue' },
  completed: { text: 'أُنجزت', tone: 'green' },
  cancelled: { text: 'ملغاة', tone: 'red' },
}

export const OFFICE_STATUS: Record<string, Label> = {
  pending: { text: 'قيد المراجعة', tone: 'blue' },
  active: { text: 'معتمد', tone: 'green' },
  rejected: { text: 'مرفوض', tone: 'red' },
  suspended: { text: 'موقوف', tone: 'red' },
}

export const CASE_TYPE: Record<string, string> = {
  civil: 'مدنية',
  commercial: 'تجارية',
  family: 'أحوال شخصية',
  labor: 'عمالية',
  criminal: 'جزائية',
  administrative: 'إدارية',
}

export const ROLE: Record<string, string> = {
  admin: 'مدير المكتب',
  lawyer: 'محامٍ',
  assistant: 'مساعد قانوني',
  client: 'موكّل',
}

const dateFormat = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' })
const dayFormat = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' })
const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' })

export const formatDate = (value: string | null) => (value ? dateFormat.format(new Date(value)) : '—')
export const formatDay = (value: string | Date) => dayFormat.format(new Date(value))
export const formatTime = (value: string) => timeFormat.format(new Date(value))

/** "اليوم", "غداً", "بعد 3 أيام", "متأخرة 2 يوم". */
export const dueLabel = (value: string | null) => {
  if (!value) return 'بدون موعد'
  const days = Math.round((new Date(value).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000)
  if (days === 0) return 'اليوم'
  if (days === 1) return 'غداً'
  if (days > 1) return `بعد ${days} أيام`
  return `متأخرة ${Math.abs(days)} يوم`
}

export const VISIBILITY: Record<string, Label> = {
  internal: { text: 'داخلية', tone: 'ink' },
  case_team: { text: 'لفريق القضية', tone: 'blue' },
  client_visible: { text: 'يراها الموكّل', tone: 'green' },
}

export const ACCESS_LEVEL: Record<string, Label> = {
  restricted: { text: 'مقيّد', tone: 'ink' },
  case_team: { text: 'لفريق القضية', tone: 'blue' },
  authorized_users: { text: 'مشارَك مع الموكّل', tone: 'green' },
}

export const CONTRACT_STATUS: Record<string, Label> = {
  draft: { text: 'مسودة', tone: 'ink' },
  under_review: { text: 'قيد المراجعة', tone: 'blue' },
  approved: { text: 'معتمد', tone: 'green' },
  signed: { text: 'موقّع', tone: 'red' },
  archived: { text: 'مؤرشف', tone: 'ink' },
}

export const INVITE_STATE: Record<string, Label> = {
  pending: { text: 'بانتظار القبول', tone: 'blue' },
  accepted: { text: 'قُبلت', tone: 'green' },
  revoked: { text: 'أُلغيت', tone: 'ink' },
  expired: { text: 'انتهت', tone: 'ink' },
}

export const MEMBER_STATUS: Record<string, Label> = {
  active: { text: 'فعّال', tone: 'green' },
  suspended: { text: 'موقوف', tone: 'red' },
}

export const PORTAL_STATUS: Record<string, Label> = {
  none: { text: 'لا حساب', tone: 'ink' },
  invited: { text: 'دعوة مرسلة', tone: 'blue' },
  active: { text: 'مفعّل', tone: 'green' },
  suspended: { text: 'موقوف', tone: 'red' },
}

export const PARTY_ROLE: Record<string, string> = {
  plaintiff: 'مدّعٍ',
  defendant: 'مدّعى عليه',
  applicant: 'مقدّم طلب',
  respondent: 'مستدعى ضدّه',
  witness: 'شاهد',
  client: 'موكّل',
}

/** Turns `{ open: {text}, … }` into `[value, text]` pairs for a <SelectField>. */
export const APPOINTMENT_TYPE: Record<string, string> = {
  meeting: 'لقاء مع موكّل',
  expert_session: 'جلسة خبرة',
  court_visit: 'مراجعة محكمة',
  other: 'موعد آخر',
}

export const optionsOf = (labels: Record<string, Label | string>) =>
  Object.entries(labels).map(([value, label]) => [value, typeof label === 'string' ? label : label.text] as const)

export const SUBSCRIPTION_STATE: Record<string, string> = {
  active: 'فعّال',
  grace: 'في مهلة السماح',
  expired: 'متوقف',
  none: 'بدون اشتراك',
}

export const PAYMENT_METHOD: Record<string, string> = {
  cash: 'نقداً',
  bank_transfer: 'تحويل بنكي',
  cheque: 'شيك',
  online: 'دفع إلكتروني',
  card: 'بطاقة',
  wallet: 'محفظة إلكترونية',
}

/** Payment methods an office records against a client invoice. */
export const CLIENT_PAYMENT_METHODS = ['cash', 'bank_transfer', 'cheque', 'card'] as const

export const INVOICE_CATEGORY: Record<string, string> = {
  legal_fees: 'أتعاب محاماة',
  court_fees: 'رسوم محكمة',
  expenses: 'مصاريف',
}

export const INVOICE_STATE: Record<string, Label> = {
  unpaid: { text: 'غير مدفوعة', tone: 'blue' },
  partially_paid: { text: 'مدفوعة جزئياً', tone: 'blue' },
  paid: { text: 'مدفوعة', tone: 'green' },
  overdue: { text: 'متأخرة', tone: 'red' },
  cancelled: { text: 'ملغاة', tone: 'ink' },
}

export const CURRENCY: Record<string, string> = {
  ILS: 'شيكل',
  JOD: 'دينار أردني',
  USD: 'دولار أمريكي',
}

export const PAYMENT_STATUS: Record<string, Label> = {
  paid: { text: 'مدفوعة', tone: 'green' },
  pending: { text: 'قيد المراجعة', tone: 'blue' },
  failed: { text: 'لم تكتمل', tone: 'ink' },
  rejected: { text: 'مرفوضة', tone: 'red' },
  cancelled: { text: 'ملغاة', tone: 'ink' },
}

/** "اليوم", "يوم واحد", "يومين", "5 أيام", "12 يوماً". */
export const daysText = (days: number) =>
  days <= 0 ? 'اليوم' : days === 1 ? 'يوم واحد' : days === 2 ? 'يومين' : days <= 10 ? `${days} أيام` : `${days} يوماً`

export const formatMoney = (amount: number, currency = 'ILS') =>
  new Intl.NumberFormat(LOCALE, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
