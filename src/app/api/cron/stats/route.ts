import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, getSettings } from '@/lib/supabase'
import { formatStats } from '@/lib/formatter'
import { sendToTelegram } from '@/lib/telegram'
import { pushTextMessage, checkLineQuota, flagMonthlyLimitHit } from '@/lib/messaging-service'
import { sleep } from '@/lib/utils'
import { nowBangkok, today, timeToMinutes } from '@/lib/utils'
import type { Lottery, Result, LineGroup } from '@/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  const testMode = req.nextUrl.searchParams.get('test') === '1'
  if (!testMode && secret !== process.env.CRON_SECRET && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getServiceClient()
  const now = nowBangkok()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const todayStr = today()

  // Get settings
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
      const { data: groups } = await db.from('line_groups').select('*').eq('is_active', true)
      for (const group of (groups || []) as LineGroup[]) {
        if (!group.line_group_id) continue
        if (sentStatsGroupIds.has(group.id)) continue
        if (limitStatsGroupIds.has(group.id)) continue

        const lineResult = await pushTextMessage(lineToken, group.line_group_id, formatted.line)
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
        // Random delay between groups (2-5s)
        await sleep(2000 + Math.floor(Math.random() * 3000))
      }
    }

    sent.push(lottery.name)
  }

  return NextResponse.json({ sent: sent.length, lotteries: sent, timestamp: new Date().toISOString() })
}
