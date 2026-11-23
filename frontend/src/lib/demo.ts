/**
 * Demo mode: a small in-browser stand-in for the backend, so the whole interface can be seen
 * without PostgreSQL. It answers the same URLs with the same shapes as `backend-development`,
 * from fictional records kept in memory. Nothing here is real authentication.
 */
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import type {
  CaseNote,
  Client,
  Contract,
  DocumentRecord,
  Invitation,
  LegalCase,
  Member,
  Membership,
  Message,
  NotificationItem,
  OfficeSubscriptionRow,
  PaymentMethod,
  SubscriptionPayment,
  SubscriptionSummary,
  OfficeRole,
  PlatformOffice,
  Session,
  Task,
} from './types'

export const DEMO_PASSWORD = 'demo1234'
export const DEMO_ACCOUNTS = {
  owner: 'owner@demo.ps',
  staff: 'lawyer@demo.ps',
  client: 'client@demo.ps',
  platform: 'admin@demo.ps',
} as const

const OFFICE = 'o-1'
const daysFromNow = (days: number, hour = 9) => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(hour, 0, 0, 0)
  return date.toISOString()
}

type DemoUser = {
  user_id: string
  full_name: string
  email: string
  status: string
  is_platform_admin: boolean
  role: OfficeRole | null
  is_owner: boolean
  client_id?: string
}

const users: DemoUser[] = [
  { user_id: 'u-owner', full_name: 'سامر الخطيب', email: DEMO_ACCOUNTS.owner, status: 'active', is_platform_admin: false, role: 'admin', is_owner: true },
  { user_id: 'u-lawyer', full_name: 'ليان عودة', email: DEMO_ACCOUNTS.staff, status: 'active', is_platform_admin: false, role: 'lawyer', is_owner: false },
  { user_id: 'u-assistant', full_name: 'رنا حمدان', email: 'assistant@demo.ps', status: 'active', is_platform_admin: false, role: 'assistant', is_owner: false },
  { user_id: 'u-client', full_name: 'محمود النجار', email: DEMO_ACCOUNTS.client, status: 'active', is_platform_admin: false, role: 'client', is_owner: false, client_id: 'c-1' },
  { user_id: 'u-platform', full_name: 'مدير المنصّة', email: DEMO_ACCOUNTS.platform, status: 'active', is_platform_admin: true, role: null, is_owner: false },
]

const clients: Client[] = [
  { client_id: 'c-1', client_type: 'individual', full_name_or_org: 'محمود النجار', phone: '0599 120 344', email: DEMO_ACCOUNTS.client, address: 'نابلس — رفيديا', created_at: daysFromNow(-140) },
  { client_id: 'c-2', client_type: 'organization', full_name_or_org: 'شركة الزيتونة للتجارة', phone: '09 238 1100', email: 'legal@zaytouna.ps', address: 'رام الله — الماصيون', created_at: daysFromNow(-96) },
  { client_id: 'c-3', client_type: 'individual', full_name_or_org: 'هبة صالح', phone: '0568 771 902', email: null, address: 'جنين', created_at: daysFromNow(-61) },
  { client_id: 'c-4', client_type: 'individual', full_name_or_org: 'يوسف دراغمة', phone: '0597 440 018', email: 'y.daraghmeh@mail.ps', address: 'طوباس', created_at: daysFromNow(-30) },
  { client_id: 'c-5', client_type: 'organization', full_name_or_org: 'جمعية الأمل الخيرية', phone: '04 250 7733', email: null, address: 'طولكرم', created_at: daysFromNow(-12) },
]

const cases: LegalCase[] = [
  { case_id: 'k-1', case_number: '2026/114', title: 'مطالبة مالية — النجار ضد شركة البناء الحديث', case_type: 'civil', status: 'in_progress', priority: 'high', opened_at: daysFromNow(-120), closed_at: null, description: 'مطالبة بمستحقات عقد مقاولة بقيمة 86,000 شيكل مع التعويض عن التأخير.', court_id: null },
  { case_id: 'k-2', case_number: '2026/131', title: 'نزاع عقد توريد — شركة الزيتونة', case_type: 'commercial', status: 'open', priority: 'medium', opened_at: daysFromNow(-80), closed_at: null, description: 'إخلال المورّد بمواعيد التسليم المتفق عليها.', court_id: null },
  { case_id: 'k-3', case_number: '2026/152', title: 'دعوى نفقة وحضانة — هبة صالح', case_type: 'family', status: 'in_progress', priority: 'urgent', opened_at: daysFromNow(-55), closed_at: null, description: null, court_id: null },
  { case_id: 'k-4', case_number: '2026/167', title: 'إخلاء مأجور — يوسف دراغمة', case_type: 'civil', status: 'on_hold', priority: 'low', opened_at: daysFromNow(-28), closed_at: null, description: 'بانتظار تقرير الخبير.', court_id: null },
  { case_id: 'k-5', case_number: '2025/418', title: 'تسجيل علامة تجارية — الزيتونة', case_type: 'commercial', status: 'closed', priority: 'medium', opened_at: daysFromNow(-300), closed_at: daysFromNow(-40), description: null, court_id: null },
  { case_id: 'k-6', case_number: '2026/171', title: 'منازعة عمالية — جمعية الأمل', case_type: 'labor', status: 'open', priority: 'medium', opened_at: daysFromNow(-9), closed_at: null, description: null, court_id: null },
]

const involves = [
  { case_id: 'k-1', client_id: 'c-1', party_role: 'plaintiff', is_primary: true },
  { case_id: 'k-2', client_id: 'c-2', party_role: 'plaintiff', is_primary: true },
  { case_id: 'k-3', client_id: 'c-3', party_role: 'plaintiff', is_primary: true },
  { case_id: 'k-4', client_id: 'c-4', party_role: 'defendant', is_primary: true },
  { case_id: 'k-5', client_id: 'c-2', party_role: 'applicant', is_primary: true },
  { case_id: 'k-6', client_id: 'c-5', party_role: 'defendant', is_primary: true },
]

