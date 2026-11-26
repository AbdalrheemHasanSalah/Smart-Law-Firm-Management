/** Shapes returned by the backend (snake_case, exactly as the API sends them). */

export type OfficeRole = 'admin' | 'lawyer' | 'assistant' | 'client'
export type OfficeStatus = 'pending' | 'active' | 'rejected' | 'suspended'
export type Portal = 'owner' | 'staff' | 'client'

export type Membership = {
  office_id: string
  office_name: string
  office_status: OfficeStatus
  office_city: string | null
  role: OfficeRole
  membership_status: 'active' | 'suspended'
  is_owner: boolean
}

export type Session = {
  user: {
    user_id: string
    full_name: string
    email: string
    status: string
    is_platform_admin: boolean
  }
  role: OfficeRole | null
  active_office: Membership | null
  memberships: Membership[]
  /** The active office's subscription; null without an active office. */
  subscription?: SubscriptionSummary | null
}

export type Pagination = { page: number; pageSize: number; total: number; totalPages: number }

export type CaseStatus = 'open' | 'in_progress' | 'on_hold' | 'closed' | 'cancelled'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'

export type LegalCase = {
  case_id: string
  case_number: string
  title: string
  case_type: string
  status: CaseStatus
  priority: Priority
  opened_at: string
  closed_at: string | null
  description: string | null
  court_id: string | null
}

export type CaseRelationships = {
  clients?: {
    client_id: string
    client_type: string
    full_name_or_org: string
    party_role: string
    is_primary: boolean
  }[]
  assigned_staff: {
    user_id?: string
    full_name: string
    role?: OfficeRole
    assignment_role: string
    is_lead?: boolean
  }[]
}

export type Client = {
  client_id: string
  client_type: 'individual' | 'organization'
  full_name_or_org: string
  phone: string | null
  email: string | null
  address: string | null
  /** ID or company registration number, used by the conflict-of-interest check. */
  national_id?: string | null
  created_at: string
  /** The client's portal account, returned to the office administrator only. */
  portal?: ClientPortal
}

export type ClientPortal =
  | { status: 'none' }
  | { status: 'invited'; invitation_id: string; invited_email: string; expires_at: string }
  | { status: 'active' | 'suspended'; user_id: string }

export type Opponent = {
  opponent_id: string
  case_id: string
  full_name: string
  national_id: string | null
  phone: string | null
  notes: string | null
  created_at: string
}

export type ConflictMatch = {
  source: 'client' | 'opponent'
  id: string
  name: string
  matched_on: ('name' | 'phone' | 'national_id')[]
  cases: { case_id: string; case_number: string; title: string; party_role: string }[]
  /** True when this match makes taking the person on a conflict of interest. */
  conflict: boolean
}

export type InvoiceCategory = 'legal_fees' | 'court_fees' | 'expenses'
export type Currency = 'ILS' | 'JOD' | 'USD'

export type Invoice = {
  invoice_id: string
  invoice_number: string
  category: InvoiceCategory
  description: string | null
  amount: number
  currency: Currency
  status: 'unpaid' | 'partially_paid' | 'paid' | 'cancelled'
  /** The status as of now: an unpaid invoice past its due date reads "overdue". */
  state: 'unpaid' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled'
  issued_at: string
  due_at: string | null
  client_id: string
  client_name: string
  case_id: string | null
  case_number: string | null
  paid_amount: number
  remaining: number
}

export type CurrencySummary = {
  currency: Currency
  billed: number
  paid: number
  outstanding: number
  overdue: number
  overdue_count: number
  open_count: number
}

export type Statement = {
  client: { client_id: string; full_name_or_org: string; phone: string | null; email: string | null; national_id: string | null }
  office: { name: string; city: string | null; phone: string | null; email: string | null }
  generated_at: string
  currencies: { currency: Currency; legal_fees: number; court_fees: number; expenses: number; billed: number; paid: number; balance: number }[]
  invoices: Invoice[]
  payments: { payment_id: string; amount: number; method: string; paid_at: string; reference: string | null; invoice_number: string; currency: Currency }[]
}

export type ConflictResult = { conflict: boolean; matches: ConflictMatch[] }

export type PrepPoint = { text: string; sources: string[]; verified: boolean; /** A general checklist reminder of the free sheet, not a claim about the case. */ reminder?: boolean }

export type HearingPrep = {
  summary: string
  hearing_focus: string
  key_facts: PrepPoint[]
  pending_items: PrepPoint[]
  documents_to_bring: PrepPoint[]
  questions_for_client: PrepPoint[]
  risks: PrepPoint[]
  next_steps: PrepPoint[]
  /** What each cited label (N1, T2, D3…) stood for when the sheet was made. */
  sources: Record<string, string>
  hearing_date: string | null
  focus: string | null
  /** "basic": arranged from the file with no AI. Missing on sheets made before the free mode. */
  mode?: 'basic' | 'ai'
}

export type HearingPrepRecord = {
  interaction_id: string
  created_at: string
  model: string
  user_name?: string | null
  prep: HearingPrep
}

