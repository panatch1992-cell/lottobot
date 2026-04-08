import { NextResponse } from 'next/server'
import { getServiceClient, getSettings } from '@/lib/supabase'
import { checkUnofficialHealth } from '@/lib/messaging-service'
import { sendToTelegram } from '@/lib/telegram'
import { validateLineGroups } from '@/lib/config-guard'

export const dynamic = 'force-dynamic'

/**
 * GET /api/smoke-test
 *
 * Integration smoke test — ตรวจสอบทุกระบบจริง:
 * 1. Supabase DB เชื่อมต่อได้
 * 2. LINE groups มี unofficial_group_id
 * 3. Unofficial endpoint ทำงาน + token ยังใช้ได้
 * 4. Telegram Bot ส่งได้
 * 5. Scrape sources ตั้งค่าแล้ว
 *
 * ใช้หลัง deploy หรือหลังเปลี่ยน token
 */
export async function GET() {
  const results: { check: string; status: 'pass' | 'fail' | 'warn'; detail: string }[] = []

  // ─── 1. Supabase DB ────────────────────────────────────
  try {
    const db = getServiceClient()
    const { count, error } = await db.from('lotteries').select('*', { count: 'exact', head: true })
    if (error) throw error
    results.push({ check: 'Supabase DB', status: 'pass', detail: `เชื่อมต่อได้ (${count} หวย)` })
  } catch (err) {
    results.push({ check: 'Supabase DB', status: 'fail', detail: err instanceof Error ? err.message : 'Connection failed' })
  }

  // ─── 2. LINE Groups + unofficial_group_id ──────────────
  try {
    const db = getServiceClient()
    const { data: groups } = await db.from('line_groups').select('id, name, line_group_id, unofficial_group_id').eq('is_active', true)
    const total = groups?.length || 0
    const withUnofficial = groups?.filter(g => g.unofficial_group_id).length || 0
    const withOfficial = groups?.filter(g => g.line_group_id).length || 0

    const groupIssues = await validateLineGroups(groups || [])
    const hasGroupError = groupIssues.some(i => i.severity === 'error')

    if (total === 0) {
      results.push({ check: 'LINE Groups', status: 'fail', detail: 'ไม่มีกลุ่ม LINE ที่ active' })
    } else if (hasGroupError) {
      results.push({ check: 'LINE Groups', status: 'fail', detail: groupIssues.map(i => i.message).join('; ') })
    } else if (withUnofficial === 0) {
      results.push({ check: 'LINE Groups', status: 'warn', detail: `${total} กลุ่ม แต่ไม่มี unofficial_group_id → ต้องรัน /api/sync-groups` })
    } else {
      results.push({ check: 'LINE Groups', status: 'pass', detail: `${withUnofficial}/${total} กลุ่มมี unofficial ID, ${withOfficial} มี official ID` })
    }
  } catch (err) {
    results.push({ check: 'LINE Groups', status: 'fail', detail: err instanceof Error ? err.message : 'Query failed' })
  }

  // ─── 3. Unofficial Endpoint + Token ────────────────────
  try {
    const health = await checkUnofficialHealth()
    if (!health.ok) {
      results.push({ check: 'Unofficial Endpoint', status: 'fail', detail: health.error || 'Endpoint down' })
    } else {
      const tokenInfo = health.hasAuthToken ? 'token ✓' : 'token ✗'
      results.push({ check: 'Unofficial Endpoint', status: health.hasAuthToken ? 'pass' : 'warn', detail: `${health.latencyMs}ms, ${tokenInfo}` })
    }
  } catch (err) {
    results.push({ check: 'Unofficial Endpoint', status: 'fail', detail: err instanceof Error ? err.message : 'Health check failed' })
  }

  // ─── 4. Telegram Bot ──────────────────────────────────
  try {
    const settings = await getSettings()
    if (!settings.telegram_bot_token || !settings.telegram_admin_channel) {
      results.push({ check: 'Telegram Bot', status: 'warn', detail: 'Token หรือ Channel ID ไม่ได้ตั้ง' })
    } else {
      const tgResult = await sendToTelegram(
        settings.telegram_bot_token,
        settings.telegram_admin_channel,
        '🧪 <b>Smoke Test</b> — ระบบทำงานปกติ'
      )
      results.push({
        check: 'Telegram Bot',
        status: tgResult.success ? 'pass' : 'fail',
        detail: tgResult.success ? 'ส่งข้อความทดสอบสำเร็จ' : `ส่งไม่ได้: ${tgResult.error}`,
      })
    }
  } catch (err) {
    results.push({ check: 'Telegram Bot', status: 'fail', detail: err instanceof Error ? err.message : 'Send failed' })
  }

  // ─── 5. Scrape Sources ────────────────────────────────
  try {
    const db = getServiceClient()
    const { count } = await db.from('scrape_sources').select('*', { count: 'exact', head: true }).eq('is_active', true)
    if (!count || count === 0) {
      results.push({ check: 'Scrape Sources', status: 'warn', detail: 'ยังไม่มี scrape source ที่ active' })
    } else {
      results.push({ check: 'Scrape Sources', status: 'pass', detail: `${count} sources active` })
    }
  } catch (err) {
    results.push({ check: 'Scrape Sources', status: 'fail', detail: err instanceof Error ? err.message : 'Query failed' })
  }

  // ─── Summary ──────────────────────────────────────────
  const passed = results.filter(r => r.status === 'pass').length
  const failed = results.filter(r => r.status === 'fail').length
  const warned = results.filter(r => r.status === 'warn').length

  return NextResponse.json({
    overall: failed > 0 ? 'FAIL' : warned > 0 ? 'WARN' : 'PASS',
    summary: `${passed} pass, ${failed} fail, ${warned} warn`,
    checks: results,
    timestamp: new Date().toISOString(),
  })
}
