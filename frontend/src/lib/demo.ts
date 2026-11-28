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
import type { PoaType, PowerOfAttorney } from './powersOfAttorney'
import type { HearingLogEntry } from './hearings'
import type { CourtNotice, DeliveryStatus, NoticeType } from './courtNotices'
import type { AccountType, Currency as MoneyCurrency, Custody, Expense, ExpenseCategory, FinanceAccount, LedgerEntry } from './officeFinance'
import type { Advance, LeaveRequest, LeaveType, Payslip, StaffRecord } from './hr'
import type { Consultation, PageSettings } from './publicPage'
import { libraryRoutes } from './demoLibrary'
import { analysisRoutes } from './demoAnalysis'
import { demoVerification, draftingRoutes } from './demoDrafting'
import { demoAttachment, portalRoutes } from './demoPortal'
import { workflowRoutes } from './demoWorkflow'
import { directoryRoutes } from './demoDirectory'
import { gate, lockedUntil, permissionsOf, securityRoutes, signInFailed, signInSucceeded } from './demoSecurity'
import type { Permission } from './permissionRules'

export const DEMO_PASSWORD = 'demo1234'
export const DEMO_ACCOUNTS = {
  owner: 'owner@demo.ps',
  staff: 'lawyer@demo.ps',
  client: 'client@demo.ps',
  platform: 'admin@demo.ps',
  accountant: 'accountant@demo.ps',
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
  granted?: Permission[]
  revoked?: Permission[]
}

const users: DemoUser[] = [
  { user_id: 'u-owner', full_name: 'سامر الخطيب', email: DEMO_ACCOUNTS.owner, status: 'active', is_platform_admin: false, role: 'admin', is_owner: true },
  { user_id: 'u-lawyer', full_name: 'ليان عودة', email: DEMO_ACCOUNTS.staff, status: 'active', is_platform_admin: false, role: 'lawyer', is_owner: false },
  { user_id: 'u-assistant', full_name: 'رنا حمدان', email: 'assistant@demo.ps', status: 'active', is_platform_admin: false, role: 'assistant', is_owner: false },
  { user_id: 'u-accountant', full_name: 'وسيم البرغوثي', email: DEMO_ACCOUNTS.accountant, status: 'active', is_platform_admin: false, role: 'accountant', is_owner: false },
  { user_id: 'u-entry', full_name: 'دانة عيسى', email: 'entry@demo.ps', status: 'active', is_platform_admin: false, role: 'data_entry', is_owner: false },
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
const reminderEmailsOff = new Set<string>()
const notifications: DemoNotification[] = [
  { notification_id: 'nt-r1', user_id: 'u-owner', title: 'توكيل ينتهي قريباً', body: 'ينتهي التوكيل رقم و-2026/0412 خلال 18 يوماً. جدّده أو استبدله حتى لا تبقى قضاياه دون توكيل ساري.', notification_type: 'reminder', link_path: '/office/powers-of-attorney?state=expiring', read_at: null, created_at: minutesAgo(30) },
  { notification_id: 'nt-r2', user_id: 'u-lawyer', title: 'تذكير: جلسة غداً', body: 'لديك جلسة سماع شهود في القضية 2026/114 غداً الساعة 9:00 ص.', notification_type: 'reminder', link_path: '/office/cases/k-1?tab=hearings', read_at: null, created_at: minutesAgo(45) },
  { notification_id: 'nt-1', user_id: 'u-owner', title: 'رسالة جديدة', body: 'وصلتك رسالة جديدة من ليان عودة.', notification_type: 'message', link_path: '/office/messages?with=u-lawyer', read_at: null, created_at: minutesAgo(95) },
  { notification_id: 'nt-2', user_id: 'u-owner', title: 'أُنجزت مهمة', body: 'أنجز أحد أعضاء المكتب مهمة مسندة إليه.', notification_type: 'task', link_path: '/office/tasks', read_at: null, created_at: minutesAgo(400) },
  { notification_id: 'nt-3', user_id: 'u-owner', title: 'ملاحظة جديدة على قضية', body: 'أُضيفت ملاحظة جديدة على القضية رقم 2026/114.', notification_type: 'case_note', link_path: '/office/cases/k-1?tab=notes', read_at: minutesAgo(900), created_at: minutesAgo(1500) },
  { notification_id: 'nt-4', user_id: 'u-lawyer', title: 'مهمة جديدة لك', body: 'أُسندت إليك مهمة جديدة في المكتب.', notification_type: 'task', link_path: '/office/tasks', read_at: null, created_at: minutesAgo(120) },
  { notification_id: 'nt-5', user_id: 'u-lawyer', title: 'أُسندت إليك قضية', body: 'أُسندت إليك القضية رقم 2026/167.', notification_type: 'case_assignment', link_path: '/office/cases/k-4', read_at: minutesAgo(2000), created_at: minutesAgo(3000) },
  { notification_id: 'nt-6', user_id: 'u-client', title: 'تحديث جديد على قضيتك', body: 'كتب مكتبك تحديثاً جديداً على قضيتك رقم 2026/114.', notification_type: 'case_note', link_path: '/portal#case-k-1', read_at: null, created_at: minutesAgo(60) },
  { notification_id: 'nt-7', user_id: 'u-client', title: 'رسالة جديدة', body: 'وصلتك رسالة جديدة من ليان عودة.', notification_type: 'message', link_path: '/portal/messages?with=u-lawyer', read_at: null, created_at: minutesAgo(40) },
]

platformOffices.push(
  { office_id: 'o-5', name: 'مكتب القدس للمحاماة', email: 'info@quds-law.ps', phone: '02 240 1188', city: 'رام الله', address: null, license_number: 'RM-2020-077', status: 'active', review_note: null, reviewed_at: daysFromNow(-300), created_at: daysFromNow(-302), owner_user_id: 'u-x4', owner_name: 'رامي عبد الله', owner_email: 'rami@quds-law.ps', owner_account_status: 'active', owner_bar_number: '4120' },
  { office_id: 'o-6', name: 'مكتب النجاح القانوني', email: null, phone: '09 237 5521', city: 'نابلس', address: null, license_number: 'NB-2022-131', status: 'active', review_note: null, reviewed_at: daysFromNow(-150), created_at: daysFromNow(-152), owner_user_id: 'u-x5', owner_name: 'سلمى يعيش', owner_email: 'salma@najah-law.ps', owner_account_status: 'active', owner_bar_number: '5571' },
)

/* ───────────── subscriptions (same rules as the backend) ───────────── */

const PLAN = { monthly_price: 100, yearly_discount_percent: 15, yearly_months: 12, currency: 'ILS', grace_days: 7, trial_days: 30 }
/** The demo office pays for its owner and active lawyers, as the backend counts them. */
const demoLawyers = () => Math.max(1, users.filter((user) => user.status === 'active' && (user.role === 'admin' || user.role === 'lawyer')).length)
const demoPrice = (months: number) => {
  const full = PLAN.monthly_price * demoLawyers() * months
  const discountPercent = months === PLAN.yearly_months ? PLAN.yearly_discount_percent : 0
  const discount = Math.round(full * discountPercent) / 100
  return { lawyers: demoLawyers(), months, full_amount: full, discount_percent: discountPercent, discount_amount: discount, amount: full - discount }
}
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
    notifications.push({ notification_id: uid('nt'), user_id: 'u-owner', title: 'سُجّلت دفعة اشتراك', body: `سُجّلت دفعة اشتراك لمكتبك، والاشتراك فعّال حتى ${new Intl.DateTimeFormat('ar-PS-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }).format(end)}.`, notification_type: 'subscription', link_path: '/office/subscription', read_at: null, created_at: payment.created_at })
  }
  return payment
}

/* ───────────── powers of attorney ───────────── */

type DemoPower = Omit<PowerOfAttorney, 'state' | 'days_left' | 'expiring' | 'client_name' | 'lawyers' | 'cases'> & { lawyer_ids: string[]; case_ids: string[] }
const dayOnly = (days: number) => daysFromNow(days).slice(0, 10)
const powers: DemoPower[] = [
  { poa_id: 'p-1', poa_number: 'و-2026/0412', poa_type: 'litigation', issuing_authority: 'كاتب العدل — نابلس', issued_on: dayOnly(-125), expires_on: dayOnly(18), scope: 'المرافعة والمدافعة أمام المحاكم بدرجاتها في دعوى المطالبة المالية.', status: 'active', revoked_at: null, has_scan: true, client_id: 'c-1', lawyer_ids: ['u-lawyer', 'u-owner'], case_ids: ['k-1'], created_at: daysFromNow(-125), updated_at: daysFromNow(-125) },
  { poa_id: 'p-2', poa_number: 'و-2026/0518', poa_type: 'general', issuing_authority: 'كاتب العدل — رام الله', issued_on: dayOnly(-90), expires_on: null, scope: 'توكيل عام في إدارة شؤون الشركة القانونية.', status: 'active', revoked_at: null, has_scan: false, client_id: 'c-2', lawyer_ids: ['u-owner'], case_ids: ['k-2', 'k-5'], created_at: daysFromNow(-90), updated_at: daysFromNow(-90) },
  { poa_id: 'p-3', poa_number: 'و-2025/1190', poa_type: 'special', issuing_authority: 'المحكمة الشرعية — جنين', issued_on: dayOnly(-400), expires_on: dayOnly(-20), scope: null, status: 'active', revoked_at: null, has_scan: true, client_id: 'c-3', lawyer_ids: ['u-lawyer'], case_ids: ['k-3'], created_at: daysFromNow(-400), updated_at: daysFromNow(-400) },
]
const nameOf = (userId: string) => users.find((user) => user.user_id === userId)?.full_name ?? '—'
const publicPower = (row: DemoPower): PowerOfAttorney => {
  const { lawyer_ids, case_ids, ...rest } = row
  const today = dayOnly(0)
  const daysLeft = row.expires_on ? Math.round((Date.parse(row.expires_on) - Date.parse(today)) / 86_400_000) : null
  const state = row.status === 'revoked' ? 'revoked' : row.expires_on && row.expires_on < today ? 'expired' : 'active'
  return {
    ...rest,
    state,
    days_left: daysLeft,
    expiring: state === 'active' && daysLeft !== null && daysLeft <= 30,
    client_name: clients.find((client) => client.client_id === row.client_id)?.full_name_or_org ?? '—',
    lawyers: lawyer_ids.map((user_id) => ({ user_id, full_name: nameOf(user_id) })),
    cases: case_ids.map((case_id) => cases.find((entry) => entry.case_id === case_id)).filter((entry): entry is LegalCase => Boolean(entry)).map((entry) => ({ case_id: entry.case_id, case_number: entry.case_number, title: entry.title })),
  }
}

