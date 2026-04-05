import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, getSettings } from '@/lib/supabase'
import { sendToTelegram } from '@/lib/telegram'
import { pushTextMessage } from '@/lib/messaging-service'
import { nowBangkok, today } from '@/lib/utils'
import type { LineGroup } from '@/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  const testMode = req.nextUrl.searchParams.get('test') === '1'
  if (!testMode && secret !== process.env.CRON_SECRET && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getServiceClient()
  const now = nowBangkok()
  const nowHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const todayStr = today()
  const dayOfWeek = now.getDay() // 0=Sun, 1=Mon, ..., 6=Sat

  // Get settings
  const settings = await getSettings()

  // Get active scheduled messages that should send now
  const { data: messages } = await db.from('scheduled_messages')
    .select('*')
    .eq('is_active', true)

  const sent: string[] = []

  for (const msg of messages || []) {
    // Check time match (HH:MM)
    const msgTime = msg.send_time?.substring(0, 5)
    if (msgTime !== nowHHMM) continue

    // Check day match
    const repeat = msg.repeat_days || 'daily'
    if (repeat === 'weekday' && (dayOfWeek === 0 || dayOfWeek === 6)) continue
    if (repeat === 'weekend' && dayOfWeek >= 1 && dayOfWeek <= 5) continue
    if (repeat !== 'daily' && repeat !== 'weekday' && repeat !== 'weekend') {
      // Custom days: "1,2,3,4,5" format
      const days = repeat.split(',').map(Number)
      if (!days.includes(dayOfWeek)) continue
    }

    // Check not already sent today
    const lastSent = msg.last_sent_at ? new Date(msg.last_sent_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }) : ''
    if (lastSent === todayStr) continue

    const target = msg.target || 'both'

    // Send to Telegram
    if ((target === 'telegram' || target === 'both') && settings.telegram_bot_token && settings.telegram_admin_channel) {
      await sendToTelegram(settings.telegram_bot_token, settings.telegram_admin_channel, msg.message)
    }

    // Send to LINE groups
    if ((target === 'line' || target === 'both') && settings.line_channel_access_token) {
      const { data: groups } = await db.from('line_groups').select('*').eq('is_active', true)
      for (const group of (groups || []) as LineGroup[]) {
        if (!group.line_group_id) continue
        await pushTextMessage(settings.line_channel_access_token, group.line_group_id, msg.message)
      }
    }

    // Update last_sent_at
    await db.from('scheduled_messages').update({ last_sent_at: new Date().toISOString() }).eq('id', msg.id)

    sent.push(`${msgTime}: ${msg.message.substring(0, 30)}...`)
  }

  return NextResponse.json({ sent: sent.length, messages: sent, now: nowHHMM, timestamp: new Date().toISOString() })
}
