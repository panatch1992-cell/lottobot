import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, getSettings } from '@/lib/supabase'
import { formatStats } from '@/lib/formatter'
import { sendToTelegram } from '@/lib/telegram'
import { pushTextMessage, sendImageAndText, checkLineQuota, flagMonthlyLimitHit } from '@/lib/messaging-service'
import { sleep } from '@/lib/utils'
import { nowBangkok, today, timeToMinutes } from '@/lib/utils'
import { validateCronConfig, alertConfigIssues } from '@/lib/config-guard'
import { getRandomLuckyImageUrl } from '@/lib/huaypnk-scraper'
import type { Lottery, Result, LineGroup } from '@/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  const testMode = req.nextUrl.searchParams.get('test') === '1'
  if (!testMode && secret !== process.env.CRON_SECRET && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ─── Config Guard ──────────────────────────────────────
  const configCheck = await validateCronConfig('stats')
  if (!configCheck.ok) {
    await alertConfigIssues('stats', configCheck.issues)
    return NextResponse.json({ error: 'Config issues', issues: configCheck.issues })
  }

  const db = getServiceClient()
  const now = nowBangkok()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const todayStr = today()

  const settings = await getSettings()

  // Default ปิดส่งสถิติทาง LINE (ประหยัด quota) — เปิดได้ที่ /settings
  const sendStatsLine = settings.send_stats_line === 'true'

  const statsCount = parseInt(settings.stats_count || '10')

  // Get active lotteries that have send_stats enabled and have a result today
  const { data: lotteries } = await db.from('lotteries').select('*').eq('status', 'active').eq('send_stats', true)

  const sent = []

  for (const lottery of (lotteries || []) as Lottery[]) {
    const resultMin = timeToMinutes(lottery.result_time)

    // Send stats 2 minutes after result time
    if (nowMinutes < resultMin + 2 || nowMinutes > resultMin + 3) continue

    // Check which channels/groups already sent today
    const { data: existing } = await db.from('send_logs')
      .select('id, channel, line_group_id, status, error_message')
      .eq('lottery_id', lottery.id)
      .eq('msg_type', 'stats')
      .gte('created_at', todayStr)

    const alreadySentTG = existing?.some(e => e.channel === 'telegram' && e.status === 'sent')

    // Per-group: track which LINE groups already sent or hit limit
    const sentStatsGroupIds = new Set(
      (existing || [])
        .filter(e => e.channel === 'line' && e.status === 'sent' && e.line_group_id)
        .map(e => e.line_group_id)
    )
    const limitStatsGroupIds = new Set(
      (existing || [])
        .filter(e => e.channel === 'line' && e.error_message?.includes('monthly limit') && e.line_group_id)
        .map(e => e.line_group_id)
    )

    // Get last N results
    const { data: results } = await db.from('results')
      .select('*')
      .eq('lottery_id', lottery.id)
      .order('draw_date', { ascending: false })
      .limit(statsCount)

    if (!results || results.length === 0) continue

    const formatted = formatStats(lottery, results as Result[])

    // Send to Telegram (skip if already sent)
    if (!alreadySentTG && settings.telegram_bot_token && settings.telegram_admin_channel) {
      const result = await sendToTelegram(settings.telegram_bot_token, settings.telegram_admin_channel, formatted.tg)
      await db.from('send_logs').insert({
        lottery_id: lottery.id,
        channel: 'telegram',
        msg_type: 'stats',
        status: result.success ? 'sent' : 'failed',
        sent_at: new Date().toISOString(),
        error_message: result.error || null,
      })
    }

    // Send to LINE groups (per-group: skip only groups that already sent or hit limit)
    const lineToken = settings.line_channel_access_token
    const statsQuota = lineToken && sendStatsLine ? await checkLineQuota() : null
    if (lineToken && sendStatsLine && statsQuota?.canSend) {
      // ดึง lucky image URL จาก huaypnk.com/top ครั้งเดียวต่อหวย
      // ถ้าดึงไม่ได้ → ข้ามส่งรูปโดยไม่กระทบสถิติ
      const luckyDirectUrl = await getRandomLuckyImageUrl(lottery.name)
      const baseUrl =
        process.env.NEXT_PUBLIC_SITE_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://lottobot-chi.vercel.app')
      // ใช้ proxy route เพื่อ relay รูปจาก huaypnk.com → ป้องกัน hotlink block จาก LINE server
      const luckyProxyUrl = luckyDirectUrl
        ? `${baseUrl}/api/lucky-image?url=${encodeURIComponent(luckyDirectUrl)}`
        : null

      const { data: groups } = await db.from('line_groups').select('*').eq('is_active', true)
      for (const group of (groups || []) as LineGroup[]) {
        const unofficialId = (group as unknown as { unofficial_group_id?: string }).unofficial_group_id || ''
        const officialId = group.line_group_id || ''
        const primaryId = unofficialId || officialId
        if (!primaryId) continue
        if (sentStatsGroupIds.has(group.id)) continue
        if (limitStatsGroupIds.has(group.id)) continue

        // 1) ส่งข้อความสถิติ
        const lineResult = await pushTextMessage(lineToken, primaryId, formatted.line, officialId)
        if (!lineResult.success && lineResult.error?.includes('monthly limit')) {
          await flagMonthlyLimitHit()
        }
        await db.from('send_logs').insert({
          lottery_id: lottery.id,
          line_group_id: group.id,
          channel: 'line',
          msg_type: 'stats',
          status: lineResult.success ? 'sent' : 'failed',
          sent_at: new Date().toISOString(),
          error_message: lineResult.error || null,
        })

        // 2) ส่งรูปเลขเด็ดจาก huaypnk.com (ถ้ามี) ตามหลังสถิติ
        if (lineResult.success && luckyProxyUrl) {
          await sleep(1500 + Math.floor(Math.random() * 1000))
          await sendImageAndText(primaryId, luckyProxyUrl, '', officialId)
        }

        // Short delay ระหว่างกลุ่ม
        await sleep(500 + Math.floor(Math.random() * 1000))
      }
    }

    sent.push(lottery.name)
  }

  return NextResponse.json({ sent: sent.length, lotteries: sent, timestamp: new Date().toISOString() })
}
