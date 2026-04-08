import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, getSettings } from '@/lib/supabase'
import { sendToTelegram } from '@/lib/telegram'
import { pushTextMessage } from '@/lib/messaging-service'
import { nowBangkok, today, sleep } from '@/lib/utils'
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
  const debug: Array<{ id: string; msgTime: string; now: string; decision: string; lastSent: string; repeat: string }> = []

  for (const msg of messages || []) {
    // Check time match (HH:MM)
    const msgTime = msg.send_time?.substring(0, 5)
    if (msgTime !== nowHHMM) {
      if (testMode) {
        debug.push({
          id: msg.id,
          msgTime: msgTime || '',
          now: nowHHMM,
          decision: 'skip:time_mismatch',
          lastSent: msg.last_sent_at || '',
          repeat: msg.repeat_days || 'daily',
        })
      }
      continue
    }

    // Check day match
    const repeat = msg.repeat_days || 'daily'
    if (repeat === 'weekday' && (dayOfWeek === 0 || dayOfWeek === 6)) {
      if (testMode) {
        debug.push({
          id: msg.id,
          msgTime: msgTime || '',
          now: nowHHMM,
          decision: 'skip:weekday_rule',
          lastSent: msg.last_sent_at || '',
          repeat,
        })
      }
      continue
    }
    if (repeat === 'weekend' && dayOfWeek >= 1 && dayOfWeek <= 5) {
      if (testMode) {
        debug.push({
          id: msg.id,
          msgTime: msgTime || '',
          now: nowHHMM,
          decision: 'skip:weekend_rule',
          lastSent: msg.last_sent_at || '',
          repeat,
        })
      }
      continue
    }
    if (repeat !== 'daily' && repeat !== 'weekday' && repeat !== 'weekend') {
      // Custom days: "1,2,3,4,5" format
      const days = repeat.split(',').map(Number)
      if (!days.includes(dayOfWeek)) {
        if (testMode) {
          debug.push({
            id: msg.id,
            msgTime: msgTime || '',
            now: nowHHMM,
            decision: 'skip:custom_day_mismatch',
            lastSent: msg.last_sent_at || '',
            repeat,
          })
        }
        continue
      }
    }

    // Check not already sent today
    const lastSent = msg.last_sent_at ? new Date(msg.last_sent_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }) : ''
    if (lastSent === todayStr) {
      if (testMode) {
        debug.push({
          id: msg.id,
          msgTime: msgTime || '',
          now: nowHHMM,
          decision: 'skip:already_sent_today',
          lastSent: msg.last_sent_at || '',
          repeat,
        })
      }
      continue
    }

    const target = msg.target || 'both'

    // Send to Telegram
    if ((target === 'telegram' || target === 'both') && settings.telegram_bot_token && settings.telegram_admin_channel) {
      await sendToTelegram(settings.telegram_bot_token, settings.telegram_admin_channel, msg.message)
    }

    // Send to LINE groups
    if ((target === 'line' || target === 'both') && settings.line_channel_access_token) {
      const { data: groups } = await db.from('line_groups').select('*').eq('is_active', true)
      for (const group of (groups || []) as LineGroup[]) {
        const unofficialId = (group as unknown as { unofficial_group_id?: string }).unofficial_group_id || ''
        const officialId = group.line_group_id || ''
        const primaryId = unofficialId || officialId
        if (!primaryId) continue
        await pushTextMessage(settings.line_channel_access_token, primaryId, msg.message, officialId)
        await sleep(500 + Math.floor(Math.random() * 1000))
      }
    }

    // Update last_sent_at
    await db.from('scheduled_messages').update({ last_sent_at: new Date().toISOString() }).eq('id', msg.id)

    sent.push(`${msgTime}: ${msg.message.substring(0, 30)}...`)

    if (testMode) {
      debug.push({
        id: msg.id,
        msgTime: msgTime || '',
        now: nowHHMM,
        decision: 'sent',
        lastSent: msg.last_sent_at || '',
        repeat,
      })
    }
  }

  return NextResponse.json({
    sent: sent.length,
    messages: sent,
    now: nowHHMM,
    timestamp: new Date().toISOString(),
    ...(testMode ? { debug } : {}),
  })
}