const assignments = [
  { case_id: 'k-1', user_id: 'u-lawyer', assignment_role: 'lead_lawyer', is_lead: true, assigned_at: daysFromNow(-119) },
  { case_id: 'k-1', user_id: 'u-assistant', assignment_role: 'assistant', is_lead: false, assigned_at: daysFromNow(-100) },
  { case_id: 'k-2', user_id: 'u-owner', assignment_role: 'lead_lawyer', is_lead: true, assigned_at: daysFromNow(-80) },
  { case_id: 'k-3', user_id: 'u-lawyer', assignment_role: 'lead_lawyer', is_lead: true, assigned_at: daysFromNow(-55) },
  { case_id: 'k-4', user_id: 'u-lawyer', assignment_role: 'lawyer', is_lead: true, assigned_at: daysFromNow(-27) },
  { case_id: 'k-6', user_id: 'u-owner', assignment_role: 'lead_lawyer', is_lead: true, assigned_at: daysFromNow(-9) },
]

type DemoTask = Task & { assigned_to_user_id: string }
const tasks: DemoTask[] = [
  { task_id: 't-1', title: 'تحضير لائحة جوابية', description: 'الرد على مذكرة المدعى عليه.', status: 'in_progress', priority: 'high', due_at: daysFromNow(1, 14), completed_at: null, case_id: 'k-1', assigned_to_user_id: 'u-lawyer', assigned_to_name: 'ليان عودة', created_by_name: 'سامر الخطيب' },
  { task_id: 't-2', title: 'تصوير مستندات الملكية وتوثيقها', description: null, status: 'pending', priority: 'medium', due_at: daysFromNow(3), completed_at: null, case_id: 'k-4', assigned_to_user_id: 'u-assistant', assigned_to_name: 'رنا حمدان', created_by_name: 'سامر الخطيب' },
  { task_id: 't-3', title: 'الاتصال بالموكّلة لتأكيد موعد الجلسة', description: null, status: 'pending', priority: 'urgent', due_at: daysFromNow(0, 16), completed_at: null, case_id: 'k-3', assigned_to_user_id: 'u-lawyer', assigned_to_name: 'ليان عودة', created_by_name: 'ليان عودة' },
  { task_id: 't-4', title: 'مراجعة عقد التوريد وبنود الجزاء', description: null, status: 'pending', priority: 'medium', due_at: daysFromNow(5), completed_at: null, case_id: 'k-2', assigned_to_user_id: 'u-owner', assigned_to_name: 'سامر الخطيب', created_by_name: 'سامر الخطيب' },
  { task_id: 't-5', title: 'دفع رسوم الدعوى', description: null, status: 'completed', priority: 'low', due_at: daysFromNow(-6), completed_at: daysFromNow(-7), case_id: 'k-6', assigned_to_user_id: 'u-assistant', assigned_to_name: 'رنا حمدان', created_by_name: 'سامر الخطيب' },
  { task_id: 't-6', title: 'أرشفة ملف العلامة التجارية', description: null, status: 'completed', priority: 'low', due_at: daysFromNow(-35), completed_at: daysFromNow(-36), case_id: 'k-5', assigned_to_user_id: 'u-lawyer', assigned_to_name: 'ليان عودة', created_by_name: 'سامر الخطيب' },
]

const notes: CaseNote[] = [
  { note_id: 'n-1', case_id: 'k-1', body: 'قُدّمت لائحة الدعوى وتحدّدت أول جلسة. المطلوب إحضار أصل عقد المقاولة.', visibility: 'client_visible', created_at: daysFromNow(-110), updated_at: null },
  { note_id: 'n-2', case_id: 'k-1', body: 'الخصم يلمّح إلى تسوية. لا نبلغ الموكّل قبل عرض مكتوب.', visibility: 'internal', created_at: daysFromNow(-20), updated_at: null },
  { note_id: 'n-3', case_id: 'k-1', body: 'أُجّلت الجلسة لسماع شاهد المدعي. الجلسة القادمة خلال أسبوعين.', visibility: 'client_visible', created_at: daysFromNow(-6), updated_at: null },
  { note_id: 'n-4', case_id: 'k-3', body: 'تم تقديم طلب نفقة مؤقتة.', visibility: 'case_team', created_at: daysFromNow(-30), updated_at: null },
]

const documents: (DocumentRecord & { client_id: string | null })[] = [
  { document_id: 'd-1', case_id: 'k-1', client_id: 'c-1', file_name: 'claim-statement.pdf', mime_type: 'application/pdf', document_type: 'لائحة دعوى', source: 'المكتب', document_date: '2026-07-14', access_level: 'authorized_users', created_at: daysFromNow(-118) },
  { document_id: 'd-2', case_id: 'k-1', client_id: null, file_name: 'construction-contract.pdf', mime_type: 'application/pdf', document_type: 'عقد', source: 'الموكّل', document_date: '2025-02-02', access_level: 'case_team', created_at: daysFromNow(-115) },
  { document_id: 'd-3', case_id: 'k-3', client_id: null, file_name: 'custody-request.pdf', mime_type: 'application/pdf', document_type: 'طلب', source: 'المكتب', document_date: null, access_level: 'restricted', created_at: daysFromNow(-50) },
  { document_id: 'd-4', case_id: 'k-2', client_id: null, file_name: 'supply-agreement.pdf', mime_type: 'application/pdf', document_type: 'عقد', source: 'الموكّل', document_date: '2025-11-20', access_level: 'case_team', created_at: daysFromNow(-78) },
]

const contracts: Contract[] = [
  { contract_id: 'ct-1', title: 'اتفاقية أتعاب — محمود النجار', contract_type: 'أتعاب محاماة', status: 'signed', created_at: daysFromNow(-121), client_id: 'c-1', case_id: 'k-1' },
  { contract_id: 'ct-2', title: 'اتفاقية استشارات سنوية — الزيتونة', contract_type: 'استشارات', status: 'approved', created_at: daysFromNow(-90), client_id: 'c-2', case_id: null },
  { contract_id: 'ct-3', title: 'توكيل خاص — هبة صالح', contract_type: 'وكالة', status: 'under_review', created_at: daysFromNow(-54), client_id: 'c-3', case_id: 'k-3' },
]

