import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { formatResult, formatTgAdminLog } from '@/lib/formatter'
import { sendToTelegram } from '@/lib/telegram'
import { pushFlexResult } from '@/lib/line-messaging'
import type { Lottery, LineGroup } from '@/types'

export async function GET() {
  try {
    const db = getServiceClient()
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })

    const { data: lotteries } = await db
      .from('lotteries')
      .select('*')
      .eq('status', 'active')
      .order('sort_order')

    const { data: todayResults } = await db
      .from('results')
      .select('lottery_id, top_number, bottom_number, full_number')
      .eq('draw_date', todayStr)

    const resultMap: Record<string, { top_number: string; bottom_number: string; full_number: string }> = {}
    ;(todayResults || []).forEach(r => { resultMap[r.lottery_id] = r })

    return NextResponse.json({
      lotteries: lotteries || [],
      results: resultMap,
      date: todayStr,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getServiceClient()
    const body = await req.json()
    const { lottery_id, top_number, bottom_number, full_number, theme } = body

    if (!lottery_id) {
      return NextResponse.json({ error: 'lottery_id required' }, { status: 400 })
    }
    if (!top_number && !bottom_number && !full_number) {
      return NextResponse.json({ error: 'ต้องกรอกตัวเลขอย่างน้อย 1 ช่อง' }, { status: 400 })
    }

    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })

    // Check if result already exists
    const { data: existing } = await db
      .from('results')
      .select('id')
      .eq('lottery_id', lottery_id)
      .eq('draw_date', todayStr)
      .maybeSingle()

    let savedResult
    if (existing) {
      const { data } = await db.from('results')
        .update({
          top_number: top_number || null,
          bottom_number: bottom_number || null,
          full_number: full_number || null,
          source_url: 'manual',
          scraped_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single()
      savedResult = data
    } else {
      const { data } = await db.from('results')
        .insert({
          lottery_id,
          draw_date: todayStr,
          top_number: top_number || null,
          bottom_number: bottom_number || null,
          full_number: full_number || null,
          source_url: 'manual',
          scraped_at: new Date().toISOString(),
        })
        .select()
        .single()
      savedResult = data
    }

    if (!savedResult) {
      return NextResponse.json({ error: 'Failed to save result' }, { status: 500 })
    }

    // Get lottery info
    const { data: lottery } = await db.from('lotteries').select('*').eq('id', lottery_id).single()
    if (!lottery) {
      return NextResponse.json({ error: 'Lottery not found' }, { status: 404 })
    }

    const formatted = formatResult(lottery as Lottery, savedResult)
    const sendResults: { channel: string; success: boolean; error?: string }[] = []

    // Send to Telegram
    const { data: settingsData } = await db.from('bot_settings').select('key, value')
    const settings: Record<string, string> = {}
    ;(settingsData || []).forEach((s: { key: string; value: string }) => { settings[s.key] = s.value })

    if (settings.telegram_bot_token && settings.telegram_admin_channel) {
      const { count } = await db.from('line_groups').select('*', { count: 'exact', head: true }).eq('is_active', true)
      const adminMsg = formatTgAdminLog(lottery as Lottery, savedResult, count || 0, 0)
      const tgResult = await sendToTelegram(settings.telegram_bot_token, settings.telegram_admin_channel, adminMsg)
      sendResults.push({ channel: 'telegram', success: tgResult.success, error: tgResult.error })

      await db.from('send_logs').insert({
        lottery_id,
        result_id: savedResult.id,
        channel: 'telegram',
        msg_type: 'result',
        status: tgResult.success ? 'sent' : 'failed',
        sent_at: new Date().toISOString(),
        error_message: tgResult.error || null,
      })
    }

    // Send to LINE groups (Flex Message)
    const lineToken = settings.line_channel_access_token
    const { data: groups } = await db.from('line_groups').select('*').eq('is_active', true)
    let lineSent = 0
    const thaiDate = formatted.line.match(/งวดวันที่\s*(.+)/)?.[1] || todayStr

    if (lineToken) {
      for (const group of (groups || []) as LineGroup[]) {
        if (!group.line_group_id) continue
        const startLine = Date.now()
        const lineResult = await pushFlexResult(lineToken, group.line_group_id, {
          name: (lottery as Lottery).name,
          flag: (lottery as Lottery).flag,
          date: thaiDate,
          top_number: top_number || undefined,
          bottom_number: bottom_number || undefined,
          full_number: full_number || undefined,
          theme: theme || settings.default_theme || 'macaroon',
        })
        sendResults.push({ channel: `line:${group.name}`, success: lineResult.success, error: lineResult.error })
        if (lineResult.success) lineSent++

        await db.from('send_logs').insert({
          lottery_id,
          result_id: savedResult.id,
          line_group_id: group.id,
          channel: 'line',
          msg_type: 'result',
          status: lineResult.success ? 'sent' : 'failed',
          sent_at: new Date().toISOString(),
          duration_ms: Date.now() - startLine,
          error_message: lineResult.error || null,
        })
      }
    }

    return NextResponse.json({
      success: true,
      result: savedResult,
      sends: sendResults,
      summary: `บันทึกแล้ว → TG ✓ → LINE ${lineSent} กลุ่ม`,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}
