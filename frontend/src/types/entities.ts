/**
 * Frontend models mirroring the PostgreSQL ERD (schema `public`).
 *
 * Rules followed here:
 *  - Field names are kept EXACTLY as in the database (snake_case) — no renaming.
 *  - No fields were invented. Anything the UI needs that is not in the ERD is
 *    listed under "Gaps" in docs/ARCHITECTURE.md instead of being added here.
 *  - Nullability is NOT visible in the ERD image. Columns that are clearly optional by
 *    meaning (closed_at, read_at, …) are typed `| null`; this is an ASSUMPTION to be
 *    confirmed against the SQL schema.
 *  - varchar "status/type/priority" columns have no enumerated values in the ERD, so they
 *    are typed as `string` until the backend publishes the allowed values.
 */

/** PostgreSQL `uuid` */
export type UUID = string
/** PostgreSQL `timestamp with time zone`, serialised as ISO-8601 */
export type Timestamptz = string
/** PostgreSQL `date`, serialised as `YYYY-MM-DD` */
export type DateString = string
/**
 * PostgreSQL `numeric(12,2)` — kept as a string to avoid floating-point rounding
 * (node-postgres returns numerics as strings by default).
 */
export type Numeric = string

// ───────────────────────── Identity & access ─────────────────────────

export type Role = {
  role_id: UUID
  /** unique */
  role_name: string
  description: string | null
}

/**
 * `app_users`. The `password_hash` column is deliberately NOT part of the frontend
 * model — it must never leave the backend.
 */
export type AppUser = {
  user_id: UUID
  full_name: string
  /** unique */
  email: string
  status: string
  created_at: Timestamptz
  role_id: UUID
}

export type LawyerProfile = {
  lawyer_profile_id: UUID
  /** unique */
  bar_number: string
  specialty: string | null
  years_experience: number | null
  license_status: string
  user_id: UUID
}

export type AuditLog = {
  audit_log_id: UUID
  action: string
  entity_type: string
  entity_id: UUID
  details: Record<string, unknown> | null
  /** PostgreSQL `inet` */
  ip_address: string | null
  created_at: Timestamptz
  user_id: UUID | null
}

// ───────────────────────── Clients & cases ─────────────────────────

export type Client = {
  client_id: UUID
  client_type: string
  full_name_or_org: string
  phone: string | null
  email: string | null
  address: string | null
  created_at: Timestamptz
  user_id: UUID | null
}

export type Court = {
  court_id: UUID
  name: string
  location: string | null
  court_type: string | null
}

export type LegalCase = {
  case_id: UUID
  /** unique */
  case_number: string
  title: string
  case_type: string
  status: string
  priority: string
  opened_at: Timestamptz
  closed_at: Timestamptz | null
  description: string | null
  court_id: UUID | null
}

/** `involves` — junction: which clients are parties to which case (PK client_id + case_id). */
export type Involves = {
  client_id: UUID
  case_id: UUID
  party_role: string
  is_primary: boolean
}

/** `assigned_to` — junction: which users (lawyers) work a case (PK user_id + case_id). */
export type AssignedTo = {
  user_id: UUID
  case_id: UUID
  assignment_role: string
  assigned_at: Timestamptz
  is_lead: boolean
}

export type CaseNote = {
  note_id: UUID
  body: string
  visibility: string
  created_at: Timestamptz
  updated_at: Timestamptz
  case_id: UUID
  user_id: UUID
}

export type CaseStatusHistory = {
  history_id: UUID
  old_status: string | null
  new_status: string
  change_note: string | null
  changed_at: Timestamptz
  case_id: UUID
  user_id: UUID
}

// ───────────────────────── Scheduling ─────────────────────────

export type Hearing = {
  hearing_id: UUID
  hearing_at: Timestamptz
  hearing_type: string
  court_room: string | null
  outcome: string | null
  status: string
  notes: string | null
  case_id: UUID
  court_id: UUID
}

export type Appointment = {
  appointment_id: UUID
  starts_at: Timestamptz
  ends_at: Timestamptz
  status: string
  purpose: string | null
  location: string | null
  external_party_name: string | null
  client_id: UUID | null
  user_id: UUID
  case_id: UUID | null
}

export type Task = {
  task_id: UUID
  title: string
  description: string | null
  status: string
  priority: string
  due_at: Timestamptz | null
  completed_at: Timestamptz | null
  case_id: UUID | null
  assigned_to_user_id: UUID
  created_by_user_id: UUID
}

// ───────────────────────── Documents & contracts ─────────────────────────

export type LegalDocument = {
  document_id: UUID
  file_name: string
  /** unique — object-storage key; the file itself lives in backend storage */
  storage_key: string
  mime_type: string
  document_type: string
  source: string | null
  document_date: DateString | null
  access_level: string
  created_at: Timestamptz
  case_id: UUID | null
  client_id: UUID | null
  user_id: UUID
}

export type Contract = {
  contract_id: UUID
  title: string
  contract_type: string
  status: string
  /** unique */
  storage_key: string
  analysis_summary: string | null
  created_at: Timestamptz
  client_id: UUID
  case_id: UUID | null
  user_id: UUID
}

// ───────────────────────── Billing ─────────────────────────

export type Invoice = {
  invoice_id: UUID
  /** unique */
  invoice_number: string
  amount: Numeric
  /** ISO-4217, `character(3)` — e.g. ILS, JOD, USD */
  currency: string
  status: string
  issued_at: Timestamptz
  due_at: Timestamptz | null
  client_id: UUID
  case_id: UUID | null
  user_id: UUID
}

export type Payment = {
  payment_id: UUID
  amount: Numeric
  payment_method: string
  paid_at: Timestamptz
  /** unique */
  reference_number: string
  status: string
  invoice_id: UUID
  user_id: UUID
}

// ───────────────────────── Communication ─────────────────────────

export type Message = {
  message_id: UUID
  body: string
  sent_at: Timestamptz
  read_at: Timestamptz | null
  message_type: string
  sender_user_id: UUID
  receiver_user_id: UUID
  case_id: UUID | null
}

export type AppNotification = {
  notification_id: UUID
  title: string
  body: string | null
  notification_type: string
  read_at: Timestamptz | null
  created_at: Timestamptz
  user_id: UUID
}

// ───────────────────────── AI & legal research ─────────────────────────

export type AiInteraction = {
  interaction_id: UUID
  question: string
  answer_summary: string | null
  model_name: string | null
  created_at: Timestamptz
  user_id: UUID
  case_id: UUID | null
  document_id: UUID | null
}

export type LegalReference = {
  reference_id: UUID
  title: string
  reference_type: string
  jurisdiction: string | null
  citation: string | null
  source_url: string | null
  published_at: DateString | null
  user_id: UUID | null
}

/** `ai_interaction_sources` — junction (PK interaction_id + reference_id). */
export type AiInteractionSource = {
  interaction_id: UUID
  reference_id: UUID
  source_note: string | null
}
