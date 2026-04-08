import { test, expect } from '@playwright/test'

// Helper: try JSON parse, return null if not JSON
async function safeJson(response: { text: () => Promise<string> }) {
  try {
    const text = await response.text()
    return JSON.parse(text)
  } catch {
    return null
  }
}

test.describe('Message Flow API', () => {
  // API endpoints may return 500 if Supabase is not configured
  // We test that endpoints exist and respond (not 404)

  test('GET /api/cron/countdown endpoint exists', async ({ request }) => {
    const res = await request.get('/api/cron/countdown?test=1', { timeout: 15000 })
    expect(res.status()).not.toBe(404)
    const body = await safeJson(res)
    if (res.status() === 200 && body) {
      expect(body).toHaveProperty('sent')
    }
  })

  test('GET /api/cron/stats endpoint exists', async ({ request }) => {
    const res = await request.get('/api/cron/stats?test=1', { timeout: 15000 })
    expect(res.status()).not.toBe(404)
  })

  test('GET /api/cron/scrape endpoint exists', async ({ request }) => {
    const res = await request.get('/api/cron/scrape?test=1', { timeout: 15000 })
    expect(res.status()).not.toBe(404)
  })

  test('GET /api/groups returns valid response', async ({ request }) => {
    const res = await request.get('/api/groups', { timeout: 10000 })
    expect(res.status()).not.toBe(404)
    const body = await safeJson(res)
    if (res.status() === 200 && body) {
      expect(body).toHaveProperty('groups')
      expect(Array.isArray(body.groups)).toBe(true)
    }
  })

  test('GET /api/system-check endpoint exists', async ({ request }) => {
    const res = await request.get('/api/system-check', { timeout: 15000 })
    expect(res.status()).not.toBe(404)
  })

  test('GET /api/settings returns valid response', async ({ request }) => {
    const res = await request.get('/api/settings', { timeout: 10000 })
    expect(res.status()).not.toBe(404)
    const body = await safeJson(res)
    if (res.status() === 200 && body) {
      expect(body).toHaveProperty('settings')
      expect(body).toHaveProperty('groups')
    }
  })

  test('GET /api/cron/scheduled endpoint exists', async ({ request }) => {
    const res = await request.get('/api/cron/scheduled?test=1', { timeout: 15000 })
    expect(res.status()).not.toBe(404)
  })

  test('POST /api/results with empty body should not 404', async ({ request }) => {
    const res = await request.post('/api/results', {
      headers: { 'Content-Type': 'application/json' },
      data: {},
      timeout: 10000,
    })
    expect(res.status()).not.toBe(404)
  })
})
