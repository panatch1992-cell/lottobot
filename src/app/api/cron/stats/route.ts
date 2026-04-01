import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, getSettings } from '@/lib/supabase'
import { formatStats } from '@/lib/formatter'
import { sendToTelegram } from '@/lib/telegram'
import { pushTextMessage } from '@/lib/line-messaging'
import { nowBangkok, today, timeToMinutes } from '@/lib/utils'
import type { Lottery, Result, LineGroup } from '@/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== process.env.CRON_SECRET && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getServiceClient()
  const now = nowBangkok()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const todayStr = today()

  // Get settings
  const settings = await getSettings()

  const statsCount = parseInt(settings.stats_count || '10')

  // Get active lotteries that have send_stats enabled and have a result today
  const { data: lotteries } = await db.from('lotteries').select('*').eq('status', 'active').eq('send_stats', true)

  const sent = []

  for (const lottery of (lotteries || []) as Lottery[]) {
    const resultMin = timeToMinutes(lottery.result_time)

    // Send stats 2 minutes after result time
    if (nowMinutes < resultMin + 2 || nowMinutes > resultMin + 3) continue

    // Check if already sent today
    const { data: existing } = await db.from('send_logs')
      .select('id')
      .eq('lottery_id', lottery.id)
      .eq('msg_type', 'stats')
      .gte('created_at', todayStr)
      .limit(1)

    if (existing && existing.length > 0) continue

    // Get last N results
    const { data: results } = await db.from('results')
      .select('*')
      .eq('lottery_id', lottery.id)
      .order('draw_date', { ascending: false })
      .limit(statsCount)

    if (!results || results.length === 0) continue

    const formatted = formatStats(lottery, results as Result[])

    // Send to Telegram
    if (settings.telegram_bot_token && settings.telegram_admin_channel) {
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

    // Send to LINE groups (Messaging API)
    const lineToken = settings.line_channel_access_token
    if (lineToken) {
      const { data: groups } = await db.from('line_groups').select('*').eq('is_active', true)
      for (const group of (groups || []) as LineGroup[]) {
        if (!group.line_group_id) continue
        const lineResult = await pushTextMessage(lineToken, group.line_group_id, formatted.line)
        await db.from('send_logs').insert({
          lottery_id: lottery.id,
          line_group_id: group.id,
          channel: 'line',
          msg_type: 'stats',
          status: lineResult.success ? 'sent' : 'failed',
          sent_at: new Date().toISOString(),
          error_message: lineResult.error || null,
        })
      }
    }

    sent.push(lottery.name)
  }

  return NextResponse.json({ sent: sent.length, lotteries: sent, timestamp: new Date().toISOString() })
}
