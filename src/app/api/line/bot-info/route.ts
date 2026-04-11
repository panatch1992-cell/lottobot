/**
 * /api/line/bot-info — ดึงข้อมูล LINE OA bot (Basic ID, Display Name, QR code)
 *
 * ใช้สำหรับเวลาต้องการเพิ่ม bot เป็นเพื่อน
 */

import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const db = getServiceClient()
    const { data: settingsData } = await db.from('bot_settings').select('key, value')
    const settings: Record<string, string> = {}
    ;(settingsData || []).forEach((s: { key: string; value: string }) => {
      if (s.key && s.value) settings[s.key] = s.value
    })

    const token = settings.line_channel_access_token
    if (!token || token.startsWith('YOUR_')) {
      return NextResponse.json({
        success: false,
        error: 'LINE_CHANNEL_ACCESS_TOKEN not configured',
      }, { status: 400 })
    }

    // Fetch bot info from LINE API
    const res = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return NextResponse.json({
        success: false,
        error: `LINE API HTTP ${res.status}: ${body.slice(0, 200)}`,
      }, { status: 502 })
    }

    const info = await res.json()

    // Generate add friend URL
    const basicId = info.basicId || ''
    const premiumId = info.premiumId || ''
    const displayId = premiumId || basicId
    const addFriendUrl = displayId ? `https://line.me/R/ti/p/${encodeURIComponent(displayId)}` : null

    return NextResponse.json({
      success: true,
      bot: {
        userId: info.userId,
        basicId: info.basicId,
        premiumId: info.premiumId,
        displayName: info.displayName,
        pictureUrl: info.pictureUrl,
        chatMode: info.chatMode,
      },
      addFriend: {
        url: addFriendUrl,
        id: displayId,
        qrCode: displayId ? `https://qr-official.line.me/sid/L/${displayId.replace('@', '')}.png` : null,
      },
    })
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 })
  }
}