export type AuditEntry = {
  audit_log_id: string
  action: string
  entity_type: string
  entity_id: string | null
  details: {
    values?: Record<string, unknown>
    changes?: Record<string, { from: unknown; to: unknown }>
    case_id?: string
    /** The name of what changed (case title, client name, task title), for updates. */
    subject?: string
    conflict?: boolean
    [key: string]: unknown
  } | null
  created_at: string
  user_name: string | null
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export type Task = {
  task_id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: Priority
  due_at: string | null
  completed_at: string | null
  case_id: string | null
  assigned_to_name: string
  created_by_name: string
  /** A staff member's own to-do item, seen by them alone. */
  is_private?: boolean
}

export type CaseNote = {
  note_id: string
  body: string
  visibility: 'internal' | 'case_team' | 'client_visible'
  created_at: string
  updated_at: string | null
  case_id: string
}

export type DocumentRecord = {
  document_id: string
  file_name: string
  mime_type: string
  document_type: string
  source: string | null
  document_date: string | null
  access_level: 'restricted' | 'case_team' | 'authorized_users'
  created_at: string
  case_id: string
}

export type Contract = {
  contract_id: string
  title: string
  contract_type: string
  status: 'draft' | 'under_review' | 'approved' | 'signed' | 'archived'
  created_at: string
  client_id: string
  case_id: string | null
}

export type Member = {
  user_id: string
  full_name: string
  email: string
  status: 'active' | 'suspended'
  role: OfficeRole
  created_at: string
}

export type Invitation = {
  invitation_id: string
  email: string
  role: Exclude<OfficeRole, 'admin'>
  client_id: string | null
  state: 'pending' | 'accepted' | 'revoked' | 'expired'
  expires_at: string
  created_at: string
}

export type PlatformOffice = {
  office_id: string
  name: string
  email: string | null
  /** The owner's optional personal address; the office email is the one the site writes to. */
  personal_email?: string | null
  phone: string
  city: string
  address: string | null
  license_number: string | null
  status: OfficeStatus
  review_note: string | null
  reviewed_at: string | null
  created_at: string
  owner_user_id: string
  owner_name: string
  owner_email: string
  owner_account_status: string
  owner_bar_number: string | null
}

export type Contact = {
  user_id: string
  full_name: string
  role: OfficeRole
  unread_count: number
  last_message_at: string | null
}

export type Message = {
  message_id: string
  body: string
  sent_at: string
  read_at: string | null
  sender_user_id: string
  receiver_user_id: string
}

export type NotificationItem = {
  notification_id: string
  title: string
  body: string
  notification_type: string
  read_at: string | null
  created_at: string
}

export type SubscriptionState = 'active' | 'grace' | 'expired' | 'none'

export type SubscriptionSummary = {
  state: SubscriptionState
  ends_at: string | null
  grace_ends_at: string | null
  /** Days until the period ends (active) or until the office is locked (grace). */
  days_left: number | null
}

export type SubscriptionPlan = {
  /** Per lawyer, per month. */
  monthly_price: number
  /** Off a whole year paid at once (`yearly_months`). */
  yearly_discount_percent: number
  yearly_months: number
  currency: string
  grace_days: number
  trial_days: number
  /** The office's lawyers it pays for (the owner's own page only). */
  lawyers?: number
}

/** What one period costs an office: lawyers × months × the price, less the yearly discount. */
export type SubscriptionPrice = {
  lawyers: number
  months: number
  full_amount: number
  discount_percent: number
  discount_amount: number
  amount: number
}

export type PaymentMethod = 'cash' | 'bank_transfer' | 'cheque' | 'online' | 'wallet'

export type SubscriptionPayment = {
  payment_id: string
  amount: number
  currency: string
  months: number
  /** How many lawyers the payment covered; absent on payments from before per-lawyer pricing. */
  lawyer_count?: number | null
  method: PaymentMethod
  status: 'pending' | 'paid' | 'failed' | 'rejected' | 'cancelled'
  reference: string | null
  period_start: string | null
  period_end: string | null
  created_at: string
  paid_at: string | null
  recorded_by_name?: string | null
  /** What the office wrote with its payment request. */
  payer_note?: string | null
  /** The platform owner's reason when a request is rejected. */
  review_note?: string | null
  reviewed_at?: string | null
  has_receipt?: boolean
}

/** Where an office pays outside the site, as the platform configured it. */
export type ManualPaymentOption =
  | { method: 'bank_transfer'; details: { bank_name: string | null; account_name: string | null; account: string } }
  | { method: 'wallet'; details: { wallet_name: string; account_name: string | null; account: string } }
  | { method: 'cash'; details: { address: string; hours: string | null } }

/** A request waiting for the platform owner, with its office. */
export type PaymentRequest = SubscriptionPayment & {
  office_id: string
  office_name: string
  office_city: string | null
  subscription_ends_at: string | null
  requested_by_name: string | null
  requested_by_email: string | null
}

export type OfficeSubscriptionRow = {
  office_id: string
  name: string
  city: string | null
  status: OfficeStatus
  owner_name: string
  owner_email: string
  last_paid_at: string | null
  last_amount: number | null
  last_currency: string | null
  last_method: PaymentMethod | null
  paid_total: number
  /** The lawyers the office pays for now. */
  lawyers: number
  subscription: SubscriptionSummary
}
