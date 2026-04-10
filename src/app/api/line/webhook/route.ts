import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, getSettings } from '@/lib/supabase'
import { getGroupSummary } from '@/lib/line-messaging'
import { replyMessage } from '@/lib/line-reply'
import { formatResult } from '@/lib/formatter'
import type { Lottery, Result } from '@/types'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

const TRIGGER_CHAR = '.'

/**
 * ดึงผลหวยที่ยังไม่ได้ส่งผ่าน Reply API ให้กลุ่มนี้
 * → query results วันนี้ที่ยังไม่มี send_log channel='line_reply' สำหรับกลุ่มนี้
 */
async function getPendingResults(db: ReturnType<typeof getServiceClient>, officialGroupId: string) {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })

  // ดึง group record จาก line_group_id (official)
  const { data: group } = await db.from('line_groups')
    .select('id')
    .eq('line_group_id', officialGroupId)
    .eq('is_active', true)
    .maybeSingle()

  // ดึงผลหวยวันนี้ทั้งหมด
  const { data: results } = await db.from('results')
    .select('*, lotteries!inner(*)')
    .eq('draw_date', todayStr)
    .order('scraped_at', { ascending: false })

  if (!results || results.length === 0) return []

  // ดึง send_logs ที่ส่งผ่าน reply แล้ว สำหรับกลุ่มนี้
  // Note: ตรวจเฉพาะ trigger_reply (ไม่รวม trigger_send เพราะ trigger_send คือการยิง "." ไม่ใช่การ reply ผล)
  let query = db.from('send_logs')
    .select('result_id')
    .eq('channel', 'line')
    .eq('msg_type', 'trigger_reply')
    .eq('status', 'sent')
    .in('result_id', results.map(r => r.id))
  if (group) {
    query = query.eq('line_group_id', group.id)
  }
  const { data: sentLogsData } = await query

  const sentIds = new Set((sentLogsData || []).map(l => l.result_id))

  return results
    .filter(r => !sentIds.has(r.id))
    .map(r => ({
      result: r as Result,
      lottery: r.lotteries as unknown as Lottery,
      groupDbId: group?.id || null,
    }))
}

