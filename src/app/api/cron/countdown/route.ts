import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { formatCountdown } from '@/lib/formatter'
import { sendToTelegram } from '@/lib/telegram'
import { sendLineNotify } from '@/lib/line-notify'
import { nowBangkok, today, timeToMinutes } from '@/lib/utils'
import type { Lottery, LineGroup } from '@/types'

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
  const { data: settingsData } = await db.from('bot_settings').select('key, value')
  const settings: Record<string, string> = {}
  ;(settingsData || []).forEach((s: { key: string; value: string }) => { settings[s.key] = s.value })

  // Get active lotteries with countdown
  const { data: lotteries } = await db.from('lotteries').select('*').eq('status', 'active').gt('countdown_minutes', 0)

  const sent = []

  for (const lottery of (lotteries || []) as Lottery[]) {
    const closeTime = lottery.close_time || lottery.result_time
    const closeMinutes = timeToMinutes(closeTime)
    const countdownAt = closeMinutes - lottery.countdown_minutes

    // Should we send countdown now? (within 1 min window)
    if (nowMinutes < countdownAt || nowMinutes > countdownAt + 1) continue

    // Check if already sent today
    const { data: existing } = await db.from('send_logs')
      .select('id')
      .eq('lottery_id', lottery.id)
      .eq('msg_type', 'countdown')
      .gte('created_at', todayStr)
      .limit(1)

    if (existing && existing.length > 0) continue

    const formatted = formatCountdown(lottery, lottery.countdown_minutes)

    // Send to Telegram
    if (settings.telegram_bot_token && settings.telegram_admin_channel) {
      const result = await sendToTelegram(settings.telegram_bot_token, settings.telegram_admin_channel, formatted.tg)
      await db.from('send_logs').insert({
        lottery_id: lottery.id,
        channel: 'telegram',
        msg_type: 'countdown',
        status: result.success ? 'sent' : 'failed',
        sent_at: new Date().toISOString(),
        error_message: result.error || null,
      })
    }

    // Send to LINE (fallback)
    if (settings.fallback_enabled === 'true' || !settings.n8n_webhook_url) {
      const { data: groups } = await db.from('line_groups').select('*').eq('is_active', true)
      for (const group of (groups || []) as LineGroup[]) {
        if (!group.line_notify_token) continue
        const lineResult = await sendLineNotify(group.line_notify_token, formatted.line)
        await db.from('send_logs').insert({
          lottery_id: lottery.id,
          line_group_id: group.id,
          channel: 'line',
          msg_type: 'countdown',
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
