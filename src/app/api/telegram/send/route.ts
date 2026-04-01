import { NextRequest, NextResponse } from 'next/server'
import { sendToTelegram, testTelegramBot } from '@/lib/telegram'
import { getServiceClient, getSettings } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const db = getServiceClient()

    // Get bot settings via REST API (bypasses Supabase JS client empty-string bug)
    const settingsMap = await getSettings()

    const botToken = settingsMap.telegram_bot_token
    const channelId = settingsMap.telegram_admin_channel

    if (!botToken) {
      return NextResponse.json({ success: false, error: 'Bot Token ยังไม่ได้ตั้งค่า' }, { status: 400 })
    }

    // Test mode
    if (body.test) {
      const result = await testTelegramBot(botToken)
      return NextResponse.json({ success: result.ok, username: result.username, error: result.error })
    }

    // Send message
    if (!channelId) {
      return NextResponse.json({ success: false, error: 'Admin Channel ID ยังไม่ได้ตั้งค่า' }, { status: 400 })
    }

    const html = body.html || body.message
    if (!html) {
      return NextResponse.json({ success: false, error: 'No message provided' }, { status: 400 })
    }

    const result = await sendToTelegram(botToken, channelId, html)

    // Log to send_logs if lottery info provided
    if (body.lottery_id) {
      await db.from('send_logs').insert({
        lottery_id: body.lottery_id,
        result_id: body.result_id || null,
        channel: 'telegram',
        msg_type: body.msg_type || 'result',
        status: result.success ? 'sent' : 'failed',
        sent_at: new Date().toISOString(),
        duration_ms: body.duration_ms || null,
        error_message: result.error || null,
      })
    }

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}
