import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { verifyChannelToken } from '@/lib/line-messaging'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const db = getServiceClient()

    // Read token directly by key
    const { data: row, error } = await db
      .from('bot_settings')
      .select('value')
      .eq('key', 'line_channel_access_token')
      .single()

    if (error) {
      return NextResponse.json({ valid: false, error: `DB: ${error.message}` })
    }

    const token = row?.value
    if (!token) {
      return NextResponse.json({ valid: false, error: 'Channel Access Token ยังไม่ได้ตั้งค่า' })
    }

    const result = await verifyChannelToken(token)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ valid: false, error: err instanceof Error ? err.message : 'Server error' })
  }
}
