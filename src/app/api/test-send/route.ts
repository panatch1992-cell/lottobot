import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { sendToTelegram } from '@/lib/telegram'

export async function GET() {
  try {
    const db = getServiceClient()

    const { data: settings } = await db.from('bot_settings').select('key, value')
    const map: Record<string, string> = {}
    ;(settings || []).forEach((s: { key: string; value: string }) => { map[s.key] = s.value })

    const botToken = map.telegram_bot_token
    const channelId = map.telegram_admin_channel

    if (!botToken || !channelId) {
      return NextResponse.json({ error: 'Bot Token or Channel ID not set' }, { status: 400 })
    }

    const testMsg = [
      '🎰 <b>LottoBot — ทดสอบระบบ</b>',
      '',
      '✅ เชื่อมต่อ Telegram สำเร็จ!',
      `📅 ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`,
      '',
      '🇯🇵 <b>นิเคอิเช้า VIP</b> (ตัวอย่าง)',
      '⬆️ บน : <code>0 3 4</code>',
      '⬇️ ล่าง : <code>9 7</code>',
      '──────',
      '✓ ระบบพร้อมใช้งาน',
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
