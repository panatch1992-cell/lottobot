import { test, expect } from '@playwright/test'

test.describe('Lotteries Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/fonts.googleapis.com/**', route => route.abort())
  })

  test('should redirect to login when unauthenticated', async ({ page }) => {
    await page.goto('/lotteries')
    await expect(page).toHaveURL(/\/login/)
  })

  test('should show login form after redirect', async ({ page }) => {
    await page.goto('/lotteries')
    await expect(page.locator('h1')).toHaveText('LottoBot')
  })
})
