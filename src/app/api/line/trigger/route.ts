/**
 * /api/line/trigger — ส่ง "." ไปกลุ่ม LINE ผ่าน Unofficial Thrift API
 *
 * Flow:
 * 1. ผลหวยบันทึกใน DB แล้ว
 * 2. เรียก endpoint นี้ → ส่ง "." ไปทุกกลุ่มที่ active
 * 3. LINE OA webhook รับ "." → Reply ผลหวยกลับ (ฟรี 100%)
 *
 * GET  — เรียกจาก cron หรือ manual (ต้องมี CRON_SECRET)
 * POST — เรียกจาก saveAndSend (internal)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, getSettings } from '@/lib/supabase'
import { sendText } from '@/lib/messaging-service'
import type { LineGroup } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TRIGGER_CHAR = '.'

async function triggerAllGroups() {
  const db = getServiceClient()
  await getSettings() // validate settings are accessible

  // ดึงกลุ่ม LINE ที่ active
  const { data: groups } = await db.from('line_groups').select('*').eq('is_active', true)

  if (!groups || groups.length === 0) {
    return { success: false, error: 'ไม่มีกลุ่ม LINE ที่ active', groups: 0, sent: 0, failed: 0 }
  }

  const results: { group: string; success: boolean; error?: string }[] = []

  for (const group of groups as LineGroup[]) {
    // ใช้ unofficial_group_id (MID) เป็นหลัก, fallback เป็น line_group_id (official)
    const unofficialId = group.unofficial_group_id || ''
    const officialId = group.line_group_id || ''
    const targetId = unofficialId || officialId

    if (!targetId) {
      results.push({ group: group.name, success: false, error: 'ไม่มี group ID' })
      continue
    }

    try {
      const sendResult = await sendText(targetId, TRIGGER_CHAR, officialId)
      results.push({
        group: group.name,
        success: sendResult.success,
        error: sendResult.error,
      })

      // Log trigger send (with error handling!)
      const { error: insertError } = await db.from('send_logs').insert({
        lottery_id: null,
        result_id: null,
        line_group_id: group.id,
        channel: 'line',
        msg_type: 'trigger_send',
        status: sendResult.success ? 'sent' : 'failed',
        sent_at: new Date().toISOString(),
        error_message: sendResult.error || null,
      })
      if (insertError) {
        console.error(`[trigger] Failed to insert send_log for group ${group.name}:`, insertError)
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[trigger] Error sending to ${group.name}:`, errMsg)
      results.push({
        group: group.name,
        success: false,
        error: errMsg,
      })
    }

    // Delay ระหว่างกลุ่ม (500ms-1s)
    await new Promise(r => setTimeout(r, 500 + Math.floor(Math.random() * 500)))
  }

  const sent = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length

  return {
    success: sent > 0,
    groups: groups.length,
    sent,
    failed,
    details: results,
    timestamp: new Date().toISOString(),
  }
}

export async function GET(req: NextRequest) {
  // Auth: CRON_SECRET or test mode
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  const testMode = req.nextUrl.searchParams.get('test') === '1'

  if (!testMode && secret !== process.env.CRON_SECRET && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await triggerAllGroups()
  return NextResponse.json(result)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function POST(_req: NextRequest) {
  // Internal call — no auth needed (called from saveAndSend)
  const result = await triggerAllGroups()
  return NextResponse.json(result)
}
