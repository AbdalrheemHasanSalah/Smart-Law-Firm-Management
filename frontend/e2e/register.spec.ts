import { expect, test } from '@playwright/test'

// Runs against the default (mock) build: no backend is needed and no real data is touched.

test('register an office through the four-step wizard in Arabic RTL', async ({ page }) => {
  await page.goto('/register')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('سجّل مكتبك')

  await page.getByLabel('الاسم الكامل').fill('ليلى حداد')
  await page.getByLabel('البريد الإلكتروني').fill('e2e.owner@office.ps')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('Justice2026')
  await page.getByLabel('تأكيد كلمة المرور').fill('Justice2026')
  await page.getByRole('button', { name: 'متابعة' }).click()

  await page.getByLabel('اسم المكتب').fill('مكتب الاختبار')
  await page.getByLabel('هاتف المكتب').fill('+970 59 123 4567')
  await page.getByLabel('المدينة').fill('نابلس')
  await page.getByRole('button', { name: 'متابعة' }).click()

  await page.getByLabel('رقم العضوية في نقابة المحامين').fill('PBA-4242')
  await page.getByRole('button', { name: 'متابعة' }).click()

  await expect(page.getByText('مكتب الاختبار')).toBeVisible()
  await page.getByRole('checkbox').click()
  await page.getByRole('button', { name: 'إرسال طلب التسجيل' }).click()
  await expect(page.getByRole('heading', { name: 'تمّ استلام طلب التسجيل' })).toBeVisible()

  await page.getByRole('link', { name: 'عرض حالة التسجيل' }).click()
  await expect(page).toHaveURL(/\/onboarding$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('مكتبك قيد المراجعة')
})

test('a member of two offices picks one and reaches the dashboard', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('البريد الإلكتروني').fill('lawyer@qadiyati.ps')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('Qadiyati@2026')
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click()
  await expect(page).toHaveURL(/\/select-office$/)
  await page.getByRole('button', { name: /مكتب خليل وشركاه/ }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByText('المكتب: مكتب خليل وشركاه')).toBeVisible()
})

test('registration has no horizontal overflow in either language', async ({ page }) => {
  for (const language of ['ar', 'en']) {
    await page.goto('/register')
    if (language === 'en') {
      await page.getByRole('button', { name: 'التبديل إلى الإنجليزية' }).first().click()
      await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
    expect(overflow).toBe(false)
  }
})

test('the dark theme applies to the registration wizard', async ({ page }) => {
  await page.goto('/register')
  await page.getByRole('button', { name: 'التبديل إلى الوضع الداكن' }).first().click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(background).not.toBe('rgb(250, 247, 241)')
})
