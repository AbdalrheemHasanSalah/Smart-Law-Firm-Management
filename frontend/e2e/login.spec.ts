import { expect, test } from '@playwright/test'

test('login page renders RTL Arabic by default and signs in with demo credentials', async ({ page }) => {
  await page.goto('/login')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('سجّل الدخول إلى مكتبك')
  await page.getByRole('button', { name: 'تعبئة بيانات تجريبية' }).click()
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
})

test('language and theme switches persist across reloads', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'التبديل إلى الإنجليزية' }).click()
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(page.locator('html')).toHaveClass(/dark/)
})

test('no horizontal overflow', async ({ page }) => {
  await page.goto('/login')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
})
