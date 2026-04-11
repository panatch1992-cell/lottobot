/**
 * E2E Test Endpoint
 *
 * Runs a comprehensive end-to-end test of the entire system:
 * 1. Check DB connectivity
 * 2. Check settings are configured
 * 3. Check VPS /health (client ready?)
 * 4. Check LINE groups are active
 * 5. Check Telegram bot
 * 6. (Optional) Send test trigger
 *
 * Usage:
 *   GET /api/e2e-test          — read-only tests
 *   GET /api/e2e-test?send=1   — also sends real trigger
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type TestResult = {
  name: string
  status: 'pass' | 'fail' | 'warn' | 'skip'
  detail: string
  durationMs?: number
}

async function runTest(name: string, fn: () => Promise<{ status: TestResult['status']; detail: string }>): Promise<TestResult> {
  const start = Date.now()
  try {
    const result = await fn()
    return { name, ...result, durationMs: Date.now() - start }
  } catch (err) {
    return {
      name,
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sendReal = url.searchParams.get('send') === '1'
  const tests: TestResult[] = []

  // Helper: read settings directly from Supabase client (bypass getSettings REST API bug)
  async function getSettingsMap(): Promise<Record<string, string>> {
    const db = getServiceClient()
    const { data } = await db.from('bot_settings').select('key, value')
    const map: Record<string, string> = {}
    ;(data || []).forEach((s: { key: string; value: string }) => {
      if (s.key && s.value) map[s.key] = s.value
    })
    return map
  }

  // ─── Test 1: Database connectivity ──────────────
  tests.push(await runTest('DB Connection', async () => {
    const db = getServiceClient()
    const { data, error } = await db.from('bot_settings').select('key').limit(1)
    if (error) return { status: 'fail', detail: `Supabase error: ${error.message}` }
    return { status: 'pass', detail: `Connected, fetched ${data?.length || 0} rows` }
  }))

  // ─── Test 2: Settings are configured ────────────
  tests.push(await runTest('Settings configured', async () => {
    const settings = await getSettingsMap()
    const required = {
      unofficial_line_endpoint: settings.unofficial_line_endpoint,
      unofficial_line_token: settings.unofficial_line_token,
      line_channel_access_token: settings.line_channel_access_token,
      line_channel_secret: settings.line_channel_secret,
      telegram_bot_token: settings.telegram_bot_token,
      telegram_admin_channel: settings.telegram_admin_channel,
      line_send_mode: settings.line_send_mode,
    }
    const missing = Object.entries(required).filter(([, v]) => !v || v.startsWith('YOUR_')).map(([k]) => k)
    if (missing.length > 0) {
      return { status: 'fail', detail: `Missing/placeholder: ${missing.join(', ')}` }
    }
    return { status: 'pass', detail: `All ${Object.keys(required).length} required settings present. mode=${settings.line_send_mode}` }
  }))

  // ─── Test 3: VPS health ─────────────────────────
  tests.push(await runTest('VPS /health', async () => {
    const settings = await getSettingsMap()
    const endpoint = (settings.unofficial_line_endpoint || '').replace(/\/+$/, '')
    if (!endpoint) return { status: 'fail', detail: 'No endpoint configured' }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(`${endpoint}/health`, { signal: controller.signal })
    clearTimeout(timer)

    if (!res.ok) return { status: 'fail', detail: `HTTP ${res.status}` }

    const data = await res.json()
    if (!data.ok) return { status: 'fail', detail: 'Health returned ok=false' }

    const issues: string[] = []
    if (!data.clientReady) issues.push('clientReady=false')
    if (!data.hasUnofficialToken) issues.push('no LINE_AUTH_TOKEN')
    if (data.antiBan?.circuitBreaker?.isOpen) issues.push('circuit breaker OPEN')

    if (issues.length > 0) {
      return { status: 'warn', detail: `Service running but: ${issues.join(', ')}` }
    }

    const todaySent = data.antiBan?.counters?.day?.sent || 0
    const dayLimit = data.antiBan?.counters?.day?.limit || '?'
    return {
      status: 'pass',
      detail: `Runtime: ${data.runtime}, clientReady=${data.clientReady}, today: ${todaySent}/${dayLimit}`,
    }
  }))

  // ─── Test 4: LINE groups ────────────────────────
  tests.push(await runTest('LINE groups', async () => {
    const db = getServiceClient()
    const { data: groups } = await db.from('line_groups').select('*').eq('is_active', true)
    if (!groups || groups.length === 0) {
      return { status: 'fail', detail: 'No active LINE groups' }
    }
    const withUnofficial = groups.filter(g => g.unofficial_group_id).length
    const withOfficial = groups.filter(g => g.line_group_id).length
    return {
      status: withUnofficial > 0 ? 'pass' : 'warn',
      detail: `${groups.length} active groups (${withUnofficial} with unofficial MID, ${withOfficial} with official ID)`,
    }
  }))

  // ─── Test 5: Telegram bot ───────────────────────
  tests.push(await runTest('Telegram bot', async () => {
    const settings = await getSettingsMap()
    const token = settings.telegram_bot_token
    if (!token) return { status: 'skip', detail: 'No token' }

    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(5000) })
    const data = await res.json()
    if (!data.ok) return { status: 'fail', detail: `Telegram API: ${data.description}` }
    return { status: 'pass', detail: `@${data.result.username} (${data.result.first_name})` }
  }))

  // ─── Test 6: Recent lottery results ─────────────
  tests.push(await runTest('Recent results', async () => {
    const db = getServiceClient()
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
    const { data: results } = await db.from('results')
      .select('id, lottery_id, draw_date, scraped_at')
      .eq('draw_date', todayStr)
      .order('scraped_at', { ascending: false })
    const count = results?.length || 0
    return {
      status: count > 0 ? 'pass' : 'warn',
      detail: `${count} lottery results today`,
    }
  }))

  // ─── Test 7: Recent send logs ───────────────────
  tests.push(await runTest('Recent send logs (1h)', async () => {
    const db = getServiceClient()
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString()
    const { data: logs } = await db.from('send_logs')
      .select('status, channel, msg_type')
      .gte('created_at', oneHourAgo)
    const total = logs?.length || 0
    const sent = logs?.filter(l => l.status === 'sent').length || 0
    const failed = logs?.filter(l => l.status === 'failed').length || 0
    const successRate = total > 0 ? Math.round((sent / total) * 100) : 0

    let status: TestResult['status'] = 'pass'
    if (total === 0) status = 'warn'
    else if (successRate < 50) status = 'fail'
    else if (successRate < 90) status = 'warn'

    return {
      status,
      detail: `${total} total, ${sent} sent, ${failed} failed (${successRate}% success)`,
    }
  }))

  // ─── Test 8: Scrape cron recent run ─────────────
  tests.push(await runTest('Scrape cron recent run', async () => {
    const db = getServiceClient()
    const fiveMinAgo = new Date(Date.now() - 300000).toISOString()
    const { data: logs } = await db.from('send_logs')
      .select('created_at')
      .gte('created_at', fiveMinAgo)
      .limit(1)
    if (!logs || logs.length === 0) {
      return { status: 'warn', detail: 'No send_logs in last 5 min (cron may be idle)' }
    }
    return { status: 'pass', detail: `Last send: ${logs[0].created_at}` }
  }))

  // ─── Test 9: Send real trigger (if ?send=1) ─────
  if (sendReal) {
    tests.push(await runTest('Real trigger test (sent=1)', async () => {
      const url = new URL(req.url)
      const baseUrl = `${url.protocol}//${url.host}`
      const res = await fetch(`${baseUrl}/api/line/trigger?test=1`, { signal: AbortSignal.timeout(30000) })
      const data = await res.json()
      const sent = data.sent || 0
      const groups = data.groups || 0
      if (sent === 0 && groups > 0) {
        return { status: 'fail', detail: `Sent 0/${groups}. Errors: ${JSON.stringify(data.details || []).slice(0, 300)}` }
      }
      if (sent === groups && groups > 0) {
        return { status: 'pass', detail: `Sent ${sent}/${groups} (100%)` }
      }
      return { status: 'warn', detail: `Sent ${sent}/${groups} (partial success)` }
    }))
  } else {
    tests.push({ name: 'Real trigger test', status: 'skip', detail: 'Add ?send=1 to URL to run' })
  }

  // ─── Summary ────────────────────────────────────
  const summary = {
    total: tests.length,
    pass: tests.filter(t => t.status === 'pass').length,
    fail: tests.filter(t => t.status === 'fail').length,
    warn: tests.filter(t => t.status === 'warn').length,
    skip: tests.filter(t => t.status === 'skip').length,
  }

  const overall = summary.fail > 0 ? 'FAIL' : summary.warn > 0 ? 'WARN' : 'PASS'

  return NextResponse.json({
    overall,
    summary,
    tests,
    timestamp: new Date().toISOString(),
  })
}
