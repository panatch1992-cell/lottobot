import { NextResponse } from 'next/server'
import { getSettings } from '@/lib/supabase'
import { verifyChannelToken } from '@/lib/line-messaging'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Read settings via REST API (bypasses Supabase JS client empty-string bug)
    const settings = await getSettings()

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