const invitations: Invitation[] = [
  { invitation_id: 'i-1', email: 'new.lawyer@mail.ps', role: 'lawyer', client_id: null, state: 'pending', expires_at: daysFromNow(5), created_at: daysFromNow(-2) },
  { invitation_id: 'i-2', email: 'legal@zaytouna.ps', role: 'client', client_id: 'c-2', state: 'pending', expires_at: daysFromNow(6), created_at: daysFromNow(-1) },
]

const platformOffices: PlatformOffice[] = [
  { office_id: OFFICE, name: 'مكتب الخطيب للمحاماة', email: 'info@khatib-law.ps', phone: '09 233 4410', city: 'نابلس', address: 'شارع سفيان، عمارة العدل', license_number: 'NB-2019-044', status: 'active', review_note: null, reviewed_at: daysFromNow(-200), created_at: daysFromNow(-204), owner_user_id: 'u-owner', owner_name: 'سامر الخطيب', owner_email: DEMO_ACCOUNTS.owner, owner_account_status: 'active', owner_bar_number: '4471' },
  { office_id: 'o-2', name: 'مكتب دار الحق للاستشارات القانونية', email: null, phone: '02 295 1180', city: 'رام الله', address: 'البيرة — شارع القدس', license_number: 'RM-2024-210', status: 'pending', review_note: null, reviewed_at: null, created_at: daysFromNow(-2), owner_user_id: 'u-x1', owner_name: 'نادين برغوثي', owner_email: 'nadine@daralhaq.ps', owner_account_status: 'active', owner_bar_number: '6120' },
  { office_id: 'o-3', name: 'مكتب العدالة للمحاماة', email: 'office@adala.ps', phone: '04 243 9902', city: 'جنين', address: null, license_number: null, status: 'pending', review_note: null, reviewed_at: null, created_at: daysFromNow(-1), owner_user_id: 'u-x2', owner_name: 'خالد جرّار', owner_email: 'khaled@adala.ps', owner_account_status: 'active', owner_bar_number: '5833' },
  { office_id: 'o-4', name: 'مكتب الميزان', email: null, phone: '08 282 0071', city: 'الخليل', address: null, license_number: 'HB-2021-018', status: 'suspended', review_note: 'لم تُجدَّد رخصة المزاولة.', reviewed_at: daysFromNow(-15), created_at: daysFromNow(-400), owner_user_id: 'u-x3', owner_name: 'إياد القواسمي', owner_email: 'iyad@mizan.ps', owner_account_status: 'active', owner_bar_number: '3907' },
]

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const messages: Message[] = [
  { message_id: 'm-1', sender_user_id: 'u-client', receiver_user_id: 'u-lawyer', body: 'مرحباً أستاذة ليان، هل تحدّد موعد الجلسة القادمة؟', sent_at: minutesAgo(190), read_at: minutesAgo(180) },
  { message_id: 'm-2', sender_user_id: 'u-lawyer', receiver_user_id: 'u-client', body: 'أهلاً محمود. نعم، الأحد القادم الساعة 10:30 في محكمة بداية نابلس.', sent_at: minutesAgo(175), read_at: minutesAgo(170) },
  { message_id: 'm-3', sender_user_id: 'u-lawyer', receiver_user_id: 'u-client', body: 'الرجاء إحضار أصل عقد المقاولة معك.', sent_at: minutesAgo(40), read_at: null },
  { message_id: 'm-4', sender_user_id: 'u-lawyer', receiver_user_id: 'u-owner', body: 'أستاذ سامر، الخصم في قضية النجار يلمّح إلى تسوية. هل نتابع؟', sent_at: minutesAgo(95), read_at: null },
  { message_id: 'm-5', sender_user_id: 'u-owner', receiver_user_id: 'u-assistant', body: 'رنا، جهّزي نسخ مستندات الملكية قبل الخميس.', sent_at: minutesAgo(300), read_at: minutesAgo(280) },
]

type DemoNotification = NotificationItem & { user_id: string }
const notifications: DemoNotification[] = [
  { notification_id: 'nt-1', user_id: 'u-owner', title: 'رسالة جديدة', body: 'وصلتك رسالة جديدة من ليان عودة.', notification_type: 'message', read_at: null, created_at: minutesAgo(95) },
  { notification_id: 'nt-2', user_id: 'u-owner', title: 'أُنجزت مهمة', body: 'أنجز أحد أعضاء المكتب مهمة مسندة إليه.', notification_type: 'task', read_at: null, created_at: minutesAgo(400) },
  { notification_id: 'nt-3', user_id: 'u-owner', title: 'ملاحظة جديدة على قضية', body: 'أُضيفت ملاحظة جديدة على القضية رقم 2026/114.', notification_type: 'case_note', read_at: minutesAgo(900), created_at: minutesAgo(1500) },
  { notification_id: 'nt-4', user_id: 'u-lawyer', title: 'مهمة جديدة لك', body: 'أُسندت إليك مهمة جديدة في المكتب.', notification_type: 'task', read_at: null, created_at: minutesAgo(120) },
  { notification_id: 'nt-5', user_id: 'u-lawyer', title: 'أُسندت إليك قضية', body: 'أُسندت إليك القضية رقم 2026/167.', notification_type: 'case_assignment', read_at: minutesAgo(2000), created_at: minutesAgo(3000) },
  { notification_id: 'nt-6', user_id: 'u-client', title: 'تحديث جديد على قضيتك', body: 'كتب مكتبك تحديثاً جديداً على قضيتك رقم 2026/114.', notification_type: 'case_note', read_at: null, created_at: minutesAgo(60) },
  { notification_id: 'nt-7', user_id: 'u-client', title: 'رسالة جديدة', body: 'وصلتك رسالة جديدة من ليان عودة.', notification_type: 'message', read_at: null, created_at: minutesAgo(40) },
]

