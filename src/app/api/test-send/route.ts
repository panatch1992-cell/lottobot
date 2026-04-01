import { NextResponse } from 'next/server'
import { getSettings } from '@/lib/supabase'
import { sendToTelegram } from '@/lib/telegram'

export async function GET() {
  try {
    // Get bot settings via REST API (bypasses Supabase JS client empty-string bug)
    const map = await getSettings()

    const botToken = map.telegram_bot_token
    const channelId = map.telegram_admin_channel

    if (!botToken || !channelId) {
      return NextResponse.json({ error: 'Bot Token or Channel ID not set' }, { status: 400 })
    }

    const testMsg = [
      '🔧 <b>ทดสอบระบบ</b>',
      '',
      'ข้อความนี้เป็นการทดสอบการเชื่อมต่อ Bot กับกลุ่ม',
      'กรุณาอย่าสนใจข้อความนี้ครับ 🙏',
    ].join('\n')

    const result = await sendToTelegram(botToken, channelId, testMsg)

    return NextResponse.json({
      success: result.success,
      message: result.success ? 'ส่งข้อความทดสอบสำเร็จ! ดูที่กลุ่ม Telegram' : result.error,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}
