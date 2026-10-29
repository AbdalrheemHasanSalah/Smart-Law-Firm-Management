import { describe, expect, it } from 'vitest'
import { ROUTES } from '@/app/router/routes'
import { destinationFor, postLoginPath, safeRedirectPath } from './session-routing'
import type { AuthSession, Membership } from './types'

const membership = (overrides: Partial<Membership> = {}): Membership => ({
  office_id: 'office-1',
  office_name: 'Office',
  office_status: 'active',
  office_city: 'Nablus',
  role: 'lawyer',
  membership_status: 'active',
  is_owner: false,
  ...overrides,
})

const session = (memberships: Membership[], active: Membership | null = null): AuthSession => ({
  user: {
    user_id: 'user-1',
    full_name: 'Test',
    email: 'test@office.ps',
    email_verified: true,
    status: 'active',
    is_platform_admin: false,
    created_at: '',
    updated_at: '',
  },
  role: active?.role ?? null,
  active_office: active,
  memberships,
})

describe('destinationFor', () => {
  it('sends visitors to sign-in', () => {
    expect(destinationFor(null)).toBe(ROUTES.login)
  })

  it('opens the dashboard only when the server reports an active office', () => {
    const active = membership()
    expect(destinationFor(session([active], active))).toBe(ROUTES.dashboard)
    expect(destinationFor(session([active]))).toBe(ROUTES.selectOffice)
  })

  it('treats pending, rejected and suspended access as onboarding', () => {
    expect(destinationFor(session([]))).toBe(ROUTES.onboarding)
    expect(
      destinationFor(session([membership({ office_status: 'pending', is_owner: true })])),
    ).toBe(ROUTES.onboarding)
    expect(destinationFor(session([membership({ office_status: 'rejected' })]))).toBe(
      ROUTES.onboarding,
    )
    expect(destinationFor(session([membership({ membership_status: 'suspended' })]))).toBe(
      ROUTES.onboarding,
    )
  })
})

describe('safeRedirectPath', () => {
  it('only allows in-app paths', () => {
    expect(safeRedirectPath('/dashboard')).toBe('/dashboard')
    expect(safeRedirectPath('//evil.example')).toBeNull()
    expect(safeRedirectPath('https://evil.example')).toBeNull()
    expect(safeRedirectPath(undefined)).toBeNull()
  })
})

describe('postLoginPath', () => {
  const active = membership()

  it('returns to the requested page only once an office is active', () => {
    expect(postLoginPath({ from: '/dashboard' }, session([active], active))).toBe('/dashboard')
    expect(postLoginPath({ from: '/dashboard' }, session([active]))).toBe(ROUTES.selectOffice)
  })

  it('always allows returning to an invitation link', () => {
    expect(postLoginPath({ from: '/invite/abc' }, session([]))).toBe('/invite/abc')
  })

  it('ignores off-site targets', () => {
    expect(postLoginPath({ from: '//evil.example' }, session([active], active))).toBe(
      ROUTES.dashboard,
    )
  })
})
