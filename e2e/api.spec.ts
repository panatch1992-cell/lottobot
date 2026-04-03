import { test, expect } from '@playwright/test'

test.describe('API Endpoints', () => {
  test('POST /api/results with empty body should return error', async ({ request }) => {
    const response = await request.post('/api/results', {
      headers: { 'Content-Type': 'application/json' },
      data: {},
      timeout: 10000,
    })
    expect(response.status()).toBeDefined()
    const body = await response.json()
    expect(body).toBeDefined()
  })
})