export async function POST(req: NextRequest) {
  try {
    const db = getServiceClient()

    // Get channel secret for signature verification (via REST API)
    const settings = await getSettings()

    const channelSecret = settings.line_channel_secret
    const channelToken = settings.line_channel_access_token

    // Verify signature
    const body = await req.text()
    const signature = req.headers.get('x-line-signature')

    if (channelSecret && signature) {
      const hash = crypto
        .createHmac('SHA256', channelSecret)
        .update(body)
        .digest('base64')
      if (hash !== signature) {
        console.error('LINE webhook: Invalid signature')
        return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
      }
    }

    const parsed = JSON.parse(body)
    const events = parsed.events || []

    for (const event of events) {
      console.log('LINE webhook event:', event.type, event.source?.type, event.source?.groupId)

      // ═══ TRIGGER: ตรวจจับ "." → Reply ด้วยผลหวย (ฟรี!) ═══
      if (
        event.type === 'message' &&
        event.message?.type === 'text' &&
        event.message.text?.trim() === TRIGGER_CHAR &&
        event.source?.type === 'group' &&
        event.replyToken &&
        channelToken
      ) {
        const groupId = event.source.groupId
        console.log(`[trigger] "." detected in group ${groupId.slice(-8)}`)

        try {
          const pending = await getPendingResults(db, groupId)

          if (pending.length > 0) {
            // สร้างข้อความรวมทุกผลที่ยังไม่ส่ง (รวมไม่เกิน 5 messages)
            // ตัด text ถ้ายาวเกิน 4900 chars (LINE limit 5000)
            const messages: { type: 'text'; text: string }[] = []

            for (const { result, lottery } of pending.slice(0, 5)) {
              const formatted = formatResult(lottery, result)
              const text = formatted.line.length > 4900 ? formatted.line.slice(0, 4895) + '...' : formatted.line
              messages.push({ type: 'text', text })
            }

            const startMs = Date.now()
            const replyRes = await replyMessage(channelToken, event.replyToken, messages)
            const duration = Date.now() - startMs

            console.log(`[trigger] Reply ${replyRes.success ? '✅' : '❌'} to ${groupId.slice(-8)} (${messages.length} results, ${duration}ms)`)

            // Check for replyToken expiry (LINE error 110 / 400)
            if (!replyRes.success && replyRes.error?.includes('Invalid reply token')) {
              console.error(`[trigger] ⚠️ Reply token expired for group ${groupId.slice(-8)} — webhook was too slow`)
            }

            // บันทึก send_logs (ใช้ Promise.allSettled เพื่อไม่ให้ fail หนึ่งอัน block อื่น)
            const logPromises = pending.slice(0, 5).map(({ result, lottery, groupDbId }) =>
              db.from('send_logs').insert({
                lottery_id: lottery.id,
                result_id: result.id,
                line_group_id: groupDbId,
                channel: 'line',
                msg_type: 'trigger_reply',
                status: replyRes.success ? 'sent' : 'failed',
                sent_at: new Date().toISOString(),
                duration_ms: duration,
                error_message: replyRes.error || null,
              })
            )
            const logResults = await Promise.allSettled(logPromises)
            const logFailures = logResults.filter(r => r.status === 'rejected').length
            if (logFailures > 0) {
              console.warn(`[trigger] ${logFailures} send_log insert(s) failed`)
            }
          } else {
            console.log(`[trigger] No pending results for group ${groupId.slice(-8)}`)
          }
        } catch (triggerErr) {
          console.error(`[trigger] Error handling trigger:`, triggerErr)
        }
      }

      // Bot joined a group
      if (event.type === 'join' && event.source?.type === 'group') {
        const groupId = event.source.groupId

        // Get group info
        let groupName = `กลุ่ม ${groupId.slice(-6)}`

        if (channelToken) {
          try {
            const info = await getGroupSummary(channelToken, groupId)
            if (info.name) groupName = info.name
          } catch (e) {
            console.error('LINE webhook: getGroupSummary error', e)
          }
        }

        // Check if group already exists
        const { data: existing } = await db
          .from('line_groups')
          .select('id')
          .eq('line_group_id', groupId)
          .maybeSingle()

        if (!existing) {
          const { error: insertErr } = await db.from('line_groups').insert({
            name: groupName,
            line_group_id: groupId,
            is_active: true,
          })
          if (insertErr) {
            console.error('LINE webhook: insert error', insertErr.message)
          }
        } else {
          // Reactivate if previously left
          await db.from('line_groups')
            .update({ is_active: true, name: groupName, updated_at: new Date().toISOString() })
            .eq('line_group_id', groupId)
        }
      }

      // Bot left/was removed from group
      if (event.type === 'leave' && event.source?.type === 'group') {
        const groupId = event.source.groupId
        await db
          .from('line_groups')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('line_group_id', groupId)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('LINE webhook error:', err)
    return NextResponse.json({ ok: true }) // Always return 200 to LINE
  }
}

// LINE sends a verification GET request + diagnostic info
export async function GET() {
  try {
    const db = getServiceClient()

    // Check settings (via REST API)
    const settings = await getSettings()

    // Check groups
    const { data: groups } = await db.from('line_groups').select('*').order('updated_at', { ascending: false }).limit(10)

    return NextResponse.json({
      status: 'ok',
      webhook: 'active',
      hasSecret: !!settings.line_channel_secret,
      hasToken: !!settings.line_channel_access_token,
      groups: (groups || []).map(g => ({
        name: g.name,
        line_group_id: g.line_group_id ? `...${g.line_group_id.slice(-8)}` : null,
        is_active: g.is_active,
        updated_at: g.updated_at,
      })),
    })
  } catch (err) {
    return NextResponse.json({ status: 'ok', error: err instanceof Error ? err.message : 'unknown' })
  }
}
