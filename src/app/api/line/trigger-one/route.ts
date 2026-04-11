/**
 * /api/line/trigger-one — ส่ง "." ไปกลุ่มเดียวตาม ID
 *
 * สำหรับทดสอบโดยเฉพาะ — ไม่กระทบกลุ่มอื่น
 *
 * POST { groupId: "uuid" }
 * Returns: { success, sent, error, details }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { sendText } from '@/lib/messaging-service'
import type { LineGroup } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const TRIGGER_CHAR = '.'

export async function POST(req: NextRequest) {
  const db = getServiceClient()
  const body = await req.json().catch(() => ({}))
  const { groupId } = body

  if (!groupId) {
    return NextResponse.json({ success: false, error: 'groupId is required' }, { status: 400 })
  }

  // ดึงกลุ่มตาม id
  const { data: group } = await db.from('line_groups')
    .select('*')
    .eq('id', groupId)
    .maybeSingle()

  if (!group) {
    return NextResponse.json({ success: false, error: 'Group not found' }, { status: 404 })
  }

  const g = group as LineGroup
  const unofficialId = g.unofficial_group_id || ''
  const officialId = g.line_group_id || ''
  const targetId = unofficialId || officialId

  if (!targetId) {
    return NextResponse.json({
      success: false,
      error: 'ไม่มี group ID (unofficial หรือ official)',
    })
  }

  const startTime = Date.now()
  try {
    const sendResult = await sendText(targetId, TRIGGER_CHAR, officialId)

    // Log
    const { error: logError } = await db.from('send_logs').insert({
      lottery_id: null,
      result_id: null,
      line_group_id: g.id,
      channel: 'line',
      msg_type: 'trigger_send',
      status: sendResult.success ? 'sent' : 'failed',
      sent_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      error_message: sendResult.error || null,
    })

    if (logError) {
      console.error('[trigger-one] Log insert error:', logError)
    }

    return NextResponse.json({
      success: sendResult.success,
      group: { id: g.id, name: g.name },
      via: sendResult.success ? 'unofficial' : null,
      error: sendResult.error,
      durationMs: Date.now() - startTime,
    })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({
      success: false,
      group: { id: g.id, name: g.name },
      error: errMsg,
      durationMs: Date.now() - startTime,
    }, { status: 500 })
  }
}
