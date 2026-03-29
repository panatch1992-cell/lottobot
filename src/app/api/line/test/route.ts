import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { verifyChannelToken } from '@/lib/line-messaging'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const db = getServiceClient()
    const { data: settingsData, error: dbError } = await db.from('bot_settings').select('key, value')

    if (dbError) {
      return NextResponse.json({ valid: false, error: `DB error: ${dbError.message}` })
    }

    const settings: Record<string, string> = {}
    ;(settingsData || []).forEach((s: { key: string; value: string }) => { settings[s.key] = s.value })

    const token = settings.line_channel_access_token
    const allKeys = Object.keys(settings)
    const tokenLength = token ? token.length : 0
    const tokenPreview = token ? `${token.slice(0, 10)}...` : '(empty)'

    if (!token) {
      return NextResponse.json({
        valid: false,
        error: 'Channel Access Token ยังไม่ได้ตั้งค่า',
        debug: { allKeys, tokenLength, tokenPreview, totalSettings: settingsData?.length }
      })
    }

    const result = await verifyChannelToken(token)
    return NextResponse.json({ ...result, debug: { tokenLength, tokenPreview } })
  } catch (err) {
    return NextResponse.json({ valid: false, error: err instanceof Error ? err.message : 'Server error' })
  }
}