/* ───────────── hearings, appointments and court notices ───────────── */

type DemoHearing = Omit<HearingLogEntry, 'attended_by_name' | 'outcome_recorded_by_name' | 'next_hearing_at'>
const hearing = (id: string, caseId: string, days: number, hour: number, type: string, extra: Partial<DemoHearing> = {}): DemoHearing => ({
  hearing_id: id, hearing_at: daysFromNow(days, hour), hearing_type: type, court_room: '3', court_name: 'صلح نابلس', status: 'scheduled',
  outcome: null, notes: null, postponement_reason: null, next_hearing_id: null, attended_by_user_id: null, outcome_recorded_at: null, case_id: caseId, ...extra,
})
const hearings: DemoHearing[] = [
  hearing('h-1', 'k-1', -40, 9, 'أولى', { status: 'postponed', outcome: 'حضر الطرفان وطلب الخصم مهلة للرد.', postponement_reason: 'مهلة للخصم لتقديم لائحة جوابية', next_hearing_id: 'h-2', attended_by_user_id: 'u-lawyer', outcome_recorded_at: daysFromNow(-40, 12) }),
  hearing('h-2', 'k-1', -5, 10, 'تقديم بيّنات', { status: 'postponed', outcome: 'قُدّمت البيّنات الخطية وأُرفق عقد المقاولة.', postponement_reason: 'سماع الشهود', next_hearing_id: 'h-3', attended_by_user_id: 'u-lawyer', outcome_recorded_at: daysFromNow(-5, 13) }),
  hearing('h-3', 'k-1', 2, 9, 'سماع شهود'),
  hearing('h-4', 'k-3', -1, 11, 'مرافعة', { court_name: 'الشرعية — جنين', court_room: null }),
  hearing('h-5', 'k-2', 6, 10, 'أولى', { court_name: 'بداية رام الله' }),
  hearing('h-6', 'k-4', 0, 12, 'خبرة', { court_name: 'صلح طوباس' }),
]
const publicHearing = (row: DemoHearing): HearingLogEntry => ({
  ...row,
  attended_by_name: row.attended_by_user_id ? nameOf(row.attended_by_user_id) : null,
  outcome_recorded_by_name: row.outcome_recorded_at ? nameOf('u-owner') : null,
  next_hearing_at: hearings.find((entry) => entry.hearing_id === row.next_hearing_id)?.hearing_at ?? null,
})

type DemoAppointment = { appointment_id: string; starts_at: string; ends_at: string; status: string; purpose: string; location: string | null; appointment_type: string; client_id: string | null; user_id: string; case_id: string | null }
const appointments: DemoAppointment[] = [
  { appointment_id: 'a-1', starts_at: daysFromNow(1, 11), ends_at: daysFromNow(1, 12), status: 'confirmed', purpose: 'مراجعة شهادة الشهود', location: 'المكتب', appointment_type: 'meeting', client_id: 'c-1', user_id: 'u-lawyer', case_id: 'k-1' },
  { appointment_id: 'a-2', starts_at: daysFromNow(3, 9), ends_at: daysFromNow(3, 11), status: 'scheduled', purpose: 'كشف حسّي مع الخبير على المأجور', location: 'طوباس', appointment_type: 'expert_session', client_id: null, user_id: 'u-lawyer', case_id: 'k-4' },
  { appointment_id: 'a-3', starts_at: daysFromNow(0, 13), ends_at: daysFromNow(0, 14), status: 'scheduled', purpose: 'مراجعة قلم المحكمة لتصوير الملف', location: 'محكمة بداية رام الله', appointment_type: 'court_visit', client_id: null, user_id: 'u-assistant', case_id: 'k-2' },
]

type DemoNotice = Omit<CourtNotice, 'case_number' | 'case_title' | 'created_by_name'>
const notices: DemoNotice[] = [
  { notice_id: 'cn-1', notice_type: 'summons', recipient: 'شركة البناء الحديث', bailiff_office: 'محضرو محكمة صلح نابلس', sent_on: dayOnly(-12), delivery_status: 'delivered', delivered_on: dayOnly(-8), notes: null, has_attachment: true, case_id: 'k-1', created_at: daysFromNow(-12), updated_at: daysFromNow(-8) },
  { notice_id: 'cn-2', notice_type: 'notification', recipient: 'الشاهد أحمد سليم', bailiff_office: 'محضرو محكمة صلح نابلس', sent_on: dayOnly(-3), delivery_status: 'pending', delivered_on: null, notes: 'العنوان في رفيديا قرب المدرسة.', has_attachment: false, case_id: 'k-1', created_at: daysFromNow(-3), updated_at: daysFromNow(-3) },
  { notice_id: 'cn-3', notice_type: 'notification', recipient: 'المستأجر', bailiff_office: 'محضرو محكمة صلح طوباس', sent_on: dayOnly(-20), delivery_status: 'returned', delivered_on: dayOnly(-14), notes: 'لم يُعثر على المبلَّغ في العنوان.', has_attachment: false, case_id: 'k-4', created_at: daysFromNow(-20), updated_at: daysFromNow(-14) },
]
const publicNotice = (row: DemoNotice): CourtNotice => {
  const found = cases.find((entry) => entry.case_id === row.case_id)
  return { ...row, case_number: found?.case_number ?? '—', case_title: found?.title ?? '—', created_by_name: nameOf('u-owner') }
}

/* ───────────── office finance ───────────── */

type DemoAccount = Omit<FinanceAccount, 'balance'>
const accounts: DemoAccount[] = [
  { account_id: 'fa-1', name: 'صندوق المكتب', account_type: 'cash', currency: 'ILS', opening_balance: 2000, opened_on: dayOnly(-200), is_active: true },
  { account_id: 'fa-2', name: 'بنك فلسطين', account_type: 'bank', currency: 'ILS', opening_balance: 15000, opened_on: dayOnly(-200), is_active: true },
  { account_id: 'fa-3', name: 'حساب الدولار', account_type: 'bank', currency: 'USD', opening_balance: 3000, opened_on: dayOnly(-200), is_active: true },
]
// Client payments received into an account (the demo's claims themselves are not modelled).
const clientPayments = [
  { id: 'cp-1', account_id: 'fa-2', on_date: dayOnly(-60), amount: 6000, reference: 'INV-2026-0003', party: 'محمود النجار', case_id: 'k-1' },
  { id: 'cp-2', account_id: 'fa-1', on_date: dayOnly(-25), amount: 1500, reference: 'INV-2026-0007', party: 'هبة صالح', case_id: 'k-3' },
  { id: 'cp-3', account_id: 'fa-3', on_date: dayOnly(-15), amount: 1200, reference: 'INV-2026-0009', party: 'شركة الزيتونة للتجارة', case_id: 'k-2' },
]
type DemoCustody = Omit<Custody, 'spent' | 'remaining' | 'holder_name' | 'account_name'>
const custodies: DemoCustody[] = [
  { custody_id: 'cu-1', holder_user_id: 'u-assistant', account_id: 'fa-1', amount: 500, currency: 'ILS', issued_on: dayOnly(-10), purpose: 'رسوم ومواصلات قضايا الشهر', status: 'open', settled_on: null, returned_amount: null, return_account_id: null },
  { custody_id: 'cu-2', holder_user_id: 'u-lawyer', account_id: 'fa-1', amount: 300, currency: 'ILS', issued_on: dayOnly(-45), purpose: 'مراجعات محكمة طوباس', status: 'settled', settled_on: dayOnly(-30), returned_amount: 120, return_account_id: 'fa-1' },
]
type DemoExpense = Omit<Expense, 'account_name' | 'custody_holder_name' | 'case_number' | 'created_by_name'>
const expense = (id: string, category: ExpenseCategory, amount: number, days: number, extra: Partial<DemoExpense>): DemoExpense => ({
  expense_id: id, category, amount, currency: 'ILS', spent_on: dayOnly(days), payee: null, description: null, account_id: null, custody_id: null,
  case_id: null, has_receipt: false, status: 'active', created_by_user_id: 'u-owner', ...extra,
})
const officeExpenses: DemoExpense[] = [
  expense('ex-1', 'rent', 2500, -55, { account_id: 'fa-2', payee: 'مالك العقار', has_receipt: true }),
  expense('ex-2', 'utilities', 380, -40, { account_id: 'fa-2', payee: 'شركة الكهرباء' }),
  expense('ex-3', 'transport', 180, -38, { custody_id: 'cu-2', payee: 'سيارة أجرة', case_id: 'k-4', created_by_user_id: 'u-lawyer' }),
  expense('ex-4', 'court_costs', 150, -7, { custody_id: 'cu-1', payee: 'صندوق محكمة صلح نابلس', case_id: 'k-1', created_by_user_id: 'u-assistant', has_receipt: true }),
  expense('ex-5', 'supplies', 95, -4, { custody_id: 'cu-1', payee: 'مكتبة الجامعة', created_by_user_id: 'u-assistant' }),
  expense('ex-6', 'rent', 2500, -25, { account_id: 'fa-2', payee: 'مالك العقار' }),
]
const transfers = [{ id: 'tr-1', from: 'fa-1', to: 'fa-2', amount: 1000, on_date: dayOnly(-20), note: 'إيداع نقد في البنك' }]

