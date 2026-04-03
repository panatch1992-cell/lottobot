import { test, expect } from '@playwright/test'

test.describe('Navigation & Page Loading', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/fonts.googleapis.com/**', route => route.abort())
  })

  test('root page should redirect to login when unauthenticated', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
  })

  test('login page should return 200', async ({ page }) => {
    const response = await page.goto('/login')
    expect(response?.status()).toBe(200)
  })

  test('admin pages should redirect to login when unauthenticated', async ({ page }) => {
    const adminPages = ['/dashboard', '/lotteries', '/history', '/settings', '/results', '/scraping']
    for (const path of adminPages) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login/, { timeout: 5000 })
    }
  })

  test('login page should have proper HTML structure', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('html')).toHaveAttribute('lang', 'th')
    await expect(page.locator('body')).toBeVisible()
  })
})
