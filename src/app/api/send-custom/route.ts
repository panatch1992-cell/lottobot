import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, getSettings } from '@/lib/supabase'
import { sendToTelegram } from '@/lib/telegram'
import { pushTextMessage, checkLineQuota, flagMonthlyLimitHit } from '@/lib/line-messaging'
import type { LineGroup } from '@/types'

export async function POST(req: NextRequest) {
  try {
    const db = getServiceClient()
    const { message, target } = await req.json()

    if (!message?.trim()) {
      return NextResponse.json({ error: 'กรุณาพิมพ์ข้อความ' }, { status: 400 })
    }

    const settings = await getSettings()

    const results: { channel: string; success: boolean; error?: string }[] = []

    // Send to Telegram
    if (target === 'telegram' || target === 'both') {
      if (settings.telegram_bot_token && settings.telegram_admin_channel) {
        const tgResult = await sendToTelegram(
          settings.telegram_bot_token,
          settings.telegram_admin_channel,
          message.trim(),
        )
        results.push({ channel: 'telegram', success: tgResult.success, error: tgResult.error })
      }
    }

    // Send to LINE groups
    if (target === 'line' || target === 'both') {
      const lineToken = settings.line_channel_access_token
      if (lineToken) {
        const quota = await checkLineQuota()
        if (!quota.canSend) {
          results.push({ channel: 'line', success: false, error: `LINE quota เต็ม: ${quota.reason}` })
        } else {
          const { data: groups } = await db.from('line_groups').select('*').eq('is_active', true)
          for (const group of (groups || []) as LineGroup[]) {
            if (!group.line_group_id) continue
            const lineResult = await pushTextMessage(lineToken, group.line_group_id, message.trim())
            if (!lineResult.success && lineResult.error?.includes('monthly limit')) {
              await flagMonthlyLimitHit()
            }
            results.push({
              channel: `line:${group.name}`,
              success: lineResult.success,
              error: lineResult.error,
            })
          }
        }
      }
    }

    const allSuccess = results.length > 0 && results.every(r => r.success)
    const failedResults = results.filter(r => !r.success)

    return NextResponse.json({
      success: allSuccess,
      results,
      error: results.length === 0
        ? 'ไม่มีช่องทางส่ง — เช็ค LINE Token และ TG Channel ID ในตั้งค่า'
        : failedResults.length > 0
          ? failedResults.map(r => `${r.channel}: ${r.error}`).join(', ')
          : undefined,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}