const custodySpent = (custodyId: string) => officeExpenses.filter((row) => row.custody_id === custodyId && row.status === 'active').reduce((sum, row) => sum + row.amount, 0)
const publicCustody = (row: DemoCustody): Custody => ({
  ...row, holder_name: nameOf(row.holder_user_id), account_name: accounts.find((account) => account.account_id === row.account_id)?.name ?? '—',
  spent: custodySpent(row.custody_id), remaining: row.amount - custodySpent(row.custody_id),
})
const publicExpense = (row: DemoExpense): Expense => ({
  ...row,
  account_name: accounts.find((account) => account.account_id === row.account_id)?.name ?? null,
  custody_holder_name: row.custody_id ? nameOf(custodies.find((custody) => custody.custody_id === row.custody_id)?.holder_user_id ?? '') : null,
  case_number: cases.find((entry) => entry.case_id === row.case_id)?.case_number ?? null,
  created_by_name: nameOf(row.created_by_user_id),
})
/** Every movement of an account, oldest first, as the backend's ledger computes it. */
const movementsOf = (accountId: string): Omit<LedgerEntry, 'balance_after'>[] => [
  ...clientPayments.filter((row) => row.account_id === accountId).map((row) => ({ kind: 'payment' as const, id: row.id, on_date: row.on_date, amount: row.amount, reference: row.reference, party: row.party, category: null })),
  ...officeExpenses.filter((row) => row.account_id === accountId && row.status === 'active').map((row) => ({ kind: 'expense' as const, id: row.expense_id, on_date: row.spent_on, amount: -row.amount, reference: null, party: row.payee, category: row.category })),
  ...custodies.filter((row) => row.account_id === accountId).map((row) => ({ kind: 'custody_issued' as const, id: row.custody_id, on_date: row.issued_on, amount: -row.amount, reference: null, party: nameOf(row.holder_user_id), category: null })),
  ...custodies.filter((row) => row.status === 'settled' && (row.returned_amount ?? 0) > 0 && (row.return_account_id ?? row.account_id) === accountId).map((row) => ({ kind: 'custody_returned' as const, id: row.custody_id, on_date: row.settled_on!, amount: row.returned_amount!, reference: null, party: nameOf(row.holder_user_id), category: null })),
  ...transfers.filter((row) => row.from === accountId).map((row) => ({ kind: 'transfer_out' as const, id: row.id, on_date: row.on_date, amount: -row.amount, reference: row.note, party: accounts.find((account) => account.account_id === row.to)?.name ?? null, category: null })),
  ...transfers.filter((row) => row.to === accountId).map((row) => ({ kind: 'transfer_in' as const, id: row.id, on_date: row.on_date, amount: row.amount, reference: row.note, party: accounts.find((account) => account.account_id === row.from)?.name ?? null, category: null })),
].sort((a, b) => a.on_date.localeCompare(b.on_date))
const balanceOf = (account: DemoAccount) => movementsOf(account.account_id).reduce((sum, row) => sum + row.amount, account.opening_balance)
const publicAccount = (row: DemoAccount): FinanceAccount => ({ ...row, balance: balanceOf(row) })

/* ───────────── team HR ───────────── */

// A copy of lib/hr's count (Fridays skipped): importing it would make demo → hr → api → demo circular.
const leaveDays = (startsOn: string, endsOn: string) => {
  let days = 0
  for (const day = new Date(`${startsOn}T00:00:00Z`); day.toISOString().slice(0, 10) <= endsOn; day.setUTCDate(day.getUTCDate() + 1)) {
    if (day.getUTCDay() !== 5) days += 1
  }
  return days
}

type DemoProfile = Pick<StaffRecord, 'user_id' | 'job_title' | 'hire_date' | 'phone' | 'national_id' | 'monthly_salary' | 'salary_currency' | 'annual_leave_days'> & { show_on_public_page?: boolean }
const profiles: DemoProfile[] = [
  { user_id: 'u-owner', job_title: 'المحامي الرئيسي', hire_date: dayOnly(-2200), phone: '0599 100 200', national_id: '901234567', monthly_salary: null, salary_currency: 'ILS', annual_leave_days: 21, show_on_public_page: true },
  { user_id: 'u-lawyer', job_title: 'محامية', hire_date: dayOnly(-700), phone: '0599 300 400', national_id: '902345678', monthly_salary: 4500, salary_currency: 'ILS', annual_leave_days: 14, show_on_public_page: true },
  { user_id: 'u-assistant', job_title: 'مساعدة قانونية', hire_date: dayOnly(-300), phone: '0568 500 600', national_id: '903456789', monthly_salary: 2800, salary_currency: 'ILS', annual_leave_days: 14 },
]
const advances: (Omit<Advance, 'full_name' | 'account_name'> & { account_id: string })[] = [
  { advance_id: 'ad-1', user_id: 'u-assistant', amount: 800, currency: 'ILS', given_on: dayOnly(-35), note: 'ظرف عائلي', account_id: 'fa-1' },
]
const payslips: Omit<Payslip, 'full_name' | 'advances_owed' | 'account_name'>[] = [
  { payslip_id: 'ps-1', user_id: 'u-lawyer', period: dayOnly(-30).slice(0, 7), salary: 4500, advance_deduction: 0, other_deductions: 0, deduction_note: null, net: 4500, currency: 'ILS', status: 'paid', paid_on: dayOnly(-27) },
  { payslip_id: 'ps-2', user_id: 'u-assistant', period: dayOnly(-30).slice(0, 7), salary: 2800, advance_deduction: 400, other_deductions: 0, deduction_note: null, net: 2400, currency: 'ILS', status: 'paid', paid_on: dayOnly(-27) },
]
const leaveRequests: Omit<LeaveRequest, 'full_name' | 'decided_by_name'>[] = [
  { leave_id: 'lv-1', user_id: 'u-lawyer', leave_type: 'annual', starts_on: dayOnly(9), ends_on: dayOnly(11), days: leaveDays(dayOnly(9), dayOnly(11)), reason: 'سفر عائلي', status: 'approved', decision_note: null, created_at: daysFromNow(-6) },
  { leave_id: 'lv-2', user_id: 'u-assistant', leave_type: 'sick', starts_on: dayOnly(2), ends_on: dayOnly(3), days: leaveDays(dayOnly(2), dayOnly(3)), reason: 'مراجعة طبية', status: 'pending', decision_note: null, created_at: daysFromNow(-1) },
  { leave_id: 'lv-3', user_id: 'u-lawyer', leave_type: 'annual', starts_on: dayOnly(-60), ends_on: dayOnly(-58), days: leaveDays(dayOnly(-60), dayOnly(-58)), reason: null, status: 'approved', decision_note: null, created_at: daysFromNow(-70) },
]
const owedBy = (userId: string) =>
  advances.filter((row) => row.user_id === userId).reduce((sum, row) => sum + row.amount, 0)
  - payslips.filter((row) => row.user_id === userId && row.status === 'paid').reduce((sum, row) => sum + row.advance_deduction, 0)
const annualTaken = (userId: string, statuses: string[]) =>
  leaveRequests.filter((row) => row.user_id === userId && row.leave_type === 'annual' && statuses.includes(row.status) && row.starts_on.slice(0, 4) === String(new Date().getFullYear()))
    .reduce((sum, row) => sum + row.days, 0)
const staffRecord = (user: DemoUser): StaffRecord => {
  const profile = profiles.find((row) => row.user_id === user.user_id)
  const entitlement = profile?.annual_leave_days ?? 14
  const used = annualTaken(user.user_id, ['approved'])
  return {
    user_id: user.user_id, full_name: user.full_name, email: user.email, role: user.role as StaffRecord['role'], membership_status: 'active',
    job_title: profile?.job_title ?? null, hire_date: profile?.hire_date ?? null, phone: profile?.phone ?? null, national_id: profile?.national_id ?? null,
    monthly_salary: profile?.monthly_salary ?? null, salary_currency: profile?.salary_currency ?? 'ILS', annual_leave_days: entitlement,
    show_on_public_page: profile?.show_on_public_page ?? false, has_record: Boolean(profile),
    advances_owed: owedBy(user.user_id), annual_used: used, annual_pending: annualTaken(user.user_id, ['pending']), annual_remaining: entitlement - used,
  }
}
const publicPayslip = (row: (typeof payslips)[number]): Payslip => ({
  ...row, full_name: nameOf(row.user_id), advances_owed: owedBy(row.user_id), account_name: row.status === 'paid' ? 'بنك فلسطين' : null,
})
const publicLeave = (row: (typeof leaveRequests)[number]): LeaveRequest => ({ ...row, full_name: nameOf(row.user_id), decided_by_name: row.status === 'approved' || row.status === 'rejected' ? nameOf('u-owner') : null })
const staffUsers = () => users.filter((user) => user.role && user.role !== 'client')

/* ───────────── public page and consultation requests ───────────── */

let publicPageSettings: PageSettings | null = {
  slug: 'khatib-law', is_published: true, tagline: 'محاماة واستشارات قانونية في نابلس منذ 2012',
  about: 'مكتب محاماة يتابع القضايا المدنية والتجارية وقضايا الأحوال الشخصية والعمل أمام محاكم الضفة الغربية، ويقدّم الاستشارات للأفراد والشركات.',
  practice_areas: ['مدني', 'تجاري', 'أحوال شخصية', 'عمالي', 'عقود وشركات'], whatsapp: '+970 599 100 200',
  working_hours: 'السبت–الخميس، 8:30–16:00', map_url: 'https://www.openstreetmap.org/#map=16/32.2211/35.2544', has_logo: false,
}
const consultations: Omit<Consultation, 'assigned_to_name' | 'client_name'>[] = [
  { request_id: 'cr-1', full_name: 'سلمى عبد الهادي', phone: '0599 765 432', email: 'salma@mail.ps', case_type: 'family', message: 'أحتاج استشارة بخصوص حضانة طفلين بعد الطلاق ونفقتهما.', preferred_time: 'بعد الرابعة عصراً', status: 'new', notes: null, assigned_to_user_id: null, client_id: null, created_at: minutesAgo(90) },
  { request_id: 'cr-2', full_name: 'محمد عودة', phone: '0568 112 233', email: null, case_type: 'labor', message: 'فُصلت من عملي دون إنذار بعد ثماني سنوات، وأريد معرفة حقوقي.', preferred_time: null, status: 'contacted', notes: 'اتصلنا به وحدّدنا موعداً الأحد.', assigned_to_user_id: 'u-lawyer', client_id: null, created_at: minutesAgo(60 * 26) },
]
const publicConsultation = (row: (typeof consultations)[number]): Consultation => ({
  ...row,
  assigned_to_name: row.assigned_to_user_id ? nameOf(row.assigned_to_user_id) : null,
  client_name: clients.find((client) => client.client_id === row.client_id)?.full_name_or_org ?? null,
})
/** The published page as visitors see it, or null. */
const publishedPage = (slug: string) => {
  if (!publicPageSettings?.is_published || publicPageSettings.slug !== slug) return null
  const { is_published: _published, ...page } = publicPageSettings
  return {
    ...page,
    office: { name: 'مكتب الخطيب للمحاماة', phone: '09 238 4455', email: 'info@khatib-law.ps', city: 'نابلس', address: 'نابلس — شارع رفيديا، عمارة الصالح، الطابق الثالث' },
    lawyers: profiles.filter((profile) => profile.show_on_public_page).map((profile) => ({ full_name: nameOf(profile.user_id), job_title: profile.job_title })),
  }
}

/* ───────────── session ───────────── */

const KEY = 'qadiyati.demo.user'
const currentUser = () => users.find((user) => user.user_id === sessionStorage.getItem(KEY)) ?? null

const membershipOf = (user: DemoUser): Membership[] =>
  user.role
    ? [{ office_id: OFFICE, office_name: 'مكتب الخطيب للمحاماة', office_status: 'active', office_city: 'نابلس', role: user.role, membership_status: 'active', is_owner: user.is_owner, permissions: permissionsOf(user) }]
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
/** A demo recording's id carries its length ("vc-ab12cd3-14"), as the demo has no clip store. */
const demoVoice = (clipId: unknown) =>
  typeof clipId === 'string' && clipId.startsWith('vc-') ? { clip_id: clipId, duration_seconds: Number(clipId.split('-')[2]) || 1 } : null
