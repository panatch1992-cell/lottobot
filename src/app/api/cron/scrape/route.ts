import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { scrapeWithFallback } from '@/lib/scraper'
import { formatResult, formatTgAdminLog } from '@/lib/formatter'
import { sendToTelegram } from '@/lib/telegram'
import { pushTextMessage, pushImageAndText } from '@/lib/line-messaging'
import { nowBangkok, today, timeToMinutes, sleep } from '@/lib/utils'
import type { Lottery, ScrapeSource, LineGroup } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Vercel max for hobby plan

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

  const scrapeWindowMinutes = parseInt(settings.scrape_window_minutes || '30', 10)
  const maxRetries = parseInt(settings.scrape_max_retries || '3', 10)
  const retryDelayMs = parseInt(settings.scrape_retry_delay_ms || '10000', 10)

  // Get active lotteries within scrape window (result_time to result_time + window)
  const { data: lotteries } = await db.from('lotteries').select('*').eq('status', 'active')
  const activeLotteries = (lotteries || []) as Lottery[]

  const toScrape = activeLotteries.filter(l => {
    const resultMin = timeToMinutes(l.result_time)
    return nowMinutes >= resultMin && nowMinutes <= resultMin + scrapeWindowMinutes
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

    // Retry logic — try multiple times with delay
    let scrapeRes: Awaited<ReturnType<typeof scrapeWithFallback>> = { success: false, error: '' }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      scrapeRes = await scrapeWithFallback(sources as ScrapeSource[])
      if (scrapeRes.success) break

      // Update source with last error
      for (const src of sources as ScrapeSource[]) {
        await db.from('scrape_sources').update({
          last_error: `Attempt ${attempt}: ${scrapeRes.error}`,
        }).eq('id', src.id)
      }

      if (attempt < maxRetries) {
        await sleep(retryDelayMs)
      }
    }

    if (!scrapeRes.success || !scrapeRes.data) {
      // Log failure
      await db.from('send_logs').insert({
        lottery_id: lottery.id,
        channel: 'telegram',
        msg_type: 'result',
        status: 'failed',
        error_message: `Scrape failed after ${maxRetries} attempts: ${scrapeRes.error}`,
      })
      results.push({ lottery: lottery.name, success: false, error: scrapeRes.error })
      continue
    }

    // Save result
    const { data: savedResult } = await db.from('results').insert({
      lottery_id: lottery.id,
      draw_date: todayStr,
      top_number: scrapeRes.data.top_number || null,
      bottom_number: scrapeRes.data.bottom_number || null,
      full_number: scrapeRes.data.full_number || null,
      raw_data: scrapeRes.data,
      source_url: scrapeRes.source?.url || null,
      scraped_at: new Date().toISOString(),
    }).select().single()

    if (!savedResult) continue

    // Update scrape source last_success
    if (scrapeRes.source) {
      await db.from('scrape_sources').update({ last_success_at: new Date().toISOString(), last_error: null }).eq('id', scrapeRes.source.id)
    }

    // Format and send to Telegram
    const formatted = formatResult(lottery, savedResult)
    const startTg = Date.now()

    if (settings.telegram_bot_token && settings.telegram_admin_channel) {
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

    // Send to LINE groups via Messaging API
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

      for (const group of (groups || []) as LineGroup[]) {
        if (!group.line_group_id) continue
        const startLine = Date.now()
        let lineResult = await pushImageAndText(lineToken, group.line_group_id, imageUrl, formatted.line)
        if (!lineResult.success) {
          lineResult = await pushTextMessage(lineToken, group.line_group_id, formatted.line)
        }
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
    skipped_no_sources: toScrape.filter(l => !hasResult.has(l.id)).length - needScrape.length,
    total_in_window: toScrape.length,
    results,
    timestamp: new Date().toISOString(),
  })
}
