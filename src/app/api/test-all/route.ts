import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, getSettings } from '@/lib/supabase'
import { sendToTelegram } from '@/lib/telegram'
import { pushTextMessage, verifyChannelToken, checkLineQuota, flagMonthlyLimitHit } from '@/lib/line-messaging'
import { formatResult, formatCountdown, formatStats } from '@/lib/formatter'
import { today } from '@/lib/utils'
import type { Lottery, LineGroup, Result } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface TestResult {
  id: string
  name: string
  status: 'pass' | 'fail' | 'skip'
  detail?: string
  duration_ms?: number
}

// Helper: run a test with timing
async function runTest(id: string, name: string, fn: () => Promise<{ pass: boolean; detail?: string }>): Promise<TestResult> {
  const start = Date.now()
  try {
    const result = await fn()
    return {
      id, name,
      status: result.pass ? 'pass' : 'fail',
      detail: result.detail,
      duration_ms: Date.now() - start,
    }
  } catch (err) {
    return {
      id, name,
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - start,
    }
  }
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  const sendReal = req.nextUrl.searchParams.get('send') === '1'
  const resetLimit = req.nextUrl.searchParams.get('reset_limit') === '1'

  // Basic auth to prevent accidental triggers
  if (secret !== process.env.CRON_SECRET && process.env.NODE_ENV === 'production') {
    return NextResponse.json({
      error: 'ใส่ ?secret=YOUR_CRON_SECRET เพื่อรันทดสอบ',
      hint: 'เพิ่ม &send=1 เพื่อส่งข้อความจริงไป LINE/TG | &reset_limit=1 เพื่อรีเซ็ต monthly limit flag',
    }, { status: 401 })
  }

  const db = getServiceClient()
  const settings = await getSettings()
  const todayStr = today()
  const results: TestResult[] = []

  // Reset monthly limit flag if requested
  if (resetLimit) {
    await db.from('bot_settings').delete().eq('key', 'line_monthly_limit_month')
    results.push({ id: '0.1', name: 'รีเซ็ต monthly limit flag', status: 'pass', detail: 'ลบ flag แล้ว — ระบบจะเช็ค quota จริงจาก LINE API ใหม่' })
  }

  // ═══════════════════════════════════════════
  // 1. DATABASE CONNECTION
  // ═══════════════════════════════════════════

  let lotteries: Lottery[] = []
  results.push(await runTest('1.1', 'DB: เชื่อมต่อ Supabase', async () => {
    const { data, error } = await db.from('lotteries').select('*').order('sort_order')
    if (error) return { pass: false, detail: error.message }
    lotteries = (data || []) as Lottery[]
    return { pass: true, detail: `พบ ${lotteries.length} หวย` }
  }))

  results.push(await runTest('1.2', 'DB: อ่าน bot_settings', async () => {
    const keys = Object.keys(settings)
    return { pass: keys.length > 0, detail: `พบ ${keys.length} settings` }
  }))

  let groups: LineGroup[] = []
  results.push(await runTest('1.3', 'DB: อ่าน line_groups', async () => {
    const { data, error } = await db.from('line_groups').select('*')
    if (error) return { pass: false, detail: error.message }
    groups = (data || []) as LineGroup[]
    const active = groups.filter(g => g.is_active)
    return { pass: true, detail: `พบ ${groups.length} กลุ่ม (active: ${active.length})` }
  }))

  results.push(await runTest('1.4', 'DB: อ่าน results วันนี้', async () => {
    const { data, error } = await db.from('results').select('id, lottery_id').eq('draw_date', todayStr)
    if (error) return { pass: false, detail: error.message }
    return { pass: true, detail: `พบ ${(data || []).length} ผลวันนี้` }
  }))

  results.push(await runTest('1.5', 'DB: อ่าน send_logs วันนี้', async () => {
    const { data, error } = await db.from('send_logs').select('id, channel, status, line_group_id').gte('created_at', todayStr)
    if (error) return { pass: false, detail: error.message }
    const tgSent = (data || []).filter(l => l.channel === 'telegram' && l.status === 'sent').length
    const lineSent = (data || []).filter(l => l.channel === 'line' && l.status === 'sent').length
    const failed = (data || []).filter(l => l.status === 'failed').length
    return { pass: true, detail: `TG: ${tgSent} sent, LINE: ${lineSent} sent, failed: ${failed}` }
  }))

  results.push(await runTest('1.6', 'DB: อ่าน scrape_sources', async () => {
    const { data, error } = await db.from('scrape_sources').select('id, lottery_id, is_active')
    if (error) return { pass: false, detail: error.message }
    const active = (data || []).filter(s => s.is_active).length
    return { pass: true, detail: `พบ ${(data || []).length} sources (active: ${active})` }
  }))

  // ═══════════════════════════════════════════
  // 2. LOTTERIES
  // ═══════════════════════════════════════════

  results.push(await runTest('2.1', 'หวย: มีข้อมูล 43 รายการ', async () => {
    return { pass: lotteries.length >= 43, detail: `มี ${lotteries.length} รายการ` }
  }))

  results.push(await runTest('2.2', 'หวย: มี active อย่างน้อย 1', async () => {
    const active = lotteries.filter(l => l.status === 'active')
    return { pass: active.length > 0, detail: `active: ${active.length}` }
  }))

  results.push(await runTest('2.3', 'หวย: ข้อมูลครบ (name, flag, result_time)', async () => {
    const invalid = lotteries.filter(l => !l.name || !l.flag || !l.result_time)
    return { pass: invalid.length === 0, detail: invalid.length > 0 ? `ไม่ครบ: ${invalid.map(l => l.name).join(', ')}` : 'ครบทุกรายการ' }
  }))

  // ═══════════════════════════════════════════
  // 3. LINE GROUPS (PER-GROUP STATUS)
  // ═══════════════════════════════════════════

  results.push(await runTest('3.1', 'กลุ่ม LINE: มีอย่างน้อย 1 กลุ่ม active', async () => {
    const active = groups.filter(g => g.is_active)
    return {
      pass: active.length > 0,
      detail: groups.map(g => `${g.name} (${g.id.slice(-8)}) — ${g.is_active ? '✅ active' : '⬜ inactive'}`).join(', '),
    }
  }))

  results.push(await runTest('3.2', 'กลุ่ม LINE: active groups มี line_group_id', async () => {
    const active = groups.filter(g => g.is_active)
    const hasId = active.filter(g => g.line_group_id)
    return { pass: hasId.length === active.length, detail: `${hasId.length}/${active.length} มี line_group_id` }
  }))

  // Per-group send_logs check
  results.push(await runTest('3.3', 'Per-Group: send_logs แยกรายกลุ่ม', async () => {
    const { data } = await db.from('send_logs')
      .select('line_group_id, status, error_message')
      .eq('channel', 'line')
      .gte('created_at', todayStr)
    if (!data || data.length === 0) return { pass: true, detail: 'ยังไม่มี LINE logs วันนี้' }

    const byGroup = new Map<string, { sent: number; failed: number; limitHit: boolean }>()
    for (const log of data) {
      const gid = log.line_group_id || 'unknown'
      if (!byGroup.has(gid)) byGroup.set(gid, { sent: 0, failed: 0, limitHit: false })
      const g = byGroup.get(gid)!
      if (log.status === 'sent') g.sent++
      if (log.status === 'failed') g.failed++
      if (log.error_message?.includes('monthly limit')) g.limitHit = true
    }

    const details = Array.from(byGroup.entries()).map(([gid, s]) => {
      const groupName = groups.find(g => g.id === gid)?.name || gid.slice(-8)
      return `${groupName}: sent=${s.sent} failed=${s.failed}${s.limitHit ? ' ⚠️LIMIT' : ''}`
    })
    return { pass: true, detail: details.join(' | ') }
  }))

  // ═══════════════════════════════════════════
  // 4. TELEGRAM
  // ═══════════════════════════════════════════

  results.push(await runTest('4.1', 'TG: Bot Token ตั้งค่าแล้ว', async () => {
    return { pass: !!settings.telegram_bot_token, detail: settings.telegram_bot_token ? `...${settings.telegram_bot_token.slice(-6)}` : 'ไม่มี' }
  }))

  results.push(await runTest('4.2', 'TG: Admin Channel ID ตั้งค่าแล้ว', async () => {
    return { pass: !!settings.telegram_admin_channel, detail: settings.telegram_admin_channel || 'ไม่มี' }
  }))

  if (sendReal) {
    results.push(await runTest('4.3', 'TG: ส่งข้อความทดสอบจริง', async () => {
      const msg = '🔧 <b>[ทดสอบระบบ]</b>\ntest-all route — กรุณาอย่าสนใจข้อความนี้'
      const r = await sendToTelegram(settings.telegram_bot_token, settings.telegram_admin_channel, msg)
      return { pass: r.success, detail: r.error || 'ส่งสำเร็จ' }
    }))
  }

  // ═══════════════════════════════════════════
  // 5. LINE MESSAGING API
  // ═══════════════════════════════════════════

  results.push(await runTest('5.0', 'LINE: Quota + Daily Budget', async () => {
    const quota = await checkLineQuota()
    return {
      pass: quota.canSend,
      detail: [
        `เดือน: ${quota.used}/${quota.quota} (เหลือ ${quota.remaining})`,
        `วันนี้: ${quota.todaySent}/${quota.dailyBudget} (budget/วัน)`,
        `เหลือ ${quota.daysLeft} วัน`,
        `(${quota.source})`,
        quota.canSend ? '✅ ส่งได้' : `❌ ${quota.reason}`,
      ].join(' | '),
    }
  }))

  results.push(await runTest('5.1', 'LINE: Channel Access Token ตั้งค่าแล้ว', async () => {
    return { pass: !!settings.line_channel_access_token, detail: settings.line_channel_access_token ? `...${settings.line_channel_access_token.slice(-6)}` : 'ไม่มี' }
  }))

  results.push(await runTest('5.2', 'LINE: Token ใช้งานได้ (verify)', async () => {
    if (!settings.line_channel_access_token) return { pass: false, detail: 'ไม่มี token' }
    const r = await verifyChannelToken(settings.line_channel_access_token)
    return { pass: r.valid, detail: r.valid ? 'Token valid' : (r.error || 'invalid') }
  }))

  if (sendReal) {
    const quota = await checkLineQuota()
    if (!quota.canSend) {
      results.push({ id: '5.3', name: 'LINE: ส่งข้อความจริง', status: 'skip', detail: `Quota หมด: ${quota.reason}` })
    } else {
      const activeGroups = groups.filter(g => g.is_active && g.line_group_id)
      for (const group of activeGroups) {
        results.push(await runTest(`5.3-${group.id.slice(-6)}`, `LINE: ส่งข้อความจริงไปกลุ่ม "${group.name}"`, async () => {
          const msg = `🔧 ทดสอบระบบ LottoBot\nกลุ่ม: ${group.name}\nเวลา: ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}\n\n✅ กลุ่มนี้รับข้อความได้ปกติ`
          const r = await pushTextMessage(settings.line_channel_access_token, group.line_group_id!, msg)
          if (!r.success && r.error?.includes('monthly limit')) {
            await flagMonthlyLimitHit()
          }
          return { pass: r.success, detail: r.error || `ส่งสำเร็จ → ${group.name}` }
        }))
      }
    }
  }

  // ═══════════════════════════════════════════
  // 6. FORMATTER
  // ═══════════════════════════════════════════

  results.push(await runTest('6.1', 'Formatter: formatResult ทำงานถูกต้อง', async () => {
    const testLottery = lotteries[0] || { name: 'ทดสอบ', flag: '🎰' } as Lottery
    const testResult = { top_number: '123', bottom_number: '45', draw_date: todayStr } as Result
    const f = formatResult(testLottery, testResult)
    return {
      pass: !!f.tg && !!f.line && f.line.includes('1 2 3'),
      detail: `TG: ${f.tg.length} chars, LINE: ${f.line.length} chars`,
    }
  }))

  results.push(await runTest('6.2', 'Formatter: formatCountdown ทำงานถูกต้อง', async () => {
    const testLottery = lotteries[0] || { name: 'ทดสอบ', flag: '🎰' } as Lottery
    const f = formatCountdown(testLottery, 5)
    return {
      pass: !!f.tg && !!f.line && f.line.includes('5'),
      detail: `LINE: ${f.line.substring(0, 50)}...`,
    }
  }))

  results.push(await runTest('6.3', 'Formatter: formatStats ทำงานถูกต้อง', async () => {
    const testLottery = lotteries[0] || { name: 'ทดสอบ', flag: '🎰' } as Lottery
    const testResults = [
      { top_number: '123', bottom_number: '45', draw_date: '2026-04-01' },
      { top_number: '678', bottom_number: '90', draw_date: '2026-03-31' },
    ] as Result[]
    const f = formatStats(testLottery, testResults)
    return {
      pass: !!f.tg && !!f.line,
      detail: `LINE: ${f.line.substring(0, 50)}...`,
    }
  }))

  // ═══════════════════════════════════════════
  // 7. IMAGE GENERATION
  // ═══════════════════════════════════════════

  results.push(await runTest('7.1', 'Image: generate-image endpoint ตอบกลับ', async () => {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || `https://${process.env.VERCEL_URL}` || 'https://lottobot-chi.vercel.app'
    const params = new URLSearchParams({
      lottery_name: 'ทดสอบ', flag: '🎰', date: '3 เม.ย. 69',
      top_number: '123', bottom_number: '45', theme: 'shopee',
    })
    const url = `${baseUrl}/api/generate-image?${params}`
    const res = await fetch(url)
    return {
      pass: res.status === 200,
      detail: `status=${res.status}, content-type=${res.headers.get('content-type')}`,
    }
  }))

  // ═══════════════════════════════════════════
  // 8. SEND REAL RESULT (ส่งผลจริง)
  // ═══════════════════════════════════════════

  if (sendReal) {
    results.push(await runTest('8.1', 'ส่งผลจริง: กรอกผลมือ + ส่ง TG + LINE', async () => {
      const testLottery = lotteries.find(l => l.status === 'active')
      if (!testLottery) return { pass: false, detail: 'ไม่มีหวย active' }

      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || `https://${process.env.VERCEL_URL}` || 'https://lottobot-chi.vercel.app'
      const res = await fetch(`${baseUrl}/api/results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lottery_id: testLottery.id,
          top_number: '999',
          bottom_number: '99',
          theme: 'shopee',
        }),
      })
      const data = await res.json()
      return {
        pass: data.success === true,
        detail: data.summary || data.error || JSON.stringify(data).substring(0, 200),
      }
    }))

    // Verify per-group logs
    results.push(await runTest('8.2', 'Per-Group: ตรวจ send_logs หลังส่งผล', async () => {
      // Wait a moment for logs to be written
      await new Promise(r => setTimeout(r, 2000))
      const { data } = await db.from('send_logs')
        .select('channel, line_group_id, status, error_message')
        .gte('created_at', todayStr)
        .order('created_at', { ascending: false })
        .limit(20)

      const lineLogsByGroup = new Map<string, string>()
      for (const log of (data || []).filter(l => l.channel === 'line')) {
        const gid = log.line_group_id || 'unknown'
        const groupName = groups.find(g => g.id === gid)?.name || gid.slice(-8)
        lineLogsByGroup.set(groupName, log.status + (log.error_message ? ` (${log.error_message.substring(0, 50)})` : ''))
      }

      const details = Array.from(lineLogsByGroup.entries()).map(([name, status]) => `${name}: ${status}`)
      const allSent = Array.from(lineLogsByGroup.values()).some(s => s.startsWith('sent'))
      return {
        pass: allSent,
        detail: details.length > 0 ? details.join(' | ') : 'ไม่พบ LINE logs',
      }
    }))
  }

  // ═══════════════════════════════════════════
  // 9. CRON ENDPOINTS
  // ═══════════════════════════════════════════

  results.push(await runTest('9.1', 'Cron: /api/cron/scrape?test=1 ตอบกลับ', async () => {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || `https://${process.env.VERCEL_URL}` || 'https://lottobot-chi.vercel.app'
    const res = await fetch(`${baseUrl}/api/cron/scrape?test=1`)
    const data = await res.json()
    return { pass: res.status === 200, detail: `fetched=${data.fetched}, in_window=${data.total_in_window}` }
  }))

  results.push(await runTest('9.2', 'Cron: /api/cron/countdown?test=1 ตอบกลับ', async () => {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || `https://${process.env.VERCEL_URL}` || 'https://lottobot-chi.vercel.app'
    const res = await fetch(`${baseUrl}/api/cron/countdown?test=1`)
    const data = await res.json()
    return { pass: res.status === 200, detail: `sent=${data.sent}` }
  }))

  results.push(await runTest('9.3', 'Cron: /api/cron/stats?test=1 ตอบกลับ', async () => {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || `https://${process.env.VERCEL_URL}` || 'https://lottobot-chi.vercel.app'
    const res = await fetch(`${baseUrl}/api/cron/stats?test=1`)
    const data = await res.json()
    return { pass: res.status === 200, detail: `sent=${data.sent}` }
  }))

  // ═══════════════════════════════════════════
  // 10. GROUP-LOTTERY MAPPING
  // ═══════════════════════════════════════════

  results.push(await runTest('10.1', 'Group-Lottery: อ่าน group_lotteries', async () => {
    const { data, error } = await db.from('group_lotteries').select('group_id, lottery_id')
    if (error) return { pass: false, detail: error.message }
    return { pass: true, detail: `${(data || []).length} mappings` }
  }))

  // ═══════════════════════════════════════════
  // 11. SCHEDULED MESSAGES
  // ═══════════════════════════════════════════

  results.push(await runTest('11.1', 'Scheduled: อ่าน scheduled_messages', async () => {
    const { data, error } = await db.from('scheduled_messages').select('id, message, send_time, is_active')
    if (error) return { pass: false, detail: error.message }
    const active = (data || []).filter((m: { is_active: boolean }) => m.is_active).length
    return { pass: true, detail: `${(data || []).length} messages (active: ${active})` }
  }))

  // ═══════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════

  const passed = results.filter(r => r.status === 'pass').length
  const failed = results.filter(r => r.status === 'fail').length
  const skipped = results.filter(r => r.status === 'skip').length

  return NextResponse.json({
    summary: {
      total: results.length,
      passed,
      failed,
      skipped,
      all_pass: failed === 0,
      send_mode: sendReal ? '🔴 LIVE — ส่งข้อความจริง' : '🟢 DRY RUN — ไม่ส่งข้อความ',
    },
    results,
    timestamp: new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
    hint: !sendReal ? 'เพิ่ม &send=1 เพื่อทดสอบส่งข้อความจริงไป LINE + TG' : undefined,
  })
}
