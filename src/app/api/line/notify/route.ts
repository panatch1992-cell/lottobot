import { NextRequest, NextResponse } from 'next/server'
import { sendLineNotify } from '@/lib/line-notify'
import { getServiceClient } from '@/lib/supabase'
import type { LineGroup } from '@/types'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const db = getServiceClient()

    const { message, lottery_id, result_id, msg_type = 'result' } = body

    if (!message) {
      return NextResponse.json({ success: false, error: 'No message provided' }, { status: 400 })
    }

    // Get active LINE groups
    const { data: groups } = await db.from('line_groups').select('*').eq('is_active', true)
    const activeGroups = (groups || []) as LineGroup[]

    if (activeGroups.length === 0) {
      return NextResponse.json({ success: false, error: 'ไม่มีกลุ่ม LINE ที่เปิดใช้งาน' })
    }

    const results = []
    for (const group of activeGroups) {
      if (!group.line_notify_token) continue

      const start = Date.now()
      const result = await sendLineNotify(group.line_notify_token, message)
      const duration = Date.now() - start

      // Log
      if (lottery_id) {
        await db.from('send_logs').insert({
          lottery_id,
          result_id: result_id || null,
          line_group_id: group.id,
          channel: 'line',
          msg_type,
          status: result.success ? 'sent' : 'failed',
          sent_at: new Date().toISOString(),
          duration_ms: duration,
          error_message: result.error || null,
        })
      }

      results.push({ group: group.name, ...result, duration_ms: duration })
    }

    const allSuccess = results.every(r => r.success)
    return NextResponse.json({
      success: allSuccess,
      sent: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      details: results,
    })
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}
