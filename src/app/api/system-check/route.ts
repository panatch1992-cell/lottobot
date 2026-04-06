import { NextResponse } from 'next/server'
import { getServiceClient, getSettings } from '@/lib/supabase'
import { checkUnofficialHealth } from '@/lib/messaging-service'

export const dynamic = 'force-dynamic'

type CheckItem = {
  name: string
  status: 'ok' | 'warn' | 'error'
  detail: string
}

export async function GET() {
  const checks: CheckItem[] = []
  const settings = await getSettings()
  const db = getServiceClient()

  // 1. Supabase connection
  try {
    const { count } = await db.from('lotteries').select('*', { count: 'exact', head: true })
    checks.push({ name: 'Supabase DB', status: 'ok', detail: `เชื่อมต่อสำเร็จ (${count} หวย)` })
  } catch (err) {
    checks.push({ name: 'Supabase DB', status: 'error', detail: `เชื่อมต่อไม่ได้: ${err instanceof Error ? err.message : 'unknown'}` })
  }

  // 2. Telegram Bot Token
  if (settings.telegram_bot_token) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${settings.telegram_bot_token}/getMe`)
      const data = await res.json()
      if (data.ok) {
        checks.push({ name: 'Telegram Bot', status: 'ok', detail: `@${data.result.username}` })
      } else {
        checks.push({ name: 'Telegram Bot', status: 'error', detail: `Token ไม่ถูกต้อง: ${data.description}` })
      }
    } catch {
      checks.push({ name: 'Telegram Bot', status: 'error', detail: 'เชื่อมต่อ Telegram API ไม่ได้' })
    }
  } else {
    checks.push({ name: 'Telegram Bot', status: 'warn', detail: 'ยังไม่ได้ตั้ง Bot Token' })
  }

  // 3. Telegram Channel ID
  if (settings.telegram_admin_channel) {
    if (settings.telegram_admin_channel.startsWith('-100')) {
      checks.push({ name: 'TG Channel ID', status: 'ok', detail: `••••${settings.telegram_admin_channel.slice(-4)}` })
    } else {
      checks.push({ name: 'TG Channel ID', status: 'warn', detail: `รูปแบบไม่ปกติ (ควรขึ้นต้น -100): ${settings.telegram_admin_channel.slice(0, 6)}...` })
    }
  } else {
    checks.push({ name: 'TG Channel ID', status: 'warn', detail: 'ยังไม่ได้ตั้ง Channel ID' })
  }

  // 4. Unofficial Endpoint (replaces LINE Token check)
  {
    const health = await checkUnofficialHealth()
    checks.push({
      name: 'Unofficial Endpoint',
      status: health.ok ? 'ok' : 'error',
      detail: health.ok
        ? `ออนไลน์ (${health.latencyMs}ms, LINE Token: ${health.hasLineToken ? 'มี' : 'ไม่มี'})`
        : `ออฟไลน์: ${health.error}`,
    })
  }

  // 5. LINE Groups
  try {
    const { data: groups } = await db.from('line_groups').select('id, name, line_group_id, unofficial_group_id, is_active')
    const active = (groups || []).filter((g: { is_active: boolean }) => g.is_active)
    const withUnofficial = active.filter((g: { unofficial_group_id?: string | null }) => g.unofficial_group_id)

    if (active.length === 0) {
      checks.push({ name: 'กลุ่ม LINE', status: 'warn', detail: 'ยังไม่มีกลุ่มที่เปิดใช้ — เชิญ Bot เข้ากลุ่ม' })
    } else {
      checks.push({
        name: 'กลุ่ม LINE',
        status: withUnofficial.length > 0 ? 'ok' : 'warn',
        detail: `${active.length} กลุ่มเปิดใช้ (มี Unofficial ID: ${withUnofficial.length}/${active.length})`,
      })
      if (withUnofficial.length < active.length) {
        checks.push({ name: 'Unofficial Group IDs', status: 'warn', detail: `${active.length - withUnofficial.length} กลุ่มยังไม่มี Unofficial ID (c...)` })
      }
    }
  } catch {
    checks.push({ name: 'กลุ่ม LINE', status: 'error', detail: 'ดึงข้อมูลกลุ่มไม่ได้' })
  }

  // 9. Scrape Sources
  try {
    const { count: totalSources } = await db.from('scrape_sources').select('*', { count: 'exact', head: true }).eq('is_active', true)
    const { count: withError } = await db.from('scrape_sources').select('*', { count: 'exact', head: true }).eq('is_active', true).not('last_error', 'is', null)
    if ((totalSources || 0) === 0) {
      checks.push({ name: 'Scrape Sources', status: 'warn', detail: 'ยังไม่มี scrape source ที่เปิดใช้' })
    } else if ((withError || 0) > 0) {
      checks.push({ name: 'Scrape Sources', status: 'warn', detail: `${totalSources} sources (${withError} มี error)` })
    } else {
      checks.push({ name: 'Scrape Sources', status: 'ok', detail: `${totalSources} sources พร้อมใช้` })
    }
  } catch {
    checks.push({ name: 'Scrape Sources', status: 'warn', detail: 'ตรวจสอบไม่ได้' })
  }

  // 10. Today's results
  try {
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
    const { count: todayResults } = await db.from('results').select('*', { count: 'exact', head: true }).eq('draw_date', todayStr)
    const { count: todaySent } = await db.from('send_logs').select('*', { count: 'exact', head: true }).eq('status', 'sent').gte('sent_at', `${todayStr}T00:00:00`)
    const { count: todayFailed } = await db.from('send_logs').select('*', { count: 'exact', head: true }).eq('status', 'failed').gte('sent_at', `${todayStr}T00:00:00`)
    checks.push({
      name: 'วันนี้',
      status: (todayFailed || 0) > 0 ? 'warn' : 'ok',
      detail: `ผลหวย: ${todayResults || 0} | ส่งสำเร็จ: ${todaySent || 0} | ล้มเหลว: ${todayFailed || 0}`,
    })
  } catch {
    checks.push({ name: 'วันนี้', status: 'warn', detail: 'ดึงข้อมูลวันนี้ไม่ได้' })
  }

  const errorCount = checks.filter(c => c.status === 'error').length
  const warnCount = checks.filter(c => c.status === 'warn').length

  return NextResponse.json({
    overall: errorCount > 0 ? 'error' : warnCount > 0 ? 'warn' : 'ok',
    errorCount,
    warnCount,
    checks,
    timestamp: new Date().toISOString(),
  })
}