const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`

/** Adds a client to the demo office, from the same fields the real backend accepts. */
const demoClient = (body: Record<string, unknown>): Client => {
  const row: Client = { client_id: uid('c'), client_type: (body.client_type as Client['client_type']) ?? 'individual', full_name_or_org: String(body.full_name_or_org), phone: (body.phone as string) || null, email: (body.email as string) || null, address: (body.address as string) || null, created_at: new Date().toISOString() }
  clients.unshift(row)
  return row
}

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
    // The case's client: an existing one, or one created with it, as the real backend does.
    const party = body.new_client ? demoClient(body.new_client as Record<string, unknown>) : clients.find((entry) => entry.client_id === body.client_id)
    if (party) involves.push({ case_id: row.case_id, client_id: party.client_id, party_role: 'client', is_primary: true })
    return { case: party ? { ...row, client: { client_id: party.client_id, full_name_or_org: party.full_name_or_org } } : row }
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
    const created = body.new_client ? demoClient(body.new_client as Record<string, unknown>) : null
    const link = { case_id: params[0]!, client_id: created ? created.client_id : String(body.client_id), party_role: String(body.party_role ?? 'plaintiff'), is_primary: Boolean(body.is_primary) }
    involves.push(link)
    return { relationship: created ? { ...link, client: { client_id: created.client_id, full_name_or_org: created.full_name_or_org } } : link }
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
    const note: CaseNote = { note_id: uid('n'), case_id: row.case_id, body: String(body.body ?? ''), voice: demoVoice(body.voice_clip_id), visibility: (body.visibility as CaseNote['visibility']) ?? 'case_team', created_at: new Date().toISOString(), updated_at: null }
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
  ['post', /^\/clients$/, ['admin'], ({ body }) => ({ client: demoClient(body) })],
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

  // calendar, hearings and court notices
  ['get', /^\/calendar$/, STAFF, ({ user, query }) => {
    const focus = user.role === 'admin' && typeof query.userId === 'string' ? users.find((entry) => entry.user_id === query.userId) : null
    const viewer = focus ?? user
    const mine = new Set(visibleCases(viewer).map((row) => row.case_id))
    const whole = user.role === 'admin' && !focus
    const from = Date.parse(`${String(query.from)}T00:00:00`) - 86_400_000
    const to = Date.parse(`${String(query.to)}T00:00:00`) + 2 * 86_400_000
    const inRange = (at: string) => Date.parse(at) >= from && Date.parse(at) < to
    const caseNumber = (caseId: string | null) => cases.find((entry) => entry.case_id === caseId)?.case_number ?? null
    const events = [
      ...hearings.filter((row) => inRange(row.hearing_at) && (whole || mine.has(row.case_id) || row.attended_by_user_id === viewer.user_id)).map((row) => ({
        kind: 'hearing', id: row.hearing_id, at: row.hearing_at, status: row.status, title: `جلسة ${row.hearing_type}`, case_id: row.case_id, case_number: caseNumber(row.case_id),
        details: { case_title: cases.find((entry) => entry.case_id === row.case_id)?.title ?? null, court_name: row.court_name, court_room: row.court_room, outcome: row.outcome, notes: row.notes, hearing_type: row.hearing_type },
      })),
      ...appointments.filter((row) => inRange(row.starts_at) && (whole || row.user_id === viewer.user_id || (row.case_id !== null && mine.has(row.case_id)))).map((row) => ({
        kind: 'appointment', id: row.appointment_id, at: row.starts_at, ends_at: row.ends_at, status: row.status, title: row.purpose, case_id: row.case_id, case_number: caseNumber(row.case_id),
        details: { client_name: clients.find((client) => client.client_id === row.client_id)?.full_name_or_org ?? null, staff_name: nameOf(row.user_id), location: row.location, appointment_type: row.appointment_type },
      })),
      ...notices.filter((row) => inRange(`${row.sent_on}T00:00:00`) && (whole || mine.has(row.case_id))).map((row) => ({
        kind: 'notice', id: row.notice_id, at: `${row.sent_on}T00:00:00`, status: row.delivery_status, title: row.recipient ? `تبليغ إلى ${row.recipient}` : 'ورقة محضر', case_id: row.case_id, case_number: caseNumber(row.case_id),
        details: { notice_type: row.notice_type, recipient: row.recipient, bailiff_office: row.bailiff_office },
      })),
      ...leaveRequests.filter((row) => row.status === 'approved' && (whole || row.user_id === viewer.user_id)).flatMap((row) => {
        const days: string[] = []
        for (const day = new Date(`${row.starts_on}T00:00:00Z`); day.toISOString().slice(0, 10) <= row.ends_on; day.setUTCDate(day.getUTCDate() + 1)) days.push(day.toISOString().slice(0, 10))
        return days.filter((day) => inRange(`${day}T12:00:00`)).map((day) => ({
          kind: 'leave', id: `${row.leave_id}:${day}`, at: `${day}T00:00:00`, status: 'approved', title: `إجازة ${nameOf(row.user_id)}`, case_id: null, case_number: null,
          details: { leave_type: row.leave_type, full_name: nameOf(row.user_id), starts_on: row.starts_on, ends_on: row.ends_on },
        }))
      }),
      ...tasks.filter((row) => row.due_at && inRange(row.due_at) && row.status !== 'cancelled' && (whole || row.assigned_to_user_id === viewer.user_id)).map((row) => ({
        kind: 'task', id: row.task_id, at: row.due_at!, status: row.status, title: row.title, case_id: row.case_id, case_number: caseNumber(row.case_id),
        details: { assignee_name: row.assigned_to_name, priority: row.priority, private: 0 },
      })),
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    return { events }
  }],
  ['post', /^\/calendar\/hearings$/, ['admin'], ({ body }) => {
    const row = hearing(uid('h'), String(body.case_id), 0, 9, String(body.hearing_type), { hearing_at: String(body.hearing_at), court_room: (body.court_room as string) || null, notes: (body.notes as string) || null })
    hearings.push(row)
    return { hearing: row }
  }],
  ['patch', /^\/calendar\/hearings\/([^/]+)$/, ['admin'], ({ params, body }) => {
    const row = hearings.find((entry) => entry.hearing_id === params[0])
    if (!row) throw fail(404, 'NOT_FOUND')
    Object.assign(row, body)
    return { hearing: row }
  }],
  ['post', /^\/calendar\/appointments$/, ['admin'], ({ body }) => {
    if ((body.appointment_type ?? 'meeting') === 'meeting' && !body.client_id) throw fail(400, 'VALIDATION')
    const row: DemoAppointment = { appointment_id: uid('a'), starts_at: String(body.starts_at), ends_at: String(body.ends_at), status: 'scheduled', purpose: String(body.purpose), location: (body.location as string) || null, appointment_type: String(body.appointment_type ?? 'meeting'), client_id: (body.client_id as string) || null, user_id: String(body.user_id), case_id: (body.case_id as string) || null }
    appointments.push(row)
    return { appointment: row }
  }],
  ['patch', /^\/calendar\/appointments\/([^/]+)$/, ['admin'], ({ params, body }) => {
    const row = appointments.find((entry) => entry.appointment_id === params[0])
    if (!row) throw fail(404, 'NOT_FOUND')
    row.status = String(body.status)
    return { appointment: { appointment_id: row.appointment_id, status: row.status } }
  }],
  ['get', /^\/hearings$/, STAFF, ({ user, query }) => {
    caseFor(user, String(query.caseId))
    return { hearings: hearings.filter((row) => row.case_id === query.caseId).sort((a, b) => Date.parse(a.hearing_at) - Date.parse(b.hearing_at)).map(publicHearing) }
  }],
  ['post', /^\/hearings\/([^/]+)\/outcome$/, STAFF, ({ user, params, body }) => {
    const row = hearings.find((entry) => entry.hearing_id === params[0])
    if (!row) throw fail(404, 'NOT_FOUND')
    caseFor(user, row.case_id)
    if (row.next_hearing_id) throw fail(409, 'HEARING_ALREADY_POSTPONED')
    if (body.postponed_to) {
      const next = hearing(uid('h'), row.case_id, 0, 9, row.hearing_type, { hearing_at: String(body.postponed_to), court_name: row.court_name, court_room: (body.next_court_room as string) || row.court_room })
      hearings.push(next)
      row.next_hearing_id = next.hearing_id
    }
    Object.assign(row, {
      status: body.status, outcome: (body.outcome as string) || null, attended_by_user_id: (body.attended_by_user_id as string) || null,
      postponement_reason: (body.postponement_reason as string) || null, outcome_recorded_at: new Date().toISOString(),
    })
    return { hearing: { hearing_id: row.hearing_id, case_id: row.case_id, status: row.status, next_hearing_id: row.next_hearing_id } }
  }],
  ['get', /^\/court-notices$/, STAFF, ({ user, query }) => {
    const mine = new Set(visibleCases(user).map((row) => row.case_id))
    const rows = notices.filter((row) => mine.has(row.case_id) && (!query.caseId || row.case_id === query.caseId) && (!query.status || row.delivery_status === query.status))
      .sort((a, b) => b.sent_on.localeCompare(a.sent_on)).map(publicNotice)
    return paginate(rows, 'court_notices')
  }],
  ['post', /^\/court-notices$/, STAFF, ({ user, body }) => {
    caseFor(user, String(body.case_id))
    if (body.delivery_status && body.delivery_status !== 'pending' && !body.delivered_on) throw fail(400, 'VALIDATION')
    const now = new Date().toISOString()
    const row: DemoNotice = { notice_id: uid('cn'), notice_type: body.notice_type as NoticeType, recipient: (body.recipient as string) || null, bailiff_office: (body.bailiff_office as string) || null, sent_on: String(body.sent_on), delivery_status: (body.delivery_status as DeliveryStatus) ?? 'pending', delivered_on: (body.delivered_on as string) || null, notes: (body.notes as string) || null, has_attachment: false, case_id: String(body.case_id), created_at: now, updated_at: now }
    notices.unshift(row)
    return { court_notice: publicNotice(row) }
  }],
  ['patch', /^\/court-notices\/([^/]+)$/, STAFF, ({ user, params, body }) => {
    const row = notices.find((entry) => entry.notice_id === params[0])
    if (!row) throw fail(404, 'NOT_FOUND')
    caseFor(user, row.case_id)
    Object.assign(row, body, { updated_at: new Date().toISOString() })
    if (row.delivery_status === 'pending') row.delivered_on = null
    return { court_notice: publicNotice(row) }
  }],
  ['put', /^\/court-notices\/([^/]+)\/attachment$/, STAFF, ({ params }) => {
    const row = notices.find((entry) => entry.notice_id === params[0])
    if (!row) throw fail(404, 'NOT_FOUND')
    row.has_attachment = true
    return { notice_id: row.notice_id, has_attachment: true }
  }],

  // office finance
  ['get', /^\/finance\/accounts$/, ['admin'], () => ({ accounts: accounts.map(publicAccount) })],
  ['post', /^\/finance\/accounts$/, ['admin'], ({ body }) => {
    if (accounts.some((row) => row.name === String(body.name).trim())) throw fail(409, 'DUPLICATE')
    const row: DemoAccount = { account_id: uid('fa'), name: String(body.name).trim(), account_type: body.account_type as AccountType, currency: body.currency as MoneyCurrency, opening_balance: Number(body.opening_balance ?? 0), opened_on: String(body.opened_on ?? dayOnly(0)), is_active: true }
    accounts.push(row)
    return { account: publicAccount(row) }
  }],
  ['patch', /^\/finance\/accounts\/([^/]+)$/, ['admin'], ({ params, body }) => {
    const row = accounts.find((entry) => entry.account_id === params[0])
    if (!row) throw fail(404, 'NOT_FOUND')
    Object.assign(row, body)
    return { account: publicAccount(row) }
  }],
  ['get', /^\/finance\/accounts\/([^/]+)\/ledger$/, ['admin'], ({ params, query }) => {
    const account = accounts.find((entry) => entry.account_id === params[0])
    if (!account) throw fail(404, 'NOT_FOUND')
    const from = String(query.from)
    const to = String(query.to)
    let balance = account.opening_balance
    let before: number | null = null
    const entries: LedgerEntry[] = []
    for (const row of movementsOf(account.account_id)) {
      if (row.on_date > to) break
      if (row.on_date >= from && before === null) before = balance
      balance += row.amount
      if (row.on_date >= from) entries.push({ ...row, balance_after: balance })
    }
    return { account: publicAccount(account), from, to, balance_before: before ?? balance, balance_after: balance, entries }
  }],
  ['post', /^\/finance\/transfers$/, ['admin'], ({ body }) => {
    const from = accounts.find((entry) => entry.account_id === body.from_account_id)
    const to = accounts.find((entry) => entry.account_id === body.to_account_id)
    if (!from || !to || from === to || from.currency !== to.currency) throw fail(400, 'VALIDATION')
    transfers.push({ id: uid('tr'), from: from.account_id, to: to.account_id, amount: Number(body.amount), on_date: String(body.transferred_on), note: (body.note as string) ?? null })
    return { transfer_id: 'ok' }
  }],
  ['get', /^\/finance\/expenses$/, STAFF, ({ user, query }) => {
    const mine = (row: DemoExpense) => user.role === 'admin' || custodies.some((custody) => custody.custody_id === row.custody_id && custody.holder_user_id === user.user_id)
    const rows = officeExpenses.filter((row) => mine(row) && (!query.from || row.spent_on >= String(query.from)) && (!query.to || row.spent_on <= String(query.to))
      && (!query.category || row.category === query.category) && (!query.custodyId || row.custody_id === query.custodyId))
      .sort((a, b) => b.spent_on.localeCompare(a.spent_on)).map(publicExpense)
    return paginate(rows, 'expenses')
  }],
  ['post', /^\/finance\/expenses$/, STAFF, ({ user, body }) => {
    if (body.account_id && user.role !== 'admin') throw fail(403, 'FORBIDDEN')
    const custody = custodies.find((entry) => entry.custody_id === body.custody_id)
    if (custody) {
      if (custody.status !== 'open') throw fail(409, 'CUSTODY_SETTLED')
      if (user.role !== 'admin' && custody.holder_user_id !== user.user_id) throw fail(404, 'NOT_FOUND')
      if (Number(body.amount) > custody.amount - custodySpent(custody.custody_id)) throw fail(409, 'CUSTODY_INSUFFICIENT')
    }
    const account = accounts.find((entry) => entry.account_id === body.account_id)
    const row = expense(uid('ex'), body.category as ExpenseCategory, Number(body.amount), 0, {
      spent_on: String(body.spent_on), payee: (body.payee as string) || null, description: (body.description as string) || null,
      account_id: account?.account_id ?? null, custody_id: custody?.custody_id ?? null, case_id: (body.case_id as string) || null,
      currency: (account?.currency ?? custody?.currency ?? 'ILS'), created_by_user_id: user.user_id,
    })
    officeExpenses.unshift(row)
    return { expense: publicExpense(row) }
  }],
  ['post', /^\/finance\/expenses\/([^/]+)\/cancel$/, STAFF, ({ params }) => {
    const row = officeExpenses.find((entry) => entry.expense_id === params[0])
    if (!row) throw fail(404, 'NOT_FOUND')
    if (row.custody_id && custodies.find((custody) => custody.custody_id === row.custody_id)?.status !== 'open') throw fail(409, 'CUSTODY_SETTLED')
    row.status = 'cancelled'
    return { expense: publicExpense(row) }
  }],
  ['put', /^\/finance\/expenses\/([^/]+)\/receipt$/, STAFF, ({ params }) => {
    const row = officeExpenses.find((entry) => entry.expense_id === params[0])
    if (!row) throw fail(404, 'NOT_FOUND')
    row.has_receipt = true
    return { expense_id: row.expense_id, has_receipt: true }
  }],
  ['get', /^\/finance\/custodies$/, STAFF, ({ user, query }) => ({
    custodies: custodies.filter((row) => (user.role === 'admin' || row.holder_user_id === user.user_id) && (!query.status || row.status === query.status))
      .sort((a, b) => Number(a.status === 'settled') - Number(b.status === 'settled') || b.issued_on.localeCompare(a.issued_on)).map(publicCustody),
  })],
  ['post', /^\/finance\/custodies$/, ['admin'], ({ body }) => {
    const account = accounts.find((entry) => entry.account_id === body.account_id)
    if (!account) throw fail(400, 'VALIDATION')
    const row: DemoCustody = { custody_id: uid('cu'), holder_user_id: String(body.holder_user_id), account_id: account.account_id, amount: Number(body.amount), currency: account.currency, issued_on: String(body.issued_on), purpose: (body.purpose as string) || null, status: 'open', settled_on: null, returned_amount: null, return_account_id: null }
    custodies.unshift(row)
    return { custody: publicCustody(row) }
  }],
  ['post', /^\/finance\/custodies\/([^/]+)\/settle$/, ['admin'], ({ params, body }) => {
    const row = custodies.find((entry) => entry.custody_id === params[0])
    if (!row) throw fail(404, 'NOT_FOUND')
    if (row.status !== 'open') throw fail(409, 'CUSTODY_SETTLED')
    const left = row.amount - custodySpent(row.custody_id)
    if (left > 0 && !body.return_account_id) throw fail(400, 'VALIDATION')
    Object.assign(row, { status: 'settled', settled_on: String(body.settled_on), returned_amount: left, return_account_id: left > 0 ? String(body.return_account_id) : null })
    return { custody: publicCustody(row) }
  }],
  ['get', /^\/finance\/profitability$/, ['admin'], ({ query }) => {
    const from = String(query.from)
    const to = String(query.to)
    const inRange = (day: string) => day >= from && day <= to
    const totals: Record<string, { currency: MoneyCurrency; collected: number; spent: number; net: number }> = {}
    const months: Record<string, { month: string; currency: MoneyCurrency; collected: number; spent: number; net: number }> = {}
    const categories: Record<string, { category: ExpenseCategory; currency: MoneyCurrency; spent: number }> = {}
    const add = (day: string, currency: MoneyCurrency, field: 'collected' | 'spent', value: number) => {
      const total = (totals[currency] ??= { currency, collected: 0, spent: 0, net: 0 })
      const month = (months[`${day.slice(0, 7)}|${currency}`] ??= { month: day.slice(0, 7), currency, collected: 0, spent: 0, net: 0 })
      total[field] += value
      month[field] += value
    }
    for (const row of clientPayments) if (inRange(row.on_date)) add(row.on_date, accounts.find((account) => account.account_id === row.account_id)!.currency, 'collected', row.amount)
    for (const row of officeExpenses) {
      if (row.status !== 'active' || !inRange(row.spent_on)) continue
      add(row.spent_on, row.currency, 'spent', row.amount)
      const key = `${row.category}|${row.currency}`
      categories[key] = { category: row.category, currency: row.currency, spent: (categories[key]?.spent ?? 0) + row.amount }
    }
    for (const entry of [...Object.values(totals), ...Object.values(months)]) entry.net = entry.collected - entry.spent
    const caseRows = cases.map((entry) => {
      const collected = clientPayments.filter((row) => row.case_id === entry.case_id && inRange(row.on_date)).reduce((sum, row) => sum + row.amount, 0)
      const spent = officeExpenses.filter((row) => row.case_id === entry.case_id && row.status === 'active' && inRange(row.spent_on)).reduce((sum, row) => sum + row.amount, 0)
      const currency = (clientPayments.find((row) => row.case_id === entry.case_id) ? accounts.find((account) => account.account_id === clientPayments.find((row) => row.case_id === entry.case_id)!.account_id)!.currency : 'ILS') as MoneyCurrency
      return { case_id: entry.case_id, case_number: entry.case_number, title: entry.title, currency, collected, spent, net: collected - spent }
    }).filter((row) => row.collected || row.spent).sort((a, b) => b.net - a.net)
    return {
      from, to,
      totals: Object.values(totals).sort((a, b) => a.currency.localeCompare(b.currency)),
      months: Object.values(months).sort((a, b) => a.month.localeCompare(b.month)),
      by_category: Object.values(categories).sort((a, b) => b.spent - a.spent),
      cases: caseRows,
    }
  }],
  ['get', /^\/finance\/cases\/([^/]+)\/profitability$/, ['admin'], ({ params }) => {
    const collected = clientPayments.filter((row) => row.case_id === params[0]).reduce((sum, row) => sum + row.amount, 0)
    const spent = officeExpenses.filter((row) => row.case_id === params[0] && row.status === 'active').reduce((sum, row) => sum + row.amount, 0)
    if (!collected && !spent) return { case_id: params[0], totals: [] }
    return { case_id: params[0], totals: [{ currency: 'ILS', billed: collected, collected, spent, net: collected - spent }] }
  }],

  // reports
  ['get', /^\/reports$/, STAFF, ({ user, query }) => {
    const focus = user.role === 'admin' && typeof query.userId === 'string' && query.userId ? users.find((entry) => entry.user_id === query.userId) ?? null : null
    if (query.userId && user.role !== 'admin') throw fail(403, 'FORBIDDEN')
    const whole = user.role === 'admin' && !focus
    const viewer = focus ?? user
    const from = String(query.from)
    const to = String(query.to)
    const inRange = (at: string | null) => Boolean(at) && at!.slice(0, 10) >= from && at!.slice(0, 10) <= to
    const myCases = whole ? cases : cases.filter((row) => assignments.some((link) => link.case_id === row.case_id && link.user_id === viewer.user_id))
    const mine = new Set(myCases.map((row) => row.case_id))
    const count = <T,>(rows: T[], key: (row: T) => string) => rows.reduce<Record<string, number>>((acc, row) => ({ ...acc, [key(row)]: (acc[key(row)] ?? 0) + 1 }), {})
    const myHearings = hearings.filter((row) => mine.has(row.case_id))
    const myTasks = tasks.filter((row) => whole || row.assigned_to_user_id === viewer.user_id)
    const now = new Date().toISOString()
    const caseNumber = (caseId: string | null) => cases.find((entry) => entry.case_id === caseId)?.case_number ?? null
    const types = count(myCases, (row) => row.case_type)
    const report = {
      from, to, scope: whole ? 'office' : 'member', user_id: whole ? null : viewer.user_id,
      cases: {
        by_status: count(myCases, (row) => row.status),
        by_type: Object.entries(types).map(([case_type, n]) => ({ case_type, count: n })).sort((a, b) => b.count - a.count),
        opened: myCases.filter((row) => inRange(row.opened_at)).length,
        closed: myCases.filter((row) => inRange(row.closed_at)).length,
        per_lawyer: whole
          ? users.filter((entry) => entry.role && entry.role !== 'client').map((entry) => {
            const theirs = cases.filter((row) => assignments.some((link) => link.case_id === row.case_id && link.user_id === entry.user_id))
            return { user_id: entry.user_id, full_name: entry.full_name, open: theirs.filter((row) => !['closed', 'cancelled'].includes(row.status)).length, closed: theirs.filter((row) => ['closed', 'cancelled'].includes(row.status)).length }
          }).filter((row) => row.open || row.closed).sort((a, b) => b.open - a.open)
          : null,
      },
      hearings: {
        by_status: count(myHearings.filter((row) => inRange(row.hearing_at)), (row) => row.status),
        missed: myHearings.filter((row) => row.status === 'scheduled' && row.hearing_at < now).map((row) => ({
          hearing_id: row.hearing_id, hearing_at: row.hearing_at, hearing_type: row.hearing_type, case_id: row.case_id,
          case_number: caseNumber(row.case_id), title: cases.find((entry) => entry.case_id === row.case_id)?.title ?? '',
        })),
      },
      tasks: {
        by_status: count(myTasks.filter((row) => inRange(row.due_at)), (row) => row.status),
        overdue: myTasks.filter((row) => ['pending', 'in_progress'].includes(row.status) && row.due_at && row.due_at < now).map((row) => ({
          task_id: row.task_id, title: row.title, due_at: row.due_at!, priority: row.priority, assignee_name: row.assigned_to_name, case_id: row.case_id, case_number: caseNumber(row.case_id),
        })),
      },
      finance: null as unknown,
    }
    if (whole) {
      const collected = clientPayments.filter((row) => inRange(row.on_date))
      const byCurrency: Record<string, { currency: MoneyCurrency; billed: number; collected: number }> = {}
      for (const row of collected) {
        const currency = accounts.find((account) => account.account_id === row.account_id)!.currency
        const entry = (byCurrency[currency] ??= { currency, billed: 0, collected: 0 })
        entry.collected += row.amount
        entry.billed += row.amount * 1.4
      }
      const spent = officeExpenses.filter((row) => row.status === 'active' && inRange(row.spent_on))
      const categories: Record<string, { category: ExpenseCategory; currency: MoneyCurrency; spent: number }> = {}
      for (const row of spent) categories[row.category] = { category: row.category, currency: row.currency, spent: (categories[row.category]?.spent ?? 0) + row.amount }
      const months: Record<string, { month: string; currency: MoneyCurrency; collected: number; spent: number; net: number }> = {}
      for (const row of collected) {
        const currency = accounts.find((account) => account.account_id === row.account_id)!.currency
        const entry = (months[`${row.on_date.slice(0, 7)}|${currency}`] ??= { month: row.on_date.slice(0, 7), currency, collected: 0, spent: 0, net: 0 })
        entry.collected += row.amount
      }
      for (const row of spent) {
        const entry = (months[`${row.spent_on.slice(0, 7)}|${row.currency}`] ??= { month: row.spent_on.slice(0, 7), currency: row.currency, collected: 0, spent: 0, net: 0 })
        entry.spent += row.amount
      }
      for (const entry of Object.values(months)) entry.net = entry.collected - entry.spent
      report.finance = {
        billed_vs_collected: Object.values(byCurrency).map((entry) => ({ ...entry, billed: Math.round(entry.billed) })),
        aging: [{ currency: 'ILS', current: 4200, d1_30: 1800, d31_60: 950, d61_90: 0, d90_plus: 600, total: 7550 }],
        debtors: [
          { client_id: 'c-2', client_name: 'شركة الزيتونة للتجارة', currency: 'ILS', outstanding: 4200, invoices: 2, oldest_days_late: 0 },
          { client_id: 'c-1', client_name: 'محمود النجار', currency: 'ILS', outstanding: 2750, invoices: 2, oldest_days_late: 48 },
          { client_id: 'c-4', client_name: 'يوسف دراغمة', currency: 'ILS', outstanding: 600, invoices: 1, oldest_days_late: 112 },
        ],
        expenses_by_category: Object.values(categories).sort((a, b) => b.spent - a.spent),
        profit_by_month: Object.values(months).sort((a, b) => a.month.localeCompare(b.month)),
        profit_totals: [],
      }
    }
    return report
  }],

  // team HR
  ['get', /^\/hr\/me$/, STAFF, ({ user }) => ({
    profile: staffRecord(user),
    payslips: payslips.filter((row) => row.user_id === user.user_id && row.status === 'paid').map(publicPayslip),
    leave: leaveRequests.filter((row) => row.user_id === user.user_id).map(publicLeave),
    advances: advances.filter((row) => row.user_id === user.user_id).map((row) => ({ ...row, full_name: nameOf(row.user_id), account_name: 'صندوق المكتب' })),
  })],
  ['get', /^\/hr\/staff$/, ['admin'], () => ({ staff: staffUsers().map(staffRecord) })],
  ['put', /^\/hr\/staff\/([^/]+)$/, ['admin'], ({ params, body }) => {
    const user = staffUsers().find((entry) => entry.user_id === params[0])
    if (!user) throw fail(400, 'VALIDATION')
    const record: DemoProfile = { user_id: user.user_id, job_title: (body.job_title as string) ?? null, hire_date: (body.hire_date as string) ?? null, phone: (body.phone as string) ?? null, national_id: (body.national_id as string) ?? null, monthly_salary: (body.monthly_salary as number | null) ?? null, salary_currency: (body.salary_currency as MoneyCurrency) ?? 'ILS', annual_leave_days: Number(body.annual_leave_days ?? 14), show_on_public_page: Boolean(body.show_on_public_page) }
    const index = profiles.findIndex((row) => row.user_id === user.user_id)
    if (index >= 0) profiles[index] = record
    else profiles.push(record)
    return { staff: staffRecord(user) }
  }],
  ['get', /^\/hr\/advances$/, STAFF, ({ user }) => ({
    advances: advances.filter((row) => user.role === 'admin' || row.user_id === user.user_id).map((row) => ({ ...row, full_name: nameOf(row.user_id), account_name: accounts.find((account) => account.account_id === row.account_id)?.name ?? null })),
  })],
  ['post', /^\/hr\/advances$/, ['admin'], ({ body }) => {
    const profile = profiles.find((row) => row.user_id === body.user_id)
    const account = accounts.find((row) => row.account_id === body.account_id)
    if (!profile || !account || account.currency !== profile.salary_currency) throw fail(400, 'VALIDATION')
    advances.unshift({ advance_id: uid('ad'), user_id: profile.user_id, amount: Number(body.amount), currency: account.currency, given_on: String(body.given_on), note: (body.note as string) || null, account_id: account.account_id })
    officeExpenses.unshift(expense(uid('ex'), 'salaries', Number(body.amount), 0, { spent_on: String(body.given_on), payee: nameOf(profile.user_id), description: 'سلفة على الراتب', account_id: account.account_id }))
    return { advance_id: 'ok' }
  }],
  ['get', /^\/hr\/payslips$/, STAFF, ({ user, query }) => ({
    payslips: payslips.filter((row) => (!query.period || row.period === query.period) && (user.role === 'admin' || (row.user_id === user.user_id && row.status === 'paid'))).map(publicPayslip),
  })],
  ['post', /^\/hr\/payroll$/, ['admin'], ({ body }) => {
    const period = String(body.period)
    let created = 0
    for (const profile of profiles) {
      if (!profile.monthly_salary || payslips.some((row) => row.user_id === profile.user_id && row.period === period)) continue
      const deduction = Math.min(profile.monthly_salary, Math.max(owedBy(profile.user_id), 0))
      payslips.push({ payslip_id: uid('ps'), user_id: profile.user_id, period, salary: profile.monthly_salary, advance_deduction: deduction, other_deductions: 0, deduction_note: null, net: profile.monthly_salary - deduction, currency: profile.salary_currency, status: 'draft', paid_on: null })
      created += 1
    }
    return { created, payslips: payslips.filter((row) => row.period === period).map(publicPayslip) }
  }],
  ['patch', /^\/hr\/payslips\/([^/]+)$/, ['admin'], ({ params, body }) => {
    const row = payslips.find((entry) => entry.payslip_id === params[0])
    if (!row) throw fail(404, 'NOT_FOUND')
    if (row.status !== 'draft') throw fail(409, 'PAYSLIP_PAID')
    const advance = body.advance_deduction === undefined ? row.advance_deduction : Number(body.advance_deduction)
    const other = body.other_deductions === undefined ? row.other_deductions : Number(body.other_deductions)
    if (advance > owedBy(row.user_id) || row.salary - advance - other < 0) throw fail(400, 'VALIDATION')
    Object.assign(row, { advance_deduction: advance, other_deductions: other, deduction_note: body.deduction_note ?? row.deduction_note, net: row.salary - advance - other })
    return { payslip: publicPayslip(row) }
  }],
  ['delete', /^\/hr\/payslips\/([^/]+)$/, ['admin'], ({ params }) => {
    const index = payslips.findIndex((entry) => entry.payslip_id === params[0] && entry.status === 'draft')
    if (index < 0) throw fail(409, 'PAYSLIP_PAID')
    payslips.splice(index, 1)
    return { deleted: true }
  }],
  ['post', /^\/hr\/payslips\/([^/]+)\/pay$/, ['admin'], ({ params, body }) => {
    const row = payslips.find((entry) => entry.payslip_id === params[0])
    if (!row) throw fail(404, 'NOT_FOUND')
    if (row.status !== 'draft') throw fail(409, 'PAYSLIP_PAID')
    const account = accounts.find((entry) => entry.account_id === body.account_id)
    if (row.net > 0 && (!account || account.currency !== row.currency)) throw fail(400, 'VALIDATION')
    Object.assign(row, { status: 'paid', paid_on: String(body.paid_on) })
    if (row.net > 0) officeExpenses.unshift(expense(uid('ex'), 'salaries', row.net, 0, { spent_on: String(body.paid_on), payee: nameOf(row.user_id), description: `راتب ${row.period}`, account_id: account!.account_id }))
    return { payslip: publicPayslip(row) }
  }],
  ['get', /^\/hr\/leave$/, STAFF, ({ user, query }) => ({
    leave: leaveRequests.filter((row) => (user.role === 'admin' || row.user_id === user.user_id) && (!query.status || row.status === query.status))
      .sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || b.starts_on.localeCompare(a.starts_on)).map(publicLeave),
  })],
  ['post', /^\/hr\/leave$/, STAFF, ({ user, body }) => {
    const startsOn = String(body.starts_on)
    const endsOn = String(body.ends_on)
    const days = leaveDays(startsOn, endsOn)
    if (!days) throw fail(400, 'VALIDATION')
    if (leaveRequests.some((row) => row.user_id === user.user_id && ['pending', 'approved'].includes(row.status) && row.starts_on <= endsOn && row.ends_on >= startsOn)) throw fail(409, 'LEAVE_OVERLAP')
    const record = staffRecord(user)
    if (body.leave_type === 'annual' && annualTaken(user.user_id, ['approved', 'pending']) + days > record.annual_leave_days) throw fail(409, 'LEAVE_BALANCE')
    leaveRequests.unshift({ leave_id: uid('lv'), user_id: user.user_id, leave_type: body.leave_type as LeaveType, starts_on: startsOn, ends_on: endsOn, days, reason: (body.reason as string) || null, status: 'pending', decision_note: null, created_at: new Date().toISOString() })
    return { leave_id: 'ok', days }
  }],
  ['post', /^\/hr\/leave\/([^/]+)\/decision$/, ['admin'], ({ params, body }) => {
    const row = leaveRequests.find((entry) => entry.leave_id === params[0])
    if (!row || row.status !== 'pending') throw fail(409, 'LEAVE_DECIDED')
    Object.assign(row, { status: body.status, decision_note: (body.decision_note as string) || null })
    return { leave_id: row.leave_id, status: row.status }
  }],
  ['post', /^\/hr\/leave\/([^/]+)\/cancel$/, STAFF, ({ user, params }) => {
    const row = leaveRequests.find((entry) => entry.leave_id === params[0])
    if (!row || !(row.status === 'pending' && (user.role === 'admin' || row.user_id === user.user_id)) && !(user.role === 'admin' && row.status === 'approved' && row.starts_on > dayOnly(0))) throw fail(409, 'LEAVE_DECIDED')
    row.status = 'cancelled'
    return { leave_id: row.leave_id, status: 'cancelled' }
  }],

  // public page settings and consultation requests
  ['get', /^\/offices\/current\/public-page$/, ['admin'], () => ({ page: publicPageSettings })],
  ['put', /^\/offices\/current\/public-page$/, ['admin'], ({ body }) => {
    if (body.slug === 'admin') throw fail(409, 'SLUG_TAKEN')
    publicPageSettings = { ...(body as unknown as Omit<PageSettings, 'has_logo'>), has_logo: publicPageSettings?.has_logo ?? false }
    return { page: publicPageSettings }
  }],
  ['put', /^\/offices\/current\/public-page\/logo$/, ['admin'], () => {
    if (publicPageSettings) publicPageSettings.has_logo = true
    return { has_logo: true }
  }],
  ['get', /^\/consultations$/, STAFF, ({ user, query }) => ({
    requests: consultations.filter((row) => (user.role === 'admin' || row.assigned_to_user_id === user.user_id) && (!query.status || row.status === query.status))
      .sort((a, b) => Number(b.status === 'new') - Number(a.status === 'new') || b.created_at.localeCompare(a.created_at)).map(publicConsultation),
  })],
  ['patch', /^\/consultations\/([^/]+)$/, STAFF, ({ user, params, body }) => {
    const row = consultations.find((entry) => entry.request_id === params[0] && (user.role === 'admin' || entry.assigned_to_user_id === user.user_id))
    if (!row) throw fail(404, 'NOT_FOUND')
    if (row.status === 'converted') throw fail(409, 'REQUEST_CONVERTED')
    if (body.assigned_to_user_id !== undefined && user.role !== 'admin') throw fail(403, 'FORBIDDEN')
    Object.assign(row, body)
    return { request: publicConsultation(row) }
  }],
  ['post', /^\/consultations\/([^/]+)\/convert$/, ['admin'], ({ params, body }) => {
    const row = consultations.find((entry) => entry.request_id === params[0])
    if (!row) throw fail(404, 'NOT_FOUND')
    if (row.status === 'converted') throw fail(409, 'REQUEST_CONVERTED')
    const client = demoClient({ client_type: body.client_type ?? 'individual', full_name_or_org: row.full_name, phone: row.phone, email: row.email })
    Object.assign(row, { status: 'converted', client_id: client.client_id })
    return { request: publicConsultation(row), client }
  }],

  // sharing documents with clients, and a client's upcoming hearings
  ['post', /^\/documents\/([^/]+)\/sharing$/, STAFF, ({ user, params, body }) => {
    const row = documents.find((entry) => entry.document_id === params[0])
    if (!row) throw fail(404, 'NOT_FOUND')
    caseFor(user, row.case_id)
    if (body.shared) {
      if (!involves.some((link) => link.case_id === row.case_id && link.client_id === body.client_id)) throw fail(400, 'VALIDATION')
      Object.assign(row, { access_level: 'authorized_users', client_id: String(body.client_id) })
    } else {
      if (row.access_level !== 'authorized_users') throw fail(404, 'NOT_FOUND')
      Object.assign(row, { access_level: 'case_team', client_id: null })
    }
    return { document: { document_id: row.document_id, case_id: row.case_id, client_id: row.client_id, access_level: row.access_level } }
  }],
  ['get', /^\/hearings\/mine$/, ['client'], ({ user }) => {
    const mine = new Set(involves.filter((link) => link.client_id === user.client_id).map((link) => link.case_id))
    const now = new Date().toISOString()
    return {
      hearings: hearings.filter((row) => mine.has(row.case_id) && row.status === 'scheduled' && row.hearing_at >= now)
        .sort((a, b) => a.hearing_at.localeCompare(b.hearing_at))
        .map((row) => {
          const found = cases.find((entry) => entry.case_id === row.case_id)
          return { hearing_id: row.hearing_id, hearing_at: row.hearing_at, hearing_type: row.hearing_type, court_room: row.court_room, court_name: row.court_name, case_id: row.case_id, case_number: found?.case_number ?? '', case_title: found?.title ?? '' }
        }),
    }
  }],

  // powers of attorney
  ['get', /^\/powers-of-attorney\/lawyers$/, STAFF, () => ({
    lawyers: users.filter((user) => (user.role === 'admin' || user.role === 'lawyer') && user.status === 'active').map((user) => ({ user_id: user.user_id, full_name: user.full_name, role: user.role })),
  })],
  ['get', /^\/powers-of-attorney$/, ALL, ({ user, query }) => {
    const mine = new Set(visibleCases(user).map((row) => row.case_id))
    const visible = (row: DemoPower) =>
      user.role === 'admin' || (user.role === 'client' ? row.client_id === user.client_id : row.lawyer_ids.includes(user.user_id) || involves.some((link) => link.client_id === row.client_id && mine.has(link.case_id)))
    const rows = powers.filter(visible).map(publicPower).filter((row) =>
      (!query.clientId || row.client_id === query.clientId) && (!query.caseId || row.cases.some((entry) => entry.case_id === query.caseId)) &&
      (!query.state || (query.state === 'expiring' ? row.expiring : row.state === query.state)) && matches(query.search, row.poa_number, row.issuing_authority))
    return paginate(rows, 'powers_of_attorney')
  }],
  ['post', /^\/powers-of-attorney$/, STAFF, ({ body }) => {
    if (powers.some((row) => row.poa_number === String(body.poa_number).trim())) throw fail(409, 'POA_NUMBER_TAKEN')
    if (!Array.isArray(body.lawyer_ids) || body.lawyer_ids.length === 0) throw fail(400, 'VALIDATION')
    const now = new Date().toISOString()
    const row: DemoPower = { poa_id: uid('p'), poa_number: String(body.poa_number).trim(), poa_type: body.poa_type as PoaType, issuing_authority: (body.issuing_authority as string) || null, issued_on: String(body.issued_on), expires_on: (body.expires_on as string) || null, scope: (body.scope as string) || null, status: 'active', revoked_at: null, has_scan: false, client_id: String(body.client_id), lawyer_ids: body.lawyer_ids as string[], case_ids: (body.case_ids as string[]) ?? [], created_at: now, updated_at: now }
    powers.unshift(row)
    return { power_of_attorney: publicPower(row) }
  }],
  ['patch', /^\/powers-of-attorney\/([^/]+)$/, STAFF, ({ user, params, body }) => {
    const row = powers.find((entry) => entry.poa_id === params[0])
    if (!row) throw fail(404, 'NOT_FOUND')
    if (body.status !== undefined && user.role === 'assistant') throw fail(403, 'FORBIDDEN')
    if (body.poa_number && powers.some((entry) => entry !== row && entry.poa_number === String(body.poa_number).trim())) throw fail(409, 'POA_NUMBER_TAKEN')
    Object.assign(row, body, { updated_at: new Date().toISOString() })
    if (body.status !== undefined) row.revoked_at = body.status === 'revoked' ? new Date().toISOString() : null
    return { power_of_attorney: publicPower(row) }
  }],
  ['put', /^\/powers-of-attorney\/([^/]+)\/scan$/, STAFF, ({ params }) => {
    const row = powers.find((entry) => entry.poa_id === params[0])
    if (!row) throw fail(404, 'NOT_FOUND')
    row.has_scan = true
    return { poa_id: row.poa_id, has_scan: true }
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
        return { office_id: office.office_id, name: office.name, city: office.city, status: office.status, owner_name: office.owner_name, owner_email: office.owner_email, last_paid_at: last?.paid_at ?? null, last_amount: last?.amount ?? null, last_currency: last?.currency ?? null, last_method: last?.method ?? null, paid_total: paid.reduce((sum, payment) => sum + payment.amount, 0), lawyers: office.office_id === OFFICE ? demoLawyers() : 1, subscription: summaryOf(subscriptionEnds[office.office_id]) }
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
    plan: { ...PLAN, lawyers: demoLawyers() },
    prices: [1, 3, 6, 12].map(demoPrice),
    online_payments: true,
    // Card payments in the demo; the real site lists the methods the platform owner set up.
    payment_methods: [],
    pending_request: null,
    payments: subscriptionPayments.filter((payment) => payment.office_id === OFFICE).map(({ recorded_by_name: _recorder, ...payment }) => payment),
  })],
  ['post', /^\/offices\/current\/subscription\/checkout$/, ['admin'], ({ body }) => {
    // Demo stand-in for Stripe Checkout: the payment succeeds at once and the browser returns.
    const months = Number(body.months)
    if (![1, 3, 6, 12].includes(months)) throw fail(400, 'VALIDATION')
    recordPayment(OFFICE, demoPrice(months).amount, months, 'online', 'demo', null)
    return { checkout_url: `${location.origin}/office/subscription?payment=success` }
  }],

  // platform: opened requests
  ['post', /^\/platform\/offices\/seen$/, ['platform'], () => {
    const now = new Date().toISOString()
    for (const office of platformOffices) if (office.status === 'pending' && !office.platform_seen_at) office.platform_seen_at = now
    return { updated: 1 }
  }],
  ['post', /^\/platform\/offices\/([^/]+)\/seen$/, ['platform'], ({ params }) => {
    const office = platformOffices.find((entry) => entry.office_id === params[0])
    if (office && !office.platform_seen_at) office.platform_seen_at = new Date().toISOString()
    return { updated: office ? 1 : 0 }
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

  // the person's own reminder settings
  ['get', /^\/me\/preferences$/, ['any'], ({ user }) => ({ preferences: { email_reminders: !reminderEmailsOff.has(user.user_id) } })],
  ['patch', /^\/me\/preferences$/, ['any'], ({ user, body }) => {
    if (typeof body.email_reminders !== 'boolean') throw fail(400, 'VALIDATION')
    if (body.email_reminders) reminderEmailsOff.delete(user.user_id)
    else reminderEmailsOff.add(user.user_id)
    return { preferences: { email_reminders: body.email_reminders } }
  }],

  // inbox: notifications and direct messages
  ['get', /^\/notifications$/, ALL, ({ user }) => {
    const mine = notifications.filter((entry) => entry.user_id === user.user_id).sort((a, b) => b.created_at.localeCompare(a.created_at))
    return { notifications: mine, unread: mine.filter((entry) => !entry.read_at).length }
  }],
  ['delete', /^\/notifications$/, ALL, ({ user }) => {
    const before = notifications.length
    for (let index = notifications.length - 1; index >= 0; index -= 1) if (notifications[index]!.user_id === user.user_id) notifications.splice(index, 1)
    return { deleted: before - notifications.length }
  }],
  ['post', /^\/notifications\/([^/]+)\/read$/, ALL, ({ user, params }) => {
    const entry = notifications.find((row) => row.notification_id === params[0] && row.user_id === user.user_id)
    if (entry && !entry.read_at) entry.read_at = new Date().toISOString()
    return { updated: entry ? 1 : 0 }
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
    const message: Message = { message_id: uid('m'), body: String(body.body ?? '').trim(), voice: demoVoice(body.voice_clip_id), attachment: demoAttachment(body.attachment_file_id), sent_at: new Date().toISOString(), read_at: null, sender_user_id: user.user_id, receiver_user_id: contact.user_id }
    messages.push(message)
    notifications.push({ notification_id: uid('nt'), user_id: contact.user_id, title: 'رسالة جديدة', body: `وصلتك رسالة جديدة من ${user.full_name}.`, notification_type: 'message', read_at: null, created_at: message.sent_at })
    return { message }
  }],
  // legal library (fictional sample texts)
  ...(libraryRoutes({ fail, uid, caseFor: caseFor as (user: never, caseId: string) => unknown }) as Route[]),
  // case analysis tools (fixed sample results, no model)
  ...(analysisRoutes({ fail, uid, caseFor: caseFor as (user: never, caseId: string) => unknown }) as Route[]),
  // drafting, letterhead and print codes
  ...(draftingRoutes({ fail, uid, caseFor: caseFor as (user: never, caseId: string) => unknown }) as Route[]),
  // client files, chat attachments and official notices
  ...(portalRoutes({
    fail,
    uid,
    caseFor: caseFor as unknown as (user: never, caseId: string) => { case_id: string; case_number: string; title: string },
    clientsOfCase: (caseId) =>
      involves
        .filter((link) => link.case_id === caseId)
        .map((link) => ({
          client_id: link.client_id,
          full_name_or_org: clients.find((client) => client.client_id === link.client_id)?.full_name_or_org ?? '',
          user_id: users.find((user) => user.client_id === link.client_id)?.user_id ?? null,
        })),
  }) as Route[]),
  // courts, colleagues and message templates
  ...(directoryRoutes({ fail, uid }) as Route[]),
  // security page, audit chain check, office export and backups
  ...(securityRoutes({
    fail,
    members: () => users,
    officeName: 'مكتب الخطيب للمحاماة',
    officeData: () => ({ clients, legal_cases: cases, involves, assigned_to: assignments, tasks, case_notes: notes, documents, contracts, hearings, messages }),
  }) as Route[]),
  // case stages, fee agreements and the client briefcase
  ...(workflowRoutes({
    fail,
    uid,
    caseFor: caseFor as never,
    visibleCases: visibleCases as never,
    clientsOfCase: (caseId) =>
      involves
        .filter((link) => link.case_id === caseId)
        .map((link) => ({ client_id: link.client_id, full_name_or_org: clients.find((client) => client.client_id === link.client_id)?.full_name_or_org ?? '' })),
    clientById: (clientId) => clients.find((client) => client.client_id === clientId),
    casesOfClient: (clientId) => involves.filter((link) => link.client_id === clientId).map((link) => link.case_id),
    clientUserId: (clientId) => users.find((user) => user.client_id === clientId)?.user_id ?? null,
    thread: (userId, otherId) =>
      messages.filter((message) => (message.sender_user_id === userId && message.receiver_user_id === otherId) || (message.sender_user_id === otherId && message.receiver_user_id === userId)),
    documentsOfClient: (clientId, caseIds) =>
      documents.filter((document) => document.client_id === clientId && caseIds.includes(document.case_id)).map(({ document_id, file_name, document_type, created_at, case_id }) => ({ document_id, file_name, document_type: document_type ?? '', created_at, case_id })),
    nextHearing: (caseId) =>
      hearings.filter((entry) => entry.case_id === caseId && entry.status === 'scheduled' && entry.hearing_at > new Date().toISOString()).map((entry) => entry.hearing_at).sort()[0] ?? null,
  }) as Route[]),
]

const PORTAL_ROLES: Record<string, (user: DemoUser) => boolean> = {
  owner: (user) => user.is_owner || user.is_platform_admin || !user.role,
  staff: (user) => user.role !== null && ['lawyer', 'assistant', 'accountant', 'data_entry', 'print_only'].includes(user.role),
  client: (user) => user.role === 'client',
}

const handle = (config: InternalAxiosRequestConfig): unknown => {
  const method = (config.method ?? 'get').toLowerCase()
  const path = (config.url ?? '').split('?')[0]!
  const body = (typeof config.data === 'string' && config.data.startsWith('{') ? JSON.parse(config.data) : (config.data ?? {})) as Record<string, unknown>
  const headers = (config.headers?.toJSON?.() ?? {}) as Record<string, unknown>

  if (method === 'post' && path === '/auth/sign-in/email') {
    const email = String(body.email).trim().toLowerCase()
    const until = lockedUntil(email)
    if (until) throw fail(429, 'ACCOUNT_LOCKED', { locked_until: until })
    const user = users.find((entry) => entry.email === email)
    if (!user || body.password !== DEMO_PASSWORD) {
      signInFailed(email)
      throw fail(401, 'INVALID_CREDENTIALS')
    }
    signInSucceeded(email)
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
  const publicPath = /^\/public\/offices\/([^/]+)(\/consultations)?$/.exec(path)
  if (publicPath) {
    const page = publishedPage(publicPath[1]!)
    if (!page) throw fail(404, 'NOT_FOUND')
    if (method === 'get' && !publicPath[2]) return { page }
    if (method === 'post' && publicPath[2]) {
      if (!body.website && Date.now() - Number(body.opened_at) >= 3000) {
        consultations.unshift({ request_id: uid('cr'), full_name: String(body.full_name), phone: String(body.phone), email: (body.email as string) || null, case_type: (body.case_type as string) || null, message: String(body.message), preferred_time: (body.preferred_time as string) || null, status: 'new', notes: null, assigned_to_user_id: null, client_id: null, created_at: new Date().toISOString() })
      }
      return { received: true }
    }
  }
  const verifyPath = /^\/public\/verify\/([^/]+)$/.exec(path)
  if (verifyPath && method === 'get') return demoVerification(decodeURIComponent(verifyPath[1]!))
  const signedIn = currentUser()
  if (!signedIn) throw fail(401, 'UNAUTHORIZED')
  if (method === 'post' && invitePath) throw fail(403, 'INVITATION_EMAIL_MISMATCH')
  // The server's permission gate: new roles act as the admin where their permissions allow.
  const user = gate(signedIn, method, path, fail)
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
        const failed = (error: unknown) =>
          error instanceof Reply
            ? reject(new AxiosError('Demo request failed', 'ERR_BAD_REQUEST', config, null, respond(error.status, error.body) as never))
            : reject(new AxiosError(String(error), 'ERR_BAD_RESPONSE', config, null, respond(500, { code: 'SERVER' }) as never))
        // A few handlers are async (hashing with WebCrypto); the rest answer at once.
        Promise.resolve(handle(config))
          .then((result) => resolve(respond(200, JSON.parse(JSON.stringify(result ?? null)))))
          .catch(failed)
      } catch (error) {
        if (error instanceof Reply) {
          reject(new AxiosError('Demo request failed', 'ERR_BAD_REQUEST', config, null, respond(error.status, error.body) as never))
        } else {
          reject(new AxiosError(String(error), 'ERR_BAD_RESPONSE', config, null, respond(500, { code: 'SERVER' }) as never))
        }
      }
    }, 320)
  })
