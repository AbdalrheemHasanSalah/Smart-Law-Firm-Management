import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ROUTES } from '@/app/router/routes'
import i18n from '@/lib/i18n'
import { MOCK_PASSWORD } from '@/mocks/data/users'
import SignedInPage from '@/pages/SignedInPage'
import { ApiError } from '@/services/api/api-error'
import { renderRoute } from '@/test/render'
import { mockAuthService, resetMockAuth } from '../api/auth.mock'
import InvitationPage from './InvitationPage'
import OnboardingPage from './OnboardingPage'
import SelectOfficePage from './SelectOfficePage'

const signInAs = (email: string) =>
  mockAuthService.login({ email, password: MOCK_PASSWORD, remember: false })

describe('office selection', () => {
  beforeEach(async () => {
    resetMockAuth()
    await i18n.changeLanguage('ar')
  })

  it('lists every office of the account and enters the chosen one', async () => {
    await signInAs('lawyer@qadiyati.ps')
    const user = userEvent.setup()
    renderRoute(<SelectOfficePage />, ROUTES.selectOffice)
    expect(await screen.findByText('مكتب حداد للمحاماة')).toBeInTheDocument()
    expect(screen.getByText('مكتب خليل وشركاه')).toBeInTheDocument()
    expect(screen.getByText('محامٍ')).toBeInTheDocument()
    expect(screen.getByText('مالك المكتب')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /مكتب خليل وشركاه/ }))
    await waitFor(() => expect(screen.getByText('dashboard-route')).toBeInTheDocument(), {
      timeout: 3000,
    })
    const session = await mockAuthService.getSession()
    expect(session?.active_office?.office_name).toBe('مكتب خليل وشركاه')
    expect(session?.role).toBe('admin')
  })
})

describe('onboarding', () => {
  beforeEach(async () => {
    resetMockAuth()
    await i18n.changeLanguage('ar')
  })

  it('shows an office under review without offering a second registration', async () => {
    await signInAs('pending@qadiyati.ps')
    renderRoute(<OnboardingPage />, ROUTES.onboarding)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'مكتبك قيد المراجعة' }),
    ).toBeInTheDocument()
    expect(screen.getByText('مكتب عودة القانوني')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'تسجيل مكتب' })).not.toBeInTheDocument()
  })

  it('offers registration and explains invitations to an account without offices', async () => {
    await mockAuthService.signUp({
      name: 'New User',
      email: 'fresh@office.ps',
      password: 'Justice2026',
    })
    renderRoute(<OnboardingPage />, ROUTES.onboarding)
    expect(await screen.findByRole('link', { name: 'تسجيل مكتب' })).toBeInTheDocument()
    expect(screen.getByText('تنضمّ إلى مكتب قائم؟')).toBeInTheDocument()
  })
})

describe('invitations', () => {
  beforeEach(async () => {
    resetMockAuth()
    await i18n.changeLanguage('ar')
  })

  it('rejects an unknown invitation link', async () => {
    renderRoute(<InvitationPage />, '/invite/not-a-real-token', ROUTES.invitation)
    expect(await screen.findByText('رابط دعوة غير صالح', {}, { timeout: 3000 })).toBeInTheDocument()
  })

  it('shows the office and a masked address, never the full invited email', async () => {
    renderRoute(<InvitationPage />, '/invite/demo-invite-lawyer', ROUTES.invitation)
    expect(await screen.findByText('مكتب حداد للمحاماة', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.queryByText(/new\.lawyer@qadiyati\.ps/)).not.toBeInTheDocument()
    // shown in the invitation summary and as the hint under the email field
    expect(screen.getAllByText(/ne•+@qadiyati\.ps/).length).toBeGreaterThan(0)
  })

  it('creates the account with the invited email and joins the office', async () => {
    const user = userEvent.setup()
    renderRoute(<InvitationPage />, '/invite/demo-invite-client', ROUTES.invitation)
    await user.type(await screen.findByLabelText('الاسم الكامل', {}, { timeout: 3000 }), 'سميرة')
    await user.type(screen.getByLabelText('البريد الإلكتروني'), 'new.client@qadiyati.ps')
    await user.type(screen.getByLabelText('كلمة المرور'), 'Justice2026')
    await user.type(screen.getByLabelText('تأكيد كلمة المرور'), 'Justice2026')
    await user.click(screen.getByRole('button', { name: 'إنشاء الحساب والانضمام' }))
    await waitFor(() => expect(screen.getByText('dashboard-route')).toBeInTheDocument(), {
      timeout: 4000,
    })
    const session = await mockAuthService.getSession()
    expect(session?.role).toBe('client')
    expect(session?.active_office?.office_name).toBe('مكتب حداد للمحاماة')
  }, 20_000)

  it('refuses an invitation opened by a different account', async () => {
    await signInAs('admin@qadiyati.ps')
    const user = userEvent.setup()
    renderRoute(<InvitationPage />, '/invite/demo-invite-lawyer', ROUTES.invitation)
    await user.click(
      await screen.findByRole(
        'button',
        { name: 'الانضمام إلى مكتب حداد للمحاماة' },
        { timeout: 3000 },
      ),
    )
    expect(
      await screen.findByText('أُرسلت هذه الدعوة إلى بريد إلكتروني مختلف.', {}, { timeout: 3000 }),
    ).toBeInTheDocument()
  })
})

describe('sign-out', () => {
  beforeEach(async () => {
    resetMockAuth()
    await i18n.changeLanguage('ar')
  })

  it('stays signed in and says so when the server cannot end the session', async () => {
    await signInAs('admin@qadiyati.ps')
    await mockAuthService.selectOffice('5b0f8e2a-1c3d-4e5f-8a9b-0c1d2e3f4a01')
    const logout = vi
      .spyOn(mockAuthService, 'logout')
      .mockRejectedValueOnce(new ApiError('NETWORK'))
    const user = userEvent.setup()
    renderRoute(<SignedInPage />, ROUTES.dashboard)
    await user.click(await screen.findByRole('button', { name: 'تسجيل الخروج' }, { timeout: 3000 }))
    expect(
      await screen.findByText('تعذّر تسجيل الخروج من الخادم. تحقّق من اتصالك وحاول مجدداً.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'تسجيل الخروج' })).toBeEnabled()
    expect(await mockAuthService.getSession()).not.toBeNull()
    logout.mockRestore()
  })
})
