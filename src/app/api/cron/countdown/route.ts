import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, getSettings } from '@/lib/supabase'
import { formatCountdown } from '@/lib/formatter'
import { sendToTelegram } from '@/lib/telegram'
import { pushTextMessage } from '@/lib/line-messaging'
import { nowBangkok, today, timeToMinutes } from '@/lib/utils'
import type { Lottery, LineGroup } from '@/types'

export const dynamic = 'force-dynamic'

// แจ้งเตือน 3 ครั้ง: 20, 10, 5 นาทีก่อนปิด
const COUNTDOWN_INTERVALS = [20, 10, 5]

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

  // Get active lotteries with close_time
  const { data: lotteries } = await db.from('lotteries').select('*').eq('status', 'active')

  const sent: string[] = []

  for (const lottery of (lotteries || []) as Lottery[]) {
    const closeTime = lottery.close_time || lottery.result_time
    if (!closeTime) continue
    const closeMinutes = timeToMinutes(closeTime)

    for (const mins of COUNTDOWN_INTERVALS) {
      const countdownAt = closeMinutes - mins

      // ตรงเวลา? (ภายใน 1 นาที)
      if (nowMinutes < countdownAt || nowMinutes > countdownAt + 1) continue

      // เช็คว่าส่ง interval นี้ไปแล้วหรือยังวันนี้
      const { data: existing } = await db.from('send_logs')
        .select('id')
        .eq('lottery_id', lottery.id)
        .eq('msg_type', 'countdown')
        .gte('created_at', todayStr)
        .like('error_message', `%${mins}min%`)
        .limit(1)

      if (existing && existing.length > 0) continue

      const formatted = formatCountdown(lottery, mins)

      // Send to Telegram
      if (settings.telegram_bot_token && settings.telegram_admin_channel) {
        const result = await sendToTelegram(settings.telegram_bot_token, settings.telegram_admin_channel, formatted.tg)
        await db.from('send_logs').insert({
          lottery_id: lottery.id,
          channel: 'telegram',
          msg_type: 'countdown',
          status: result.success ? 'sent' : 'failed',
          sent_at: new Date().toISOString(),
          error_message: result.success ? `${mins}min` : `${mins}min: ${result.error}`,
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
            msg_type: 'countdown',
            status: lineResult.success ? 'sent' : 'failed',
            sent_at: new Date().toISOString(),
            error_message: lineResult.success ? `${mins}min` : `${mins}min: ${lineResult.error}`,
          })
        }
      }

      sent.push(`${lottery.name} (${mins}นาที)`)
    }
  }

  return NextResponse.json({ sent: sent.length, lotteries: sent, timestamp: new Date().toISOString() })
}
