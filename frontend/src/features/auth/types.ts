import type { Timestamptz, UUID } from '@/types/entities'

/**
 * Contracts of the multi-tenant backend (backend-development). See docs/API_CONTRACTS.md.
 * Role names are the existing `roles.role_name` values; inside an office `admin` is the
 * office administrator. Platform administration is the separate `is_platform_admin` flag.
 */
export type OfficeRole = 'admin' | 'lawyer' | 'assistant' | 'client'
export type OfficeStatus = 'pending' | 'active' | 'rejected' | 'suspended'
export type MembershipStatus = 'active' | 'suspended'

export type Membership = {
  office_id: UUID
  office_name: string
  office_status: OfficeStatus
  office_city: string | null
  role: OfficeRole
  membership_status: MembershipStatus
  is_owner: boolean
}

export type SessionUser = {
  user_id: UUID
  full_name: string
  email: string
  email_verified: boolean
  status: string
  is_platform_admin: boolean
  created_at: Timestamptz
  updated_at: Timestamptz
}

/** `GET /api/me`. `role` and `active_office` are null until an office is selected server-side. */
export type AuthSession = {
  user: SessionUser
  role: OfficeRole | null
  active_office: Membership | null
  memberships: Membership[]
}

export type LoginCredentials = {
  email: string
  password: string
  remember: boolean
}

export type SignUpInput = {
  name: string
  email: string
  password: string
}

export type OfficeInput = {
  name: string
  phone: string
  city: string
  email?: string
  address?: string
  license_number?: string
}

export type LawyerInput = {
  bar_number: string
  specialty?: string
  years_experience?: number
}

export type OfficeRegistrationInput = { office: OfficeInput; lawyer: LawyerInput }

export type RegisteredOffice = {
  office_id: UUID
  name: string
  status: OfficeStatus
  created_at: Timestamptz
}

export type InvitationState = 'pending' | 'accepted' | 'revoked' | 'expired'

/** Public preview of an invitation link: nothing about cases or clients is exposed. */
export type InvitationPreview = {
  office_name: string
  office_active: boolean
  role: Exclude<OfficeRole, 'admin'>
  email_hint: string
  state: InvitationState
  expires_at: Timestamptz
}

export type AcceptInvitationInput = Partial<LawyerInput>

export type AuthService = {
  /** Resolves to null when there is no valid session cookie. */
  getSession(): Promise<AuthSession | null>
  login(credentials: LoginCredentials): Promise<void>
  signUp(input: SignUpInput): Promise<void>
  logout(): Promise<void>
  selectOffice(officeId: UUID): Promise<void>
  requestPasswordReset(email: string, redirectTo: string): Promise<void>
  resetPassword(token: string, newPassword: string): Promise<void>
}

export type OnboardingService = {
  registerOffice(input: OfficeRegistrationInput): Promise<RegisteredOffice>
  previewInvitation(token: string): Promise<InvitationPreview>
  acceptInvitation(
    token: string,
    input: AcceptInvitationInput,
  ): Promise<{ office_id: UUID; role: OfficeRole }>
}
