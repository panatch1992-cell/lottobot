import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, getSettings } from '@/lib/supabase'
import { sendToTelegram } from '@/lib/telegram'
import { sendText, checkLineQuota, flagMonthlyLimitHit } from '@/lib/messaging-service'
import type { LineGroup } from '@/types'

function shouldDeactivateGroupFromError(error?: string) {
  if (!error) return false
  const normalized = error.toLowerCase()
  return (
    normalized.includes(`property, 'to', in the request body is invalid`) ||
    normalized.includes('"property":"to"') ||
    normalized.includes('invalid user id') ||
    normalized.includes('invalid group id') ||
    normalized.includes('invalid recipient') ||
    normalized.includes('not found') ||
    normalized.includes('cannot find') ||
    normalized.includes('failed to send messages')
  )
}

export async function POST(req: NextRequest) {
  try {
    const db = getServiceClient()
    const { message, target, groupNames, dryRun } = await req.json()

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
      const quota = await checkLineQuota()
      if (!quota.canSend) {
        results.push({ channel: 'line', success: false, error: `LINE quota เต็ม: ${quota.reason}` })
      } else {
        let query = db.from('line_groups').select('*').eq('is_active', true)
        if (Array.isArray(groupNames) && groupNames.length > 0) {
          query = query.in('name', groupNames)
        }

        const { data: groups } = await query
        const activeGroups = (groups || []) as LineGroup[]

        if (dryRun) {
          results.push({
            channel: 'line',
            success: true,
            error: `dry-run: would send to ${activeGroups.filter(g => !!g.line_group_id).length} groups`,
          })
        }

        for (const group of activeGroups) {
          if (dryRun) break
          if (!group.line_group_id) continue
          const lineResult = await sendText(group.line_group_id, message.trim())

          if (!lineResult.success && lineResult.error?.includes('monthly limit')) {
            await flagMonthlyLimitHit()
          }

          if (!lineResult.success && shouldDeactivateGroupFromError(lineResult.error)) {
            await db.from('line_groups').update({ is_active: false }).eq('id', group.id)
          }

          results.push({
            channel: `line:${group.name}`,
            success: lineResult.success,
            error: !lineResult.success && shouldDeactivateGroupFromError(lineResult.error)
              ? `${lineResult.error} (group auto-disabled: invalid or unreachable recipient)`
              : lineResult.error,
          })
        }
      }
    }

    const allSuccess = results.length > 0 && results.every(r => r.success)
    const failedResults = results.filter(r => !r.success)

    return NextResponse.json({
      success: allSuccess,
      results,
      dryRun: !!dryRun,
      selectedGroups: Array.isArray(groupNames) ? groupNames : null,
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
