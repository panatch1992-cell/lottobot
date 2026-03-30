import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { scrapeResult } from '@/lib/scraper'
import type { ScrapeSource } from '@/types'

export async function GET(req: NextRequest) {
  try {
    const db = getServiceClient()
    const lotteryId = req.nextUrl.searchParams.get('lottery_id')

    let query = db.from('scrape_sources').select('*, lotteries(name, flag)')

    if (lotteryId) {
      query = query.eq('lottery_id', lotteryId)
    }

    const { data, error } = await query.order('is_primary', { ascending: false })

    if (error) throw error
    return NextResponse.json({ sources: data || [] })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getServiceClient()
    const body = await req.json()
    const { action } = body

    // Test scrape — ทดสอบดึงผลจาก URL + selectors โดยไม่บันทึก
    if (action === 'test') {
      const { url, selector_config } = body
      if (!url) {
        return NextResponse.json({ error: 'URL required' }, { status: 400 })
      }
      const testSource: ScrapeSource = {
        id: 'test',
        lottery_id: 'test',
        url,
        is_primary: true,
        selector_config: selector_config || null,
        is_active: true,
        last_success_at: null,
        last_error: null,
        created_at: '',
      }
      const result = await scrapeResult(testSource)
      return NextResponse.json({
        success: result.success,
        data: result.data,
        error: result.error,
      })
    }

    // Manual scrape — ดึงผลจาก sources ที่ config ไว้แล้ว + บันทึก result
    if (action === 'scrape_now') {
      const { lottery_id } = body
      if (!lottery_id) {
        return NextResponse.json({ error: 'lottery_id required' }, { status: 400 })
      }

      // Import needed functions
      const { scrapeWithFallback } = await import('@/lib/scraper')
      const { formatResult, formatTgAdminLog } = await import('@/lib/formatter')
      const { sendToTelegram } = await import('@/lib/telegram')
      const { pushTextMessage, pushImageAndText } = await import('@/lib/line-messaging')
      const { today } = await import('@/lib/utils')

      const todayStr = today()

      // Check existing result
      const { data: existing } = await db.from('results')
        .select('id')
        .eq('lottery_id', lottery_id)
        .eq('draw_date', todayStr)
        .maybeSingle()

      if (existing) {
        return NextResponse.json({ error: 'วันนี้มีผลแล้ว ลบผลเดิมก่อนหรือใช้หน้ากรอกผลแทน' }, { status: 400 })
      }

      // Get sources
      const { data: sources } = await db.from('scrape_sources')
        .select('*')
        .eq('lottery_id', lottery_id)
        .eq('is_active', true)

      if (!sources || sources.length === 0) {
        return NextResponse.json({ error: 'ไม่มี scrape source ที่ active อยู่' }, { status: 400 })
      }

      const scrapeRes = await scrapeWithFallback(sources as ScrapeSource[])

      if (!scrapeRes.success || !scrapeRes.data) {
        return NextResponse.json({
          success: false,
          error: scrapeRes.error || 'ดึงผลไม่สำเร็จ',
        })
      }

      // Save result
      const { data: savedResult } = await db.from('results').insert({
        lottery_id,
        draw_date: todayStr,
        top_number: scrapeRes.data.top_number || null,
        bottom_number: scrapeRes.data.bottom_number || null,
        full_number: scrapeRes.data.full_number || null,
        raw_data: scrapeRes.data,
        source_url: scrapeRes.source?.url || null,
        scraped_at: new Date().toISOString(),
      }).select().single()

      if (!savedResult) {
        return NextResponse.json({ error: 'Failed to save result' }, { status: 500 })
      }

      // Update source success
      if (scrapeRes.source) {
        await db.from('scrape_sources').update({
          last_success_at: new Date().toISOString(),
          last_error: null,
        }).eq('id', scrapeRes.source.id)
      }

      // Get lottery info
      const { data: lottery } = await db.from('lotteries').select('*').eq('id', lottery_id).single()
      if (!lottery) {
        return NextResponse.json({ success: true, result: savedResult, sends: [] })
      }

      const formatted = formatResult(lottery, savedResult)
      const sends: { channel: string; success: boolean; error?: string }[] = []

      // Send to Telegram
      const { data: settingsData } = await db.from('bot_settings').select('key, value')
      const settings: Record<string, string> = {}
      ;(settingsData || []).forEach((s: { key: string; value: string }) => { settings[s.key] = s.value })

      if (settings.telegram_bot_token && settings.telegram_admin_channel) {
        const { count } = await db.from('line_groups').select('*', { count: 'exact', head: true }).eq('is_active', true)
        const adminMsg = formatTgAdminLog(lottery, savedResult, count || 0, 0)
        const tgResult = await sendToTelegram(settings.telegram_bot_token, settings.telegram_admin_channel, adminMsg)
        sends.push({ channel: 'telegram', success: tgResult.success, error: tgResult.error })

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
      if (lineToken) {
        const { data: groups } = await db.from('line_groups').select('*').eq('is_active', true)
        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://lottobot-chi.vercel.app'

        const thaiDate = formatted.line.match(/งวดวันที่\s*(.+)/)?.[1] || todayStr
        const imageParams = new URLSearchParams({
          lottery_name: lottery.name,
          flag: lottery.flag,
          date: thaiDate,
          ...(scrapeRes.data.top_number ? { top_number: scrapeRes.data.top_number } : {}),
          ...(scrapeRes.data.bottom_number ? { bottom_number: scrapeRes.data.bottom_number } : {}),
          ...(scrapeRes.data.full_number ? { full_number: scrapeRes.data.full_number } : {}),
        })
        const imageUrl = `${baseUrl}/api/generate-image?${imageParams.toString()}`

        for (const group of (groups || []) as import('@/types').LineGroup[]) {
          if (!group.line_group_id) continue
          const startLine = Date.now()
          let lineResult = await pushImageAndText(lineToken, group.line_group_id, imageUrl, formatted.line)
          if (!lineResult.success) {
            lineResult = await pushTextMessage(lineToken, group.line_group_id, formatted.line)
          }
          sends.push({ channel: `line:${group.name}`, success: lineResult.success, error: lineResult.error })

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
        sends,
        source_url: scrapeRes.source?.url,
      })
    }

    // Add new scrape source
    const { lottery_id, url, is_primary, selector_config } = body
    if (!lottery_id || !url) {
      return NextResponse.json({ error: 'lottery_id and url required' }, { status: 400 })
    }

    // If setting as primary, unset existing primary
    if (is_primary) {
      await db.from('scrape_sources').update({ is_primary: false }).eq('lottery_id', lottery_id)
    }

    const { data, error } = await db.from('scrape_sources').insert({
      lottery_id,
      url,
      is_primary: is_primary ?? true,
      selector_config: selector_config || null,
      is_active: true,
    }).select().single()

    if (error) throw error
    return NextResponse.json({ source: data })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const db = getServiceClient()
    const body = await req.json()
    const { id, ...updates } = body

    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 })
    }

    // If setting as primary, unset others for same lottery
    if (updates.is_primary) {
      const { data: source } = await db.from('scrape_sources').select('lottery_id').eq('id', id).single()
      if (source) {
        await db.from('scrape_sources').update({ is_primary: false }).eq('lottery_id', source.lottery_id)
      }
    }

    const { data, error } = await db.from('scrape_sources').update(updates).eq('id', id).select().single()

    if (error) throw error
    return NextResponse.json({ source: data })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const db = getServiceClient()
    const id = req.nextUrl.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 })
    }

    const { error } = await db.from('scrape_sources').delete().eq('id', id)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}
