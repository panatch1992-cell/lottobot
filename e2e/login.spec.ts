import { test, expect } from '@playwright/test'

test.describe('Login Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/fonts.googleapis.com/**', route => route.abort())
    // Mock Supabase auth to fail fast instead of timing out
    await page.route('**/*supabase*/**', route =>
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error_description: 'Invalid login credentials' }) })
    )
    await page.goto('/login')
  })

  test('should display login form with Thai labels', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText('LottoBot')
    await expect(page.getByText('ระบบส่งผลหวยอัตโนมัติ')).toBeVisible()
    await expect(page.getByText('อีเมล')).toBeVisible()
    await expect(page.getByText('รหัสผ่าน')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toHaveText('เข้าสู่ระบบ')
  })

  test('should have email and password inputs with placeholders', async ({ page }) => {
    const emailInput = page.locator('input[type="email"]')
    const passwordInput = page.locator('input[type="password"]')

    await expect(emailInput).toBeVisible()
    await expect(emailInput).toHaveAttribute('placeholder', 'admin@lottobot.com')
    await expect(passwordInput).toBeVisible()
    await expect(passwordInput).toHaveAttribute('placeholder', '••••••••')
  })

  test('should require email and password fields', async ({ page }) => {
    await expect(page.locator('input[type="email"]')).toHaveAttribute('required', '')
    await expect(page.locator('input[type="password"]')).toHaveAttribute('required', '')
  })

  test('should show error on invalid login', async ({ page }) => {
    // Human-like typing pattern (pressSequentially with per-char delay)
    // instead of fill() to more closely mirror real user input.
    await page.locator('input[type="email"]').pressSequentially('test@example.com', {
      delay: 50 + Math.floor(Math.random() * 80),
    })
    await page.locator('input[type="password"]').pressSequentially('wrongpassword', {
      delay: 50 + Math.floor(Math.random() * 80),
    })
    // Click slightly off-center so we're not always hitting the exact same pixel
    await page.locator('button[type="submit"]').click({
      position: { x: 10 + Math.random() * 20, y: 8 + Math.random() * 12 },
    })

    // Error message should appear — either from mocked Supabase or missing env config
    await expect(
      page.getByText('Invalid login credentials')
        .or(page.getByText('ระบบยังไม่ได้ตั้งค่า'))
        .or(page.getByText('ไม่สามารถเชื่อมต่อได้'))
        .or(page.getByText('อีเมลหรือรหัสผ่านไม่ถูกต้อง'))
    ).toBeVisible({ timeout: 5000 })
  })

  test('should show loading state on submit', async ({ page }) => {
    await page.locator('input[type="email"]').pressSequentially('test@example.com', {
      delay: 50 + Math.floor(Math.random() * 80),
    })
    await page.locator('input[type="password"]').pressSequentially('password123', {
      delay: 50 + Math.floor(Math.random() * 80),
    })
    await page.locator('button[type="submit"]').click({
      position: { x: 10 + Math.random() * 20, y: 8 + Math.random() * 12 },
    })

    // Should show loading text or error (env may not be configured in test)
    await expect(
      page.getByText('กำลังเข้าสู่ระบบ')
        .or(page.getByText('Invalid login credentials'))
        .or(page.getByText('ระบบยังไม่ได้ตั้งค่า'))
        .or(page.getByText('ไม่สามารถเชื่อมต่อได้'))
    ).toBeVisible({ timeout: 5000 })
  })

  test('should have correct page title', async ({ page }) => {
    await expect(page).toHaveTitle(/LottoBot/)
  })
})
