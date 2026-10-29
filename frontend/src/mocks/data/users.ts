import type { Membership, OfficeStatus, SessionUser } from '@/features/auth/types'

/**
 * Fictional demo records for mock mode. No real people, offices, or client data.
 * The shapes mirror the multi-tenant backend responses (`GET /api/me`).
 */

/** Shared demo password for every mock account. Mock mode only — not a secret. */
export const MOCK_PASSWORD = 'Qadiyati@2026'

export type MockOffice = {
  office_id: string
  office_name: string
  office_city: string
  office_status: OfficeStatus
}

export type MockAccount = {
  user: SessionUser
  password: string
  memberships: Array<Omit<Membership, 'office_name' | 'office_city' | 'office_status'>>
}

export const mockOffices: MockOffice[] = [
  {
    office_id: '5b0f8e2a-1c3d-4e5f-8a9b-0c1d2e3f4a01',
    office_name: 'مكتب حداد للمحاماة',
    office_city: 'نابلس',
    office_status: 'active',
  },
  {
    office_id: '5b0f8e2a-1c3d-4e5f-8a9b-0c1d2e3f4a02',
    office_name: 'مكتب خليل وشركاه',
    office_city: 'رام الله',
    office_status: 'active',
  },
  {
    office_id: '5b0f8e2a-1c3d-4e5f-8a9b-0c1d2e3f4a03',
    office_name: 'مكتب عودة القانوني',
    office_city: 'الخليل',
    office_status: 'pending',
  },
]

const [haddad, khalil, odeh] = mockOffices.map((office) => office.office_id) as [
  string,
  string,
  string,
]

const user = (id: string, full_name: string, email: string, status = 'active'): SessionUser => ({
  user_id: `a3e4c9b0-7a51-4c1e-8d2b-5b9f3e6a1c${id}`,
  full_name,
  email,
  email_verified: true,
  status,
  is_platform_admin: false,
  created_at: '2026-01-12T08:30:00+02:00',
  updated_at: '2026-01-12T08:30:00+02:00',
})

const member = (office_id: string, role: Membership['role'], is_owner = false) => ({
  office_id,
  role,
  membership_status: 'active' as const,
  is_owner,
})

export const mockAccounts: MockAccount[] = [
  {
    user: user('01', 'ليلى حداد', 'admin@qadiyati.ps'),
    password: MOCK_PASSWORD,
    memberships: [member(haddad, 'admin', true)],
  },
  {
    // Works in two offices, so signing in shows the office picker.
    user: user('02', 'سامر خليل', 'lawyer@qadiyati.ps'),
    password: MOCK_PASSWORD,
    memberships: [member(haddad, 'lawyer'), member(khalil, 'admin', true)],
  },
  {
    user: user('03', 'رنا عودة', 'pending@qadiyati.ps'),
    password: MOCK_PASSWORD,
    memberships: [member(odeh, 'admin', true)],
  },
  {
    user: user('04', 'سميرة ناصر', 'client@qadiyati.ps'),
    password: MOCK_PASSWORD,
    memberships: [member(haddad, 'client')],
  },
  {
    user: user('05', 'باسل يوسف', 'inactive@qadiyati.ps', 'suspended'),
    password: MOCK_PASSWORD,
    memberships: [member(haddad, 'assistant')],
  },
]

/** The account the "fill demo credentials" button uses: one office, straight to the dashboard. */
export const DEMO_ACCOUNT_EMAIL = 'admin@qadiyati.ps'

/** Demo invitation links: `/invite/<token>`. */
export const mockInvitations = [
  {
    token: 'demo-invite-lawyer',
    office_id: haddad,
    email: 'new.lawyer@qadiyati.ps',
    role: 'lawyer' as const,
  },
  {
    token: 'demo-invite-client',
    office_id: haddad,
    email: 'new.client@qadiyati.ps',
    role: 'client' as const,
  },
]
