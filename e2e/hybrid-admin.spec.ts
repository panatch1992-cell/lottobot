import { test, expect } from '@playwright/test'

test.describe('Lucky Images Page (Hybrid)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/fonts.googleapis.com/**', route => route.abort())
  })

  test('should redirect to login when unauthenticated', async ({ page }) => {
    await page.goto('/lucky-images')
    await expect(page).toHaveURL(/\/login/)
  })

  test('should show login form after redirect', async ({ page }) => {
    await page.goto('/lucky-images')
    await expect(page.locator('h1')).toHaveText('LottoBot')
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test('should render admin page when cookie is present (server-side)', async ({ page, context }) => {
    await context.addCookies([
      { name: 'sb-access-token', value: 'fake', domain: 'localhost', path: '/' },
    ])
    // Stub client-side API calls — the page still renders its shell
    await page.route('**/api/admin/lucky-images**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], stats: { total: 0, active: 0, inactive: 0, totalUse: 0 } }),
      }),
    )
    await page.route('**/*supabase*/**', route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"stub"}' }),
    )

    await page.goto('/lucky-images')
    // TopBar also shows the title → match the page's big h1 (with 📸 icon)
    await expect(page.getByRole('heading', { name: /📸 คลังรูปเลขเด็ด/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Sync จาก huaypnk/ })).toBeVisible()
    // Empty state is shown when items is empty
    await expect(page.getByText(/ยังไม่มีรูปในคลัง/)).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Bot Accounts Page (Hybrid)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/fonts.googleapis.com/**', route => route.abort())
  })

  test('should redirect to login when unauthenticated', async ({ page }) => {
    await page.goto('/bot-accounts')
    await expect(page).toHaveURL(/\/login/)
  })

  test('should render admin page heading when cookie is present', async ({ page, context }) => {
    await context.addCookies([
      { name: 'sb-access-token', value: 'fake', domain: 'localhost', path: '/' },
    ])
    await page.route('**/api/admin/bot-accounts**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] }),
      }),
    )
    await page.route('**/*supabase*/**', route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"stub"}' }),
    )

    await page.goto('/bot-accounts')
    // TopBar shows "Bot Accounts" — the page's h1 is longer with emoji + "Pool"
    await expect(page.getByRole('heading', { name: /🤖 Bot Accounts Pool/ })).toBeVisible()
    // Empty state text
    await expect(page.getByText(/ยังไม่มีบัญชีใน pool/)).toBeVisible({ timeout: 5000 })
  })
})