platformOffices.push(
  { office_id: 'o-5', name: 'مكتب القدس للمحاماة', email: 'info@quds-law.ps', phone: '02 240 1188', city: 'رام الله', address: null, license_number: 'RM-2020-077', status: 'active', review_note: null, reviewed_at: daysFromNow(-300), created_at: daysFromNow(-302), owner_user_id: 'u-x4', owner_name: 'رامي عبد الله', owner_email: 'rami@quds-law.ps', owner_account_status: 'active', owner_bar_number: '4120' },
  { office_id: 'o-6', name: 'مكتب النجاح القانوني', email: null, phone: '09 237 5521', city: 'نابلس', address: null, license_number: 'NB-2022-131', status: 'active', review_note: null, reviewed_at: daysFromNow(-150), created_at: daysFromNow(-152), owner_user_id: 'u-x5', owner_name: 'سلمى يعيش', owner_email: 'salma@najah-law.ps', owner_account_status: 'active', owner_bar_number: '5571' },
)

/* ───────────── subscriptions (same rules as the backend) ───────────── */

const PLAN = { monthly_price: 100, currency: 'ILS', grace_days: 7, trial_days: 30 }
const subscriptionEnds: Record<string, string | null> = {
  'o-1': daysFromNow(5),
  'o-4': daysFromNow(-40),
  'o-5': daysFromNow(-12),
  'o-6': daysFromNow(-3),
}
type DemoPayment = SubscriptionPayment & { office_id: string }
const subscriptionPayments: DemoPayment[] = [
  { payment_id: 'sp-1', office_id: 'o-1', amount: 300, currency: 'ILS', months: 3, method: 'bank_transfer', status: 'paid', reference: 'TR-20418', period_start: daysFromNow(-85), period_end: daysFromNow(5), created_at: daysFromNow(-85), paid_at: daysFromNow(-85), recorded_by_name: 'مدير المنصّة' },
  { payment_id: 'sp-2', office_id: 'o-1', amount: 100, currency: 'ILS', months: 1, method: 'cash', status: 'paid', reference: null, period_start: daysFromNow(-115), period_end: daysFromNow(-85), created_at: daysFromNow(-115), paid_at: daysFromNow(-115), recorded_by_name: 'مدير المنصّة' },
  { payment_id: 'sp-3', office_id: 'o-5', amount: 600, currency: 'ILS', months: 6, method: 'online', status: 'paid', reference: 'pi_3Q8x', period_start: daysFromNow(-192), period_end: daysFromNow(-12), created_at: daysFromNow(-192), paid_at: daysFromNow(-192), recorded_by_name: null },
  { payment_id: 'sp-4', office_id: 'o-6', amount: 100, currency: 'ILS', months: 1, method: 'cheque', status: 'paid', reference: 'CHQ-7781', period_start: daysFromNow(-33), period_end: daysFromNow(-3), created_at: daysFromNow(-33), paid_at: daysFromNow(-33), recorded_by_name: 'مدير المنصّة' },
]

const summaryOf = (endsAt: string | null | undefined): SubscriptionSummary => {
  if (!endsAt) return { state: 'none', ends_at: null, grace_ends_at: null, days_left: null }
  const end = new Date(endsAt).getTime()
  const graceEnd = end + PLAN.grace_days * 86_400_000
  const now = Date.now()
  const state = now >= graceEnd ? 'expired' : now >= end ? 'grace' : 'active'
  const target = state === 'active' ? end : graceEnd
  return { state, ends_at: new Date(end).toISOString(), grace_ends_at: new Date(graceEnd).toISOString(), days_left: Math.max(0, Math.ceil((target - now) / 86_400_000)) }
}

/** Extends an office from the later of now and its end date, as the backend does. */
const recordPayment = (officeId: string, amount: number, months: number, method: PaymentMethod, reference: string | null, recorder: string | null) => {
  const current = subscriptionEnds[officeId]
  const start = new Date(Math.max(Date.now(), current ? new Date(current).getTime() : 0))
  const end = new Date(start)
  end.setMonth(end.getMonth() + months)
  subscriptionEnds[officeId] = end.toISOString()
  const payment: DemoPayment = { payment_id: uid('sp'), office_id: officeId, amount, currency: PLAN.currency, months, method, status: 'paid', reference, period_start: start.toISOString(), period_end: end.toISOString(), created_at: new Date().toISOString(), paid_at: new Date().toISOString(), recorded_by_name: recorder }
  subscriptionPayments.unshift(payment)
  if (officeId === OFFICE) {
    notifications.push({ notification_id: uid('nt'), user_id: 'u-owner', title: 'سُجّلت دفعة اشتراك', body: `سُجّلت دفعة اشتراك لمكتبك، والاشتراك فعّال حتى ${new Intl.DateTimeFormat('ar-PS-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }).format(end)}.`, notification_type: 'subscription', read_at: null, created_at: payment.created_at })
  }
  return payment
}

/* ───────────── session ───────────── */

const KEY = 'qadiyati.demo.user'
const currentUser = () => users.find((user) => user.user_id === sessionStorage.getItem(KEY)) ?? null

const membershipOf = (user: DemoUser): Membership[] =>
  user.role
    ? [{ office_id: OFFICE, office_name: 'مكتب الخطيب للمحاماة', office_status: 'active', office_city: 'نابلس', role: user.role, membership_status: 'active', is_owner: user.is_owner }]
    : []

const sessionOf = (user: DemoUser): Session => {
  const memberships = membershipOf(user)
  return {
    user: { user_id: user.user_id, full_name: user.full_name, email: user.email, status: user.status, is_platform_admin: user.is_platform_admin },
    role: user.role,
    active_office: memberships[0] ?? null,
    memberships,
    subscription: memberships[0] ? summaryOf(subscriptionEnds[OFFICE]) : null,
  }
}

/* ───────────── helpers ───────────── */

