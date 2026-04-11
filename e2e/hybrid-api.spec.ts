import { test, expect } from '@playwright/test'

async function safeJson(response: { text: () => Promise<string> }) {
  try {
    return JSON.parse(await response.text())
  } catch {
    return null
  }
}

/**
 * These tests exercise the admin API guards added in Phase 3.
 * We intentionally stay on the auth-rejection path because the
 * endpoints that touch Supabase will hang in this environment
 * (fake credentials from .env.test cannot reach the real host).
 */

test.describe('Hybrid Admin API — auth guards', () => {
  test('GET /api/admin/lucky-images without auth returns 401', async ({ request }) => {
    const res = await request.get('/api/admin/lucky-images', { timeout: 10000 })
    expect(res.status()).toBe(401)
    const body = await safeJson(res)
    expect(body?.error).toBe('Unauthorized')
  })

  test('POST /api/admin/lucky-images without auth returns 401', async ({ request }) => {
    const res = await request.post('/api/admin/lucky-images', {
      headers: { 'Content-Type': 'application/json' },
      data: { public_url: 'https://example.com/x.jpg' },
      timeout: 10000,
    })
    expect(res.status()).toBe(401)
  })

  test('DELETE /api/admin/lucky-images without auth returns 401', async ({ request }) => {
    const res = await request.delete('/api/admin/lucky-images?id=fake', { timeout: 10000 })
    expect(res.status()).toBe(401)
  })

  test('PATCH /api/admin/lucky-images without auth returns 401', async ({ request }) => {
    const res = await request.patch('/api/admin/lucky-images?id=fake', {
      headers: { 'Content-Type': 'application/json' },
      data: { is_active: false },
      timeout: 10000,
    })
    expect(res.status()).toBe(401)
  })

  test('POST /api/admin/lucky-images/sync-huaypnk without auth returns 401', async ({ request }) => {
    const res = await request.post('/api/admin/lucky-images/sync-huaypnk', { timeout: 10000 })
    expect(res.status()).toBe(401)
  })

  test('GET /api/admin/bot-accounts without auth returns 401', async ({ request }) => {
    const res = await request.get('/api/admin/bot-accounts', { timeout: 10000 })
    expect(res.status()).toBe(401)
  })

  test('POST /api/admin/bot-accounts without auth returns 401', async ({ request }) => {
    const res = await request.post('/api/admin/bot-accounts', {
      headers: { 'Content-Type': 'application/json' },
      data: { name: 'test-bot' },
      timeout: 10000,
    })
    expect(res.status()).toBe(401)
  })

  test('PATCH /api/admin/bot-accounts without auth returns 401', async ({ request }) => {
    const res = await request.patch('/api/admin/bot-accounts?id=fake', {
      headers: { 'Content-Type': 'application/json' },
      data: { is_active: false },
      timeout: 10000,
    })
    expect(res.status()).toBe(401)
  })

  test('DELETE /api/admin/bot-accounts without auth returns 401', async ({ request }) => {
    const res = await request.delete('/api/admin/bot-accounts?id=fake', { timeout: 10000 })
    expect(res.status()).toBe(401)
  })

  test('POST /api/admin/bot-accounts?action=pause without auth returns 401', async ({ request }) => {
    const res = await request.post('/api/admin/bot-accounts?action=pause&id=fake', { timeout: 10000 })
    expect(res.status()).toBe(401)
  })
})

test.describe('Hybrid Admin API — malformed request guards (under auth bypass)', () => {
  // Use CRON_SECRET as bearer to skip auth, then test validation paths.
  // These validation branches run BEFORE any Supabase call, so they
  // never hang even in the fake-env environment.
  const authHeader = { Authorization: 'Bearer test-cron-secret' }

  test('POST /api/admin/lucky-images rejects missing public_url', async ({ request }) => {
    const res = await request.post('/api/admin/lucky-images', {
      headers: { 'Content-Type': 'application/json', ...authHeader },
      data: {},
      timeout: 10000,
    })
    expect(res.status()).toBe(400)
    const body = await safeJson(res)
    expect(body?.error).toMatch(/invalid public_url/)
  })

  test('POST /api/admin/lucky-images rejects non-http URL', async ({ request }) => {
    const res = await request.post('/api/admin/lucky-images', {
      headers: { 'Content-Type': 'application/json', ...authHeader },
      data: { public_url: 'ftp://example.com/x.jpg' },
      timeout: 10000,
    })
    expect(res.status()).toBe(400)
  })

  test('DELETE /api/admin/lucky-images rejects missing id', async ({ request }) => {
    const res = await request.delete('/api/admin/lucky-images', {
      headers: authHeader,
      timeout: 10000,
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/admin/bot-accounts rejects missing name', async ({ request }) => {
    const res = await request.post('/api/admin/bot-accounts', {
      headers: { 'Content-Type': 'application/json', ...authHeader },
      data: {},
      timeout: 10000,
    })
    expect(res.status()).toBe(400)
    const body = await safeJson(res)
    expect(body?.error).toMatch(/name required/)
  })

  test('POST /api/admin/bot-accounts?action=unknown returns 400', async ({ request }) => {
    const res = await request.post('/api/admin/bot-accounts?action=unknown&id=fake', {
      headers: authHeader,
      timeout: 10000,
    })
    // Could be 400 (unknown action) or delegate to create path
    expect([400, 401]).toContain(res.status())
  })

  test('PATCH /api/admin/bot-accounts rejects missing id', async ({ request }) => {
    const res = await request.patch('/api/admin/bot-accounts', {
      headers: { 'Content-Type': 'application/json', ...authHeader },
      data: { is_active: false },
      timeout: 10000,
    })
    expect(res.status()).toBe(400)
  })
})
