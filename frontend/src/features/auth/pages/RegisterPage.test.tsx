import { screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '@/lib/i18n'
import { renderRoute } from '@/test/render'
import { mockAuthService, resetMockAuth } from '../api/auth.mock'
import RegisterPage from './RegisterPage'

const PASSWORD = 'Justice2026'

const fillAccount = async (user: UserEvent, email = 'new.owner@office.ps') => {
  await user.type(await screen.findByLabelText('الاسم الكامل'), 'ليلى حداد')
  await user.type(screen.getByLabelText('البريد الإلكتروني'), email)
  await user.type(screen.getByLabelText('كلمة المرور'), PASSWORD)
  await user.type(screen.getByLabelText('تأكيد كلمة المرور'), PASSWORD)
  await user.click(screen.getByRole('button', { name: 'متابعة' }))
}

const fillOffice = async (user: UserEvent) => {
  await user.type(await screen.findByLabelText('اسم المكتب'), 'مكتب الاختبار')
  await user.type(screen.getByLabelText('هاتف المكتب'), '+970 59 123 4567')
  await user.type(screen.getByLabelText('المدينة'), 'نابلس')
  await user.click(screen.getByRole('button', { name: 'متابعة' }))
}

const fillLawyer = async (user: UserEvent) => {
  await user.type(await screen.findByLabelText('رقم العضوية في نقابة المحامين'), 'PBA-7788')
  await user.click(screen.getByRole('button', { name: 'متابعة' }))
}

const submitReview = async (user: UserEvent) => {
  await user.click(await screen.findByRole('checkbox', { name: /أؤكد أن هذه البيانات صحيحة/ }))
  await user.click(screen.getByRole('button', { name: 'إرسال طلب التسجيل' }))
}

describe('RegisterPage', () => {
  beforeEach(async () => {
    resetMockAuth()
    await i18n.changeLanguage('ar')
  })

  it('registers a new office through all four steps and shows it as under review', async () => {
    const user = userEvent.setup()
    renderRoute(<RegisterPage />, '/register')
    expect(await screen.findByText('الخطوة 1 من 4')).toBeInTheDocument()
    await fillAccount(user)
    expect(await screen.findByText('الخطوة 2 من 4')).toBeInTheDocument()
    await fillOffice(user)
    await fillLawyer(user)
    expect(await screen.findByText('مكتب الاختبار')).toBeInTheDocument()
    expect(screen.getByText('PBA-7788')).toBeInTheDocument()
    await submitReview(user)
    expect(
      await screen.findByRole('heading', { name: 'تمّ استلام طلب التسجيل' }, { timeout: 4000 }),
    ).toBeInTheDocument()

    const session = await mockAuthService.getSession()
    expect(session?.active_office).toBeNull()
    expect(session?.memberships).toEqual([
      expect.objectContaining({
        office_name: 'مكتب الاختبار',
        office_status: 'pending',
        role: 'admin',
        is_owner: true,
      }),
    ])
  }, 30_000)

  it('validates each step before moving on', async () => {
    const user = userEvent.setup()
    renderRoute(<RegisterPage />, '/register')
    await user.type(await screen.findByLabelText('كلمة المرور'), PASSWORD)
    await user.type(screen.getByLabelText('تأكيد كلمة المرور'), 'Different2026')
    await user.click(screen.getByRole('button', { name: 'متابعة' }))
    expect(await screen.findByText('كلمتا المرور غير متطابقتين.')).toBeInTheDocument()
    expect(screen.getByText('الخطوة 1 من 4')).toBeInTheDocument()
  })

  it('keeps entered values when going back a step', async () => {
    const user = userEvent.setup()
    renderRoute(<RegisterPage />, '/register')
    await fillAccount(user)
    await fillOffice(user)
    await user.click(await screen.findByRole('button', { name: 'رجوع' }))
    expect(await screen.findByLabelText('اسم المكتب')).toHaveValue('مكتب الاختبار')
    await user.click(screen.getByRole('button', { name: 'رجوع' }))
    expect(await screen.findByLabelText('البريد الإلكتروني')).toHaveValue('new.owner@office.ps')
  })

  it('requires the accuracy declaration before submitting', async () => {
    const user = userEvent.setup()
    renderRoute(<RegisterPage />, '/register')
    await fillAccount(user)
    await fillOffice(user)
    await fillLawyer(user)
    await user.click(await screen.findByRole('button', { name: 'إرسال طلب التسجيل' }))
    expect(await screen.findByText('يرجى تأكيد صحة البيانات قبل الإرسال.')).toBeInTheDocument()
  })

  it('explains an email that already has an account and offers a fix', async () => {
    const user = userEvent.setup()
    renderRoute(<RegisterPage />, '/register')
    await fillAccount(user, 'admin@qadiyati.ps')
    await fillOffice(user)
    await fillLawyer(user)
    await submitReview(user)
    expect(
      await screen.findByText(
        'يوجد حساب بهذا البريد الإلكتروني. سجّل الدخول بدلاً من ذلك.',
        {},
        { timeout: 4000 },
      ),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'تعديل بيانات الحساب' }))
    expect(await screen.findByLabelText('البريد الإلكتروني')).toHaveValue('admin@qadiyati.ps')
  })

  it('works in English LTR', async () => {
    await i18n.changeLanguage('en')
    renderRoute(<RegisterPage />, '/register')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Register your office' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
    await waitFor(() => expect(document.documentElement.dir).toBe('ltr'))
  })
})
