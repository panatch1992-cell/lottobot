import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { scrapeWithFallback } from '@/lib/scraper'
import { formatResult, formatTgAdminLog } from '@/lib/formatter'
import { sendToTelegram } from '@/lib/telegram'
import { sendLineNotify } from '@/lib/line-notify'
import { nowBangkok, today, timeToMinutes } from '@/lib/utils'
import type { Lottery, ScrapeSource, LineGroup } from '@/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Verify cron secret
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== process.env.CRON_SECRET && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getServiceClient()
  const now = nowBangkok()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const todayStr = today()

  // Get settings
  const { data: settingsData } = await db.from('bot_settings').select('key, value')
  const settings: Record<string, string> = {}
  ;(settingsData || []).forEach((s: { key: string; value: string }) => { settings[s.key] = s.value })

  // Get active lotteries that should be scraped now (within 5 min after result_time)
  const { data: lotteries } = await db.from('lotteries').select('*').eq('status', 'active')
  const activeLotteries = (lotteries || []) as Lottery[]

  const toScrape = activeLotteries.filter(l => {
    const resultMin = timeToMinutes(l.result_time)
    return nowMinutes >= resultMin && nowMinutes <= resultMin + 5
  })

  // Check which ones don't have results yet today
  const { data: existingResults } = await db.from('results').select('lottery_id').eq('draw_date', todayStr)
  const hasResult = new Set((existingResults || []).map(r => r.lottery_id))

  const needScrape = toScrape.filter(l => !hasResult.has(l.id))

  const results = []

  for (const lottery of needScrape) {
    // Get scrape sources
    const { data: sources } = await db.from('scrape_sources').select('*').eq('lottery_id', lottery.id).eq('is_active', true)

    if (!sources || sources.length === 0) continue

    const scrapeResult = await scrapeWithFallback(sources as ScrapeSource[])

    if (!scrapeResult.success || !scrapeResult.data) {
      // Log failure
      await db.from('send_logs').insert({
        lottery_id: lottery.id,
        channel: 'telegram',
        msg_type: 'result',
        status: 'failed',
        error_message: scrapeResult.error,
      })
      results.push({ lottery: lottery.name, success: false, error: scrapeResult.error })
      continue
    }

    // Save result
    const { data: savedResult } = await db.from('results').insert({
      lottery_id: lottery.id,
      draw_date: todayStr,
      top_number: scrapeResult.data.top_number || null,
      bottom_number: scrapeResult.data.bottom_number || null,
      full_number: scrapeResult.data.full_number || null,
      raw_data: scrapeResult.data,
      source_url: scrapeResult.source?.url || null,
      scraped_at: new Date().toISOString(),
    }).select().single()

    if (!savedResult) continue

    // Update scrape source last_success
    if (scrapeResult.source) {
      await db.from('scrape_sources').update({ last_success_at: new Date().toISOString(), last_error: null }).eq('id', scrapeResult.source.id)
    }

    // Format and send to Telegram
    const formatted = formatResult(lottery, savedResult)
    const startTg = Date.now()

    if (settings.telegram_bot_token && settings.telegram_admin_channel) {
      // Get line groups count for admin log
      const { count } = await db.from('line_groups').select('*', { count: 'exact', head: true }).eq('is_active', true)
      const adminMsg = formatTgAdminLog(lottery, savedResult, count || 0, 0)

      const tgResult = await sendToTelegram(settings.telegram_bot_token, settings.telegram_admin_channel, adminMsg)

      await db.from('send_logs').insert({
        lottery_id: lottery.id,
        result_id: savedResult.id,
        channel: 'telegram',
        msg_type: 'result',
        status: tgResult.success ? 'sent' : 'failed',
        sent_at: new Date().toISOString(),
        duration_ms: Date.now() - startTg,
        error_message: tgResult.error || null,
      })
    }

    // Send to LINE groups (fallback — normally n8n handles this from TG)
    if (settings.fallback_enabled === 'true' || !settings.n8n_webhook_url) {
      const { data: groups } = await db.from('line_groups').select('*').eq('is_active', true)
      for (const group of (groups || []) as LineGroup[]) {
        if (!group.line_notify_token) continue
        const startLine = Date.now()
        const lineResult = await sendLineNotify(group.line_notify_token, formatted.line)
        await db.from('send_logs').insert({
          lottery_id: lottery.id,
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

    results.push({ lottery: lottery.name, success: true })
  }

  return NextResponse.json({
    scraped: results.length,
    results,
    timestamp: new Date().toISOString(),
  })
}
