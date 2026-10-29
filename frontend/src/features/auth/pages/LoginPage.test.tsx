import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { RedirectIfAuthenticated } from '@/app/router/RequireAuth'
import i18n from '@/lib/i18n'
import { DEMO_ACCOUNT_EMAIL, MOCK_PASSWORD } from '@/mocks/data/users'
import { renderRoute } from '@/test/render'
import { resetMockAuth } from '../api/auth.mock'
import LoginPage from './LoginPage'

const signIn = async (email: string, password = MOCK_PASSWORD) => {
  const user = userEvent.setup()
  renderRoute(<LoginPage />)
  await user.type(await screen.findByLabelText('البريد الإلكتروني'), email)
  await user.type(screen.getByLabelText('كلمة المرور'), password)
  await user.click(screen.getByRole('button', { name: 'تسجيل الدخول' }))
}

describe('LoginPage', () => {
  beforeEach(async () => {
    resetMockAuth()
    await i18n.changeLanguage('ar')
  })

  it('renders in Arabic RTL by default', async () => {
    renderRoute(<LoginPage />)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'سجّل الدخول إلى مكتبك' }),
    ).toBeInTheDocument()
    expect(document.documentElement.dir).toBe('rtl')
    expect(document.documentElement.lang).toBe('ar')
  })

  it('switches to English LTR and keeps typed values', async () => {
    const user = userEvent.setup()
    renderRoute(<LoginPage />)
    const email = await screen.findByLabelText('البريد الإلكتروني')
    await user.type(email, 'someone@office.ps')
    // controls exist in both the mobile banner and desktop header (one is hidden by CSS)
    const [languageButton] = screen.getAllByRole('button', { name: 'التبديل إلى الإنجليزية' })
    if (!languageButton) throw new Error('language switcher missing')
    await user.click(languageButton)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sign in to your office' }),
    ).toBeInTheDocument()
    expect(document.documentElement.dir).toBe('ltr')
    expect(screen.getByLabelText('Email address')).toHaveValue('someone@office.ps')
    expect(localStorage.getItem('qadiyati.lang')).toBe('en')
  })

  it('shows localized validation errors', async () => {
    const user = userEvent.setup()
    renderRoute(<LoginPage />)
    await user.click(await screen.findByRole('button', { name: 'تسجيل الدخول' }))
    expect(await screen.findAllByText('هذا الحقل مطلوب.')).toHaveLength(2)
    expect(screen.getByLabelText('البريد الإلكتروني')).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows an error for wrong credentials', async () => {
    await signIn('lawyer@qadiyati.ps', 'wrong-password')
    expect(
      await screen.findByText('البريد الإلكتروني أو كلمة المرور غير صحيحة.', {}, { timeout: 3000 }),
    ).toBeInTheDocument()
  })

  it('refuses a suspended account with a clear message', async () => {
    await signIn('inactive@qadiyati.ps')
    expect(
      await screen.findByText(
        'هذا الحساب موقوف. يرجى التواصل مع مدير المكتب.',
        {},
        { timeout: 3000 },
      ),
    ).toBeInTheDocument()
  })

  it('toggles password visibility', async () => {
    const user = userEvent.setup()
    renderRoute(<LoginPage />)
    const password = await screen.findByLabelText('كلمة المرور')
    expect(password).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: 'إظهار كلمة المرور' }))
    expect(password).toHaveAttribute('type', 'text')
  })

  it('opens the only office directly and keeps no token in browser storage', async () => {
    const user = userEvent.setup()
    renderRoute(<LoginPage />)
    await user.click(await screen.findByRole('button', { name: 'تعبئة بيانات تجريبية' }))
    expect(screen.getByLabelText('البريد الإلكتروني')).toHaveValue(DEMO_ACCOUNT_EMAIL)
    expect(screen.getByLabelText('كلمة المرور')).toHaveValue(MOCK_PASSWORD)
    await user.click(screen.getByRole('checkbox', { name: 'تذكّرني على هذا الجهاز' }))
    await user.click(screen.getByRole('button', { name: 'تسجيل الدخول' }))
    await waitFor(() => expect(screen.getByText('dashboard-route')).toBeInTheDocument(), {
      timeout: 3000,
    })
    // The legacy bearer-token entry is gone; the demo session only names the account.
    expect(localStorage.getItem('qadiyati.session')).toBeNull()
    expect(localStorage.getItem('qadiyati.mock-session')).toContain(DEMO_ACCOUNT_EMAIL)
  })

  it('lands a single-office user on the dashboard even behind the sign-in route guard', async () => {
    const user = userEvent.setup()
    renderRoute(
      <RedirectIfAuthenticated>
        <LoginPage />
      </RedirectIfAuthenticated>,
    )
    await user.type(await screen.findByLabelText('البريد الإلكتروني'), DEMO_ACCOUNT_EMAIL)
    await user.type(screen.getByLabelText('كلمة المرور'), MOCK_PASSWORD)
    await user.click(screen.getByRole('button', { name: 'تسجيل الدخول' }))
    await waitFor(() => expect(screen.getByText('dashboard-route')).toBeInTheDocument(), {
      timeout: 3000,
    })
  })

  it('asks a member of several offices to choose one', async () => {
    await signIn('lawyer@qadiyati.ps')
    await waitFor(() => expect(screen.getByText('select-office-route')).toBeInTheDocument(), {
      timeout: 3000,
    })
  })

  it('sends the owner of an office under review to onboarding', async () => {
    await signIn('pending@qadiyati.ps')
    await waitFor(() => expect(screen.getByText('onboarding-route')).toBeInTheDocument(), {
      timeout: 3000,
    })
  })

  it('toggles the theme and persists it', async () => {
    const user = userEvent.setup()
    renderRoute(<LoginPage />)
    const [themeButton] = await screen.findAllByRole('button', { name: 'التبديل إلى الوضع الداكن' })
    if (!themeButton) throw new Error('theme toggle missing')
    await user.click(themeButton)
    expect(document.documentElement).toHaveClass('dark')
    expect(localStorage.getItem('qadiyati.theme')).toBe('dark')
  })
})
