import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { verifyChannelToken } from '@/lib/line-messaging'

export async function GET() {
  try {
    const db = getServiceClient()
    const { data: settingsData } = await db.from('bot_settings').select('key, value')
    const settings: Record<string, string> = {}
    ;(settingsData || []).forEach((s: { key: string; value: string }) => { settings[s.key] = s.value })

    const token = settings.line_channel_access_token
    if (!token) {
      return NextResponse.json({ valid: false, error: 'Channel Access Token ยังไม่ได้ตั้งค่า' })
    }

    const result = await verifyChannelToken(token)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ valid: false, error: err instanceof Error ? err.message : 'Server error' })
  }
}