class Reply extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super('demo reply')
  }
}
const fail = (status: number, code: string, extra: object = {}) => new Reply(status, { code, error: code, ...extra })
const decode = (value: unknown, fallback: string) => {
  try {
    return typeof value === 'string' && value ? decodeURIComponent(value) : fallback
  } catch {
    return fallback
  }
}
const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`

const paginate = <T,>(rows: T[], key: string) => ({
  [key]: rows,
  pagination: { page: 1, pageSize: 50, total: rows.length, totalPages: rows.length ? 1 : 0 },
})

const matches = (search: unknown, ...values: (string | null)[]) =>
  typeof search !== 'string' || !search.trim()
    ? true
    : values.some((value) => value?.toLowerCase().includes(search.trim().toLowerCase()))

/** Cases a user may see: everything for the office admin, own assignments for staff, own records for a client. */
const visibleCases = (user: DemoUser) => {
  if (user.role === 'admin') return cases
  if (user.role === 'client')
    return cases.filter((row) => involves.some((link) => link.case_id === row.case_id && link.client_id === user.client_id))
  return cases.filter((row) => assignments.some((link) => link.case_id === row.case_id && link.user_id === user.user_id))
}
const caseFor = (user: DemoUser, caseId: string) => {
  const found = visibleCases(user).find((row) => row.case_id === caseId)
  if (!found) throw fail(404, 'NOT_FOUND')
  return found
}

/** Who a user may write to: the same rule the backend enforces in SQL. */
const contactsOf = (user: DemoUser): DemoUser[] => {
  const members = users.filter((entry) => entry.role && entry.user_id !== user.user_id && entry.status === 'active')
  if (user.role === 'admin') return members
  const casesOf = (userId: string) => assignments.filter((link) => link.user_id === userId).map((link) => link.case_id)
  const clientCases = (clientId?: string) => involves.filter((link) => link.client_id === clientId).map((link) => link.case_id)
  if (user.role === 'client') {
    const mine = clientCases(user.client_id)
    return members.filter((entry) => entry.role !== 'client' && casesOf(entry.user_id).some((caseId) => mine.includes(caseId)))
  }
  const mine = casesOf(user.user_id)
  return members.filter((entry) => entry.role === 'admin' || (entry.role === 'client' && clientCases(entry.client_id).some((caseId) => mine.includes(caseId))))
}
const between = (a: string, b: string) => (message: Message) =>
  (message.sender_user_id === a && message.receiver_user_id === b) || (message.sender_user_id === b && message.receiver_user_id === a)
const contactFor = (user: DemoUser, userId: string) => {
  const contact = contactsOf(user).find((entry) => entry.user_id === userId)
  if (!contact) throw fail(404, 'NOT_FOUND')
  return contact
}

type Ctx = { user: DemoUser; params: string[]; query: Record<string, unknown>; body: Record<string, unknown>; headers: Record<string, unknown> }
type Route = [method: string, pattern: RegExp, roles: readonly (OfficeRole | 'platform' | 'any')[], handler: (ctx: Ctx) => unknown]

const STAFF = ['admin', 'lawyer', 'assistant'] as const
const ALL = ['admin', 'lawyer', 'assistant', 'client'] as const

const routes: Route[] = [
  ['get', /^\/me$/, ['any'], ({ user }) => sessionOf(user)],
  ['post', /^\/logout$/, ['any'], () => { sessionStorage.removeItem(KEY); return { ok: true } }],
  ['get', /^\/offices\/mine$/, ['any'], ({ user }) => ({ memberships: membershipOf(user) })],
  ['post', /^\/session\/office$/, ['any'], () => ({ ok: true })],
  ['post', /^\/offices$/, ['any'], ({ body }) => {
    const office = body.office as { name: string; phone: string; city: string }
    platformOffices.unshift({ office_id: uid('o'), name: office.name, email: null, phone: office.phone, city: office.city, address: null, license_number: null, status: 'pending', review_note: null, reviewed_at: null, created_at: new Date().toISOString(), owner_user_id: 'u-new', owner_name: 'حساب جديد', owner_email: 'new@demo.ps', owner_account_status: 'active', owner_bar_number: null })
    return { office: { office_id: 'o-new', name: office.name, status: 'pending', created_at: new Date().toISOString() } }
  }],

  // cases
  ['get', /^\/cases$/, ALL, ({ user, query }) => paginate(visibleCases(user).filter((row) => matches(query.search, row.title, row.case_number)), 'cases')],
  ['post', /^\/cases$/, ['admin'], ({ body }) => {
    const row: LegalCase = { case_id: uid('k'), case_number: String(body.case_number), title: String(body.title), case_type: String(body.case_type ?? 'civil'), status: 'open', priority: (body.priority as LegalCase['priority']) ?? 'medium', opened_at: new Date().toISOString(), closed_at: null, description: (body.description as string) ?? null, court_id: null }
    cases.unshift(row)
    return { case: row }
  }],
  ['get', /^\/cases\/([^/]+)$/, ALL, ({ user, params }) => ({ case: caseFor(user, params[0]!) })],
  ['patch', /^\/cases\/([^/]+)$/, STAFF, ({ user, params, body }) => {
    const row = caseFor(user, params[0]!)
    Object.assign(row, body)
    if (body.status === 'closed') row.closed_at = new Date().toISOString()
    return { case: row }
  }],
  ['get', /^\/cases\/([^/]+)\/relationships$/, ALL, ({ user, params }) => {
    const row = caseFor(user, params[0]!)
    const staff = assignments.filter((link) => link.case_id === row.case_id).map((link) => {
      const member = users.find((entry) => entry.user_id === link.user_id)!
      return { user_id: member.user_id, full_name: member.full_name, role: member.role!, assignment_role: link.assignment_role, is_lead: link.is_lead, assigned_at: link.assigned_at }
    })
    if (user.role === 'client') return { relationships: { assigned_staff: staff.map(({ full_name, assignment_role }) => ({ full_name, assignment_role })) } }
    const parties = involves.filter((link) => link.case_id === row.case_id).map((link) => {
      const client = clients.find((entry) => entry.client_id === link.client_id)!
      return { client_id: client.client_id, client_type: client.client_type, full_name_or_org: client.full_name_or_org, party_role: link.party_role, is_primary: link.is_primary }
    })
    return { relationships: { case_id: row.case_id, clients: parties, assigned_staff: staff } }
  }],
  ['post', /^\/cases\/([^/]+)\/clients$/, ['admin'], ({ params, body }) => {
    const link = { case_id: params[0]!, client_id: String(body.client_id), party_role: String(body.party_role ?? 'plaintiff'), is_primary: Boolean(body.is_primary) }
    involves.push(link)
    return { relationship: link }
  }],
  ['post', /^\/cases\/([^/]+)\/assignments$/, ['admin'], ({ params, body }) => {
    const link = { case_id: params[0]!, user_id: String(body.user_id), assignment_role: String(body.assignment_role ?? 'lawyer'), is_lead: Boolean(body.is_lead), assigned_at: new Date().toISOString() }
    assignments.push(link)
    return { assignment: link }
  }],
  ['get', /^\/cases\/([^/]+)\/notes$/, ALL, ({ user, params }) => {
    const row = caseFor(user, params[0]!)
    const rows = notes.filter((note) => note.case_id === row.case_id && (user.role !== 'client' || note.visibility === 'client_visible'))
    return paginate([...rows].reverse(), 'notes')
  }],
  ['post', /^\/cases\/([^/]+)\/notes$/, STAFF, ({ user, params, body }) => {
    const row = caseFor(user, params[0]!)
    const note: CaseNote = { note_id: uid('n'), case_id: row.case_id, body: String(body.body), visibility: (body.visibility as CaseNote['visibility']) ?? 'case_team', created_at: new Date().toISOString(), updated_at: null }
    notes.push(note)
    return { note }
  }],
  ['post', /^\/cases\/([^/]+)\/documents$/, STAFF, ({ user, params, headers }) => {
    const row = caseFor(user, params[0]!)
    const document = { document_id: uid('d'), case_id: row.case_id, client_id: null, file_name: String(headers['X-Document-File-Name'] ?? 'document.pdf'), mime_type: 'application/pdf', document_type: decode(headers['X-Document-Type'], 'مستند'), source: null, document_date: null, access_level: (headers['X-Document-Access-Level'] as DocumentRecord['access_level']) ?? 'restricted', created_at: new Date().toISOString() }
    documents.unshift(document)
    return { document }
  }],

  // clients
  ['get', /^\/clients\/me$/, ['client'], ({ user }) => ({ client: clients.find((row) => row.client_id === user.client_id) })],
  ['get', /^\/clients$/, STAFF, ({ query }) => paginate(clients.filter((row) => matches(query.search, row.full_name_or_org, row.phone, row.email)), 'clients')],
  ['post', /^\/clients$/, ['admin'], ({ body }) => {
    const row: Client = { client_id: uid('c'), client_type: (body.client_type as Client['client_type']) ?? 'individual', full_name_or_org: String(body.full_name_or_org), phone: (body.phone as string) || null, email: (body.email as string) || null, address: (body.address as string) || null, created_at: new Date().toISOString() }
    clients.unshift(row)
    return { client: row }
  }],
  ['get', /^\/clients\/([^/]+)$/, STAFF, ({ params }) => {
    const row = clients.find((entry) => entry.client_id === params[0])
    if (!row) throw fail(404, 'NOT_FOUND')
    return { client: row }
  }],
  ['patch', /^\/clients\/([^/]+)$/, STAFF, ({ params, body }) => {
    const row = clients.find((entry) => entry.client_id === params[0])
    if (!row) throw fail(404, 'NOT_FOUND')
    Object.assign(row, body)
    return { client: row }
  }],
  ['get', /^\/clients\/([^/]+)\/cases$/, ALL, ({ user, params }) =>
    paginate(visibleCases(user).filter((row) => involves.some((link) => link.case_id === row.case_id && link.client_id === params[0])), 'cases')],

  // tasks
  ['get', /^\/tasks$/, STAFF, ({ user, query }) =>
    paginate(tasks.filter((task) => (user.role === 'admin' || task.assigned_to_user_id === user.user_id) && (!query.caseId || task.case_id === query.caseId) && (!query.status || task.status === query.status) && matches(query.search, task.title)), 'tasks')],
  ['post', /^\/tasks$/, ['admin'], ({ user, body }) => {
    const assignee = users.find((entry) => entry.user_id === body.assigned_to_user_id) ?? user
    const task: DemoTask = { task_id: uid('t'), title: String(body.title), description: (body.description as string) ?? null, status: 'pending', priority: (body.priority as Task['priority']) ?? 'medium', due_at: (body.due_at as string) ?? null, completed_at: null, case_id: (body.case_id as string) ?? null, assigned_to_user_id: assignee.user_id, assigned_to_name: assignee.full_name, created_by_name: user.full_name }
    tasks.unshift(task)
    return { task }
  }],
  ['patch', /^\/tasks\/([^/]+)$/, STAFF, ({ params, body }) => {
    const task = tasks.find((entry) => entry.task_id === params[0])
    if (!task) throw fail(404, 'NOT_FOUND')
    Object.assign(task, body)
    task.completed_at = task.status === 'completed' ? new Date().toISOString() : null
    return { task }
  }],

  // documents and contracts
  ['get', /^\/documents$/, ALL, ({ user, query }) => {
    const allowed = new Set(visibleCases(user).map((row) => row.case_id))
    return paginate(documents.filter((row) => allowed.has(row.case_id) && (!query.caseId || row.case_id === query.caseId) && (user.role !== 'client' || (row.access_level === 'authorized_users' && row.client_id === user.client_id)) && matches(query.search, row.file_name, row.document_type)), 'documents')
  }],
  ['get', /^\/contracts$/, ALL, ({ user, query }) =>
    paginate(contracts.filter((row) => (user.role !== 'client' || row.client_id === user.client_id) && (!query.clientId || row.client_id === query.clientId) && (!query.caseId || row.case_id === query.caseId) && matches(query.search, row.title)), 'contracts')],
  ['post', /^\/clients\/([^/]+)\/contracts$/, STAFF, ({ params, headers }) => {
    const contract: Contract = { contract_id: uid('ct'), title: decode(headers['X-Contract-Title'], 'عقد'), contract_type: decode(headers['X-Contract-Type'], 'عقد'), status: 'draft', created_at: new Date().toISOString(), client_id: params[0]!, case_id: null }
    contracts.unshift(contract)
    return { contract }
  }],
  ['patch', /^\/contracts\/([^/]+)$/, STAFF, ({ params, body }) => {
    const contract = contracts.find((entry) => entry.contract_id === params[0])
    if (!contract) throw fail(404, 'NOT_FOUND')
    Object.assign(contract, body)
    return { contract }
  }],

  // team
  ['get', /^\/users$/, ['admin'], () =>
    paginate(users.filter((user) => user.role).map((user): Member => ({ user_id: user.user_id, full_name: user.full_name, email: user.email, status: user.status === 'active' ? 'active' : 'suspended', role: user.role!, created_at: daysFromNow(-150) })), 'users')],
  ['patch', /^\/users\/([^/]+)\/status$/, ['admin'], ({ params, body }) => {
    const member = users.find((entry) => entry.user_id === params[0])
    if (!member) throw fail(404, 'NOT_FOUND')
    member.status = String(body.status)
    return { user: member }
  }],
  ['get', /^\/offices\/current\/invitations$/, ['admin'], () => ({ invitations })],
  ['post', /^\/offices\/current\/invitations$/, ['admin'], ({ body }) => {
    const invitation: Invitation = { invitation_id: uid('i'), email: String(body.email), role: body.role as Invitation['role'], client_id: (body.client_id as string) ?? null, state: 'pending', expires_at: daysFromNow(7), created_at: new Date().toISOString() }
    invitations.unshift(invitation)
    return { invitation, invite_url: `${location.origin}/invite/${uid('demo')}`, email_sent: false }
  }],
  ['delete', /^\/offices\/current\/invitations\/([^/]+)$/, ['admin'], ({ params }) => {
    const invitation = invitations.find((entry) => entry.invitation_id === params[0])
    if (invitation) invitation.state = 'revoked'
    return { ok: true }
  }],

  // subscriptions
  ['get', /^\/platform\/subscriptions$/, ['platform'], () => ({
    plan: PLAN,
    offices: platformOffices
      .filter((office) => office.status === 'active' || office.status === 'suspended')
      .map((office): OfficeSubscriptionRow => {
        const paid = subscriptionPayments.filter((payment) => payment.office_id === office.office_id && payment.status === 'paid')
        const last = paid[0]
        return { office_id: office.office_id, name: office.name, city: office.city, status: office.status, owner_name: office.owner_name, owner_email: office.owner_email, last_paid_at: last?.paid_at ?? null, last_amount: last?.amount ?? null, last_currency: last?.currency ?? null, last_method: last?.method ?? null, paid_total: paid.reduce((sum, payment) => sum + payment.amount, 0), subscription: summaryOf(subscriptionEnds[office.office_id]) }
      })
      .sort((a, b) => (a.subscription.ends_at ?? '').localeCompare(b.subscription.ends_at ?? '')),
  })],
  ['get', /^\/platform\/offices\/([^/]+)\/payments$/, ['platform'], ({ params }) => ({ payments: subscriptionPayments.filter((payment) => payment.office_id === params[0]) })],
  ['post', /^\/platform\/offices\/([^/]+)\/payments$/, ['platform'], ({ params, body }) => {
    const amount = Number(body.amount)
    const months = Number(body.months)
    if (!(amount > 0) || !Number.isInteger(months) || months < 1 || months > 24 || !['cash', 'bank_transfer', 'cheque'].includes(String(body.method))) throw fail(400, 'VALIDATION')
    const payment = recordPayment(params[0]!, amount, months, body.method as PaymentMethod, (body.reference as string)?.trim() || null, 'مدير المنصّة')
    return { payment, subscription_ends_at: subscriptionEnds[params[0]!] }
  }],
  ['get', /^\/offices\/current\/subscription$/, ['admin'], () => ({
    subscription: summaryOf(subscriptionEnds[OFFICE]),
    plan: PLAN,
    online_payments: true,
    payments: subscriptionPayments.filter((payment) => payment.office_id === OFFICE).map(({ recorded_by_name: _recorder, ...payment }) => payment),
  })],
  ['post', /^\/offices\/current\/subscription\/checkout$/, ['admin'], ({ body }) => {
    // Demo stand-in for Stripe Checkout: the payment succeeds at once and the browser returns.
    const months = Number(body.months)
    if (!Number.isInteger(months) || months < 1 || months > 12) throw fail(400, 'VALIDATION')
    recordPayment(OFFICE, PLAN.monthly_price * months, months, 'online', 'demo', null)
    return { checkout_url: `${location.origin}/office/subscription?payment=success` }
  }],

  // platform
  ['get', /^\/platform\/offices$/, ['platform'], () => ({ offices: platformOffices })],
  ['patch', /^\/platform\/offices\/([^/]+)$/, ['platform'], ({ params, body }) => {
    const office = platformOffices.find((entry) => entry.office_id === params[0])
    if (!office) throw fail(404, 'NOT_FOUND')
    office.status = body.status as PlatformOffice['status']
    office.review_note = (body.review_note as string) ?? null
    office.reviewed_at = new Date().toISOString()
    return { office }
  }],

  // inbox: notifications and direct messages
  ['get', /^\/notifications$/, ALL, ({ user }) => {
    const mine = notifications.filter((entry) => entry.user_id === user.user_id).sort((a, b) => b.created_at.localeCompare(a.created_at))
    return { notifications: mine, unread: mine.filter((entry) => !entry.read_at).length }
  }],
  ['post', /^\/notifications\/read$/, ALL, ({ user }) => {
    const now = new Date().toISOString()
    for (const entry of notifications) if (entry.user_id === user.user_id && !entry.read_at) entry.read_at = now
    return { updated: 1 }
  }],
  ['get', /^\/messages\/contacts$/, ALL, ({ user }) => ({
    contacts: contactsOf(user)
      .map((contact) => {
        const thread = messages.filter(between(user.user_id, contact.user_id))
        return {
          user_id: contact.user_id,
          full_name: contact.full_name,
          role: contact.role!,
          unread_count: thread.filter((message) => message.receiver_user_id === user.user_id && !message.read_at).length,
          last_message_at: thread.map((message) => message.sent_at).sort().pop() ?? null,
        }
      })
      .sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? '')),
  })],
  ['get', /^\/messages\/unread-count$/, ALL, ({ user }) => ({ unread: messages.filter((message) => message.receiver_user_id === user.user_id && !message.read_at).length })],
  ['get', /^\/messages\/([^/]+)$/, ALL, ({ user, params }) => {
    const contact = contactFor(user, params[0]!)
    const thread = messages.filter(between(user.user_id, contact.user_id)).sort((a, b) => a.sent_at.localeCompare(b.sent_at))
    for (const message of thread) if (message.receiver_user_id === user.user_id && !message.read_at) message.read_at = new Date().toISOString()
    return { contact: { user_id: contact.user_id, full_name: contact.full_name, role: contact.role }, messages: thread }
  }],
  ['post', /^\/messages\/([^/]+)$/, ALL, ({ user, params, body }) => {
    const contact = contactFor(user, params[0]!)
    const message: Message = { message_id: uid('m'), body: String(body.body).trim(), sent_at: new Date().toISOString(), read_at: null, sender_user_id: user.user_id, receiver_user_id: contact.user_id }
    messages.push(message)
    notifications.push({ notification_id: uid('nt'), user_id: contact.user_id, title: 'رسالة جديدة', body: `وصلتك رسالة جديدة من ${user.full_name}.`, notification_type: 'message', read_at: null, created_at: message.sent_at })
    return { message }
  }],
]

const PORTAL_ROLES: Record<string, (user: DemoUser) => boolean> = {
  owner: (user) => user.is_owner || user.is_platform_admin || !user.role,
  staff: (user) => user.role === 'lawyer' || user.role === 'assistant',
  client: (user) => user.role === 'client',
}

const handle = (config: InternalAxiosRequestConfig): unknown => {
  const method = (config.method ?? 'get').toLowerCase()
  const path = (config.url ?? '').split('?')[0]!
  const body = (typeof config.data === 'string' && config.data.startsWith('{') ? JSON.parse(config.data) : (config.data ?? {})) as Record<string, unknown>
  const headers = (config.headers?.toJSON?.() ?? {}) as Record<string, unknown>

  if (method === 'post' && path === '/auth/sign-in/email') {
    const user = users.find((entry) => entry.email === String(body.email).trim().toLowerCase())
    if (!user || body.password !== DEMO_PASSWORD) throw fail(401, 'INVALID_CREDENTIALS')
    if (user.status !== 'active') throw fail(403, 'ACCOUNT_INACTIVE')
    const portal = headers['X-Qadiyati-Portal']
    if (typeof portal === 'string' && !PORTAL_ROLES[portal]?.(user)) {
      throw fail(403, 'WRONG_PORTAL', { portals: Object.keys(PORTAL_ROLES).filter((key) => PORTAL_ROLES[key]!(user)) })
    }
    sessionStorage.setItem(KEY, user.user_id)
    return { ok: true }
  }
  if (method === 'post' && path === '/auth/sign-up/email') {
    const email = String(body.email).trim().toLowerCase()
    if (users.some((entry) => entry.email === email)) throw fail(422, 'EMAIL_TAKEN')
    const user: DemoUser = { user_id: uid('u'), full_name: String(body.name), email, status: 'active', is_platform_admin: false, role: null, is_owner: false }
    users.push(user)
    sessionStorage.setItem(KEY, user.user_id)
    return { ok: true }
  }
  if (method === 'post' && (path === '/auth/request-password-reset' || path === '/auth/reset-password')) return { status: true }

  const invitePath = path.startsWith('/invitations/')
  if (method === 'get' && invitePath) {
    return { invitation: { office_name: 'مكتب الخطيب للمحاماة', office_active: true, role: 'lawyer', email_hint: 'n***@mail.ps', state: 'pending', expires_at: daysFromNow(5) } }
  }
  const user = currentUser()
  if (!user) throw fail(401, 'UNAUTHORIZED')
  if (method === 'post' && invitePath) throw fail(403, 'INVITATION_EMAIL_MISMATCH')
  for (const [routeMethod, pattern, roles, handler] of routes) {
    const match = routeMethod === method ? pattern.exec(path) : null
    if (!match) continue
    const allowed = roles.includes('any') || (roles.includes('platform') && user.is_platform_admin) || (user.role !== null && (roles as readonly string[]).includes(user.role))
    if (!allowed) throw fail(403, user.role ? 'FORBIDDEN' : 'NO_ACTIVE_OFFICE')
    return handler({ user, params: match.slice(1), query: (config.params ?? {}) as Record<string, unknown>, body, headers })
  }
  throw fail(404, 'NOT_FOUND')
}

export const demoAdapter: AxiosAdapter = (config) =>
  new Promise((resolve, reject) => {
    // A short delay so loading states are visible, as they would be over a network.
    window.setTimeout(() => {
      const respond = (status: number, data: unknown) => ({ data, status, statusText: String(status), headers: {}, config, request: null })
      try {
        // Serialised, as over a network: the app must never hold references into the demo store,
        // or in-place updates here would change its cache without React noticing.
        resolve(respond(200, JSON.parse(JSON.stringify(handle(config) ?? null))))
      } catch (error) {
        if (error instanceof Reply) {
          reject(new AxiosError('Demo request failed', 'ERR_BAD_REQUEST', config, null, respond(error.status, error.body) as never))
        } else {
          reject(new AxiosError(String(error), 'ERR_BAD_RESPONSE', config, null, respond(500, { code: 'SERVER' }) as never))
        }
      }
    }, 320)
  })
