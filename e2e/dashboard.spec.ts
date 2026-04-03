import { test, expect } from '@playwright/test'

test.describe('Dashboard Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/fonts.googleapis.com/**', route => route.abort())
  })

  test('should redirect to login when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard')
    // Auth middleware redirects to /login
    await expect(page).toHaveURL(/\/login/)
  })

  test('should render login page with LottoBot branding after redirect', async ({ page }) => {
    await page.goto('/dashboard')
    // After redirect to login, should show login form
    await expect(page.locator('h1')).toHaveText('LottoBot')
  })

  test('login page should be responsive on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/login')
    await expect(page.locator('h1')).toHaveText('LottoBot')
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })
})
