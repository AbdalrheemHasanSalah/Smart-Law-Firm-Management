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
  created_at: string
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
