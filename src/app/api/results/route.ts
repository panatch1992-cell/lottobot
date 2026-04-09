import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, getSettings } from '@/lib/supabase'
import { formatResult, formatTgAdminLog } from '@/lib/formatter'
import { sendToTelegram } from '@/lib/telegram'
import { pushTextMessage, pushImageAndText, checkLineQuota, flagMonthlyLimitHit } from '@/lib/messaging-service'
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
    const settings = await getSettings()

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

    // Send to LINE groups
    const lineToken = settings.line_channel_access_token
    const sendMode = settings.line_send_mode || 'push'
    let lineSent = 0

    // ═══ TRIGGER MODE: ส่ง "." ให้ LINE OA Reply ฟรี! ═══
    if (sendMode === 'trigger') {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
        if (baseUrl) {
          const triggerRes = await fetch(`${baseUrl}/api/line/trigger`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          })
          const triggerData = await triggerRes.json().catch(() => ({}))
          lineSent = triggerData.sent || 0
          sendResults.push({
            channel: 'line:trigger',
            success: lineSent > 0,
            error: lineSent > 0 ? undefined : (triggerData.error || 'trigger failed'),
          })
        }
      } catch (err) {
        sendResults.push({ channel: 'line:trigger', success: false, error: err instanceof Error ? err.message : 'trigger error' })
      }
    } else {
      // ═══ PUSH MODE (default): ส่งตรงทีละกลุ่ม ═══
      const { data: groups } = await db.from('line_groups').select('*').eq('is_active', true)
      const thaiDate = formatted.line.match(/งวดวันที่\s*(.+)/)?.[1] || todayStr

      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://lottobot-chi.vercel.app'
      const imageParams = new URLSearchParams({
        lottery_name: (lottery as Lottery).name, flag: (lottery as Lottery).flag, date: thaiDate,
        ...(top_number ? { top_number } : {}),
        ...(bottom_number ? { bottom_number } : {}),
        ...(full_number ? { full_number } : {}),
        theme: theme || settings.default_theme || 'shopee',
        font_style: settings.default_font_style || 'rounded',
        digit_size: settings.default_digit_size || 'm',
        layout: settings.default_layout || 'horizontal',
      })
      const imageUrl = `${baseUrl}/api/generate-image?${imageParams.toString()}`

      const resultQuota = lineToken ? await checkLineQuota() : null
      if (lineToken && resultQuota?.canSend) {
        for (const group of (groups || []) as LineGroup[]) {
          if (!group.line_group_id) continue
          const startLine = Date.now()
          let lineResult = await pushImageAndText(lineToken, group.line_group_id, imageUrl, formatted.line)
          if (!lineResult.success) {
            if (lineResult.error?.includes('monthly limit')) {
              await flagMonthlyLimitHit()
            } else {
              lineResult = await pushTextMessage(lineToken, group.line_group_id, formatted.line)
              if (!lineResult.success && lineResult.error?.includes('monthly limit')) {
                await flagMonthlyLimitHit()
              }
            }
          }
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
    }

    return NextResponse.json({
      success: true,
      result: savedResult,
      sends: sendResults,
      summary: sendMode === 'trigger'
        ? `บันทึกแล้ว → TG ✓ → LINE trigger ${lineSent} กลุ่ม (Reply ฟรี!)`
        : `บันทึกแล้ว → TG ✓ → LINE ${lineSent} กลุ่ม`,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}
