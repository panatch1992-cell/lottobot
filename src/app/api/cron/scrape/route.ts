import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { scrapeWithFallback } from '@/lib/scraper'
import { isStockLottery, fetchStockLotteryResult } from '@/lib/stock-fetcher'
import { isHanoiLaosLottery, getHanoiLaosSource, browserScrape } from '@/lib/browser-scraper'
import { formatResult, formatTgAdminLog } from '@/lib/formatter'
import { sendToTelegram } from '@/lib/telegram'
import { pushTextMessage, pushImageAndText } from '@/lib/line-messaging'
import { nowBangkok, today, timeToMinutes, sleep } from '@/lib/utils'
import type { Lottery, ScrapeSource, LineGroup } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Vercel max for hobby plan

// Helper: บันทึกผล + ส่ง TG/LINE
async function saveAndSend(
  db: ReturnType<typeof getServiceClient>,
  lottery: Lottery,
  resultData: { top_number?: string; bottom_number?: string; full_number?: string },
  sourceUrl: string,
  settings: Record<string, string>,
  todayStr: string,
) {
  // Save result
  const { data: savedResult } = await db.from('results').insert({
    lottery_id: lottery.id,
    draw_date: todayStr,
    top_number: resultData.top_number || null,
    bottom_number: resultData.bottom_number || null,
    full_number: resultData.full_number || null,
    raw_data: resultData,
    source_url: sourceUrl,
    scraped_at: new Date().toISOString(),
  }).select().single()

  if (!savedResult) return { success: false, error: 'Failed to save result' }

  // Format
  const formatted = formatResult(lottery, savedResult)

  // Send to Telegram
  if (settings.telegram_bot_token && settings.telegram_admin_channel) {
    const { count } = await db.from('line_groups').select('*', { count: 'exact', head: true }).eq('is_active', true)
    const adminMsg = formatTgAdminLog(lottery, savedResult, count || 0, 0)
    const startTg = Date.now()
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

  // Send to LINE groups (emoji text + sticker image)
  const lineToken = settings.line_channel_access_token
  if (lineToken) {
    const { data: groups } = await db.from('line_groups').select('*').eq('is_active', true)
    const thaiDate = formatted.line.match(/งวดวันที่\s*(.+)/)?.[1] || todayStr

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://lottobot-chi.vercel.app'
    const imageParams = new URLSearchParams({
      lottery_name: lottery.name, flag: lottery.flag, date: thaiDate,
      ...(resultData.top_number ? { top_number: resultData.top_number } : {}),
      ...(resultData.bottom_number ? { bottom_number: resultData.bottom_number } : {}),
      ...(resultData.full_number ? { full_number: resultData.full_number } : {}),
      theme: settings.default_theme || 'shopee',
      font_style: settings.default_font_style || 'rounded',
      digit_size: settings.default_digit_size || 'm',
      layout: settings.default_layout || 'horizontal',
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

  return { success: true }
}

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

  // Get active lotteries within scrape window
  const { data: lotteries } = await db.from('lotteries').select('*').eq('status', 'active')
  const activeLotteries = (lotteries || []) as Lottery[]

  const inWindow = activeLotteries.filter(l => {
    const resultMin = timeToMinutes(l.result_time)
    return nowMinutes >= resultMin && nowMinutes <= resultMin + scrapeWindowMinutes
  })

  // Check which ones don't have results yet today
  const { data: existingResults } = await db.from('results').select('lottery_id').eq('draw_date', todayStr)
  const hasResult = new Set((existingResults || []).map(r => r.lottery_id))

  const needFetch = inWindow.filter(l => !hasResult.has(l.id))

  const results: { lottery: string; success: boolean; method?: string; error?: string }[] = []

  for (const lottery of needFetch) {
    // === METHOD 1: Stock Index (หวยหุ้น) — ดึงจาก Yahoo Finance ===
    if (isStockLottery(lottery.name)) {
      const stockRes = await fetchStockLotteryResult(lottery.name)

      if (stockRes.success && stockRes.top_number) {
        const saveRes = await saveAndSend(db, lottery, {
          top_number: stockRes.top_number,
          bottom_number: stockRes.bottom_number,
        }, `stock://${stockRes.symbol}`, settings, todayStr)

        results.push({
          lottery: lottery.name,
          success: saveRes.success,
          method: 'stock_index',
          error: saveRes.success ? undefined : 'Save/send failed',
        })
        continue
      }

      // Stock fetch failed — fall through to try scrape sources
      results.push({
        lottery: lottery.name,
        success: false,
        method: 'stock_index',
        error: stockRes.error,
      })
      // Don't continue — try scrape sources as fallback
    }

    // === METHOD 2: Browser Scrape (Hanoi/Laos — Puppeteer bypass Cloudflare) ===
    if (isHanoiLaosLottery(lottery.name)) {
      const sourceInfo = getHanoiLaosSource(lottery.name)
      if (sourceInfo) {
        // Get selectors from scrape_sources table (if configured)
        const { data: browserSources } = await db.from('scrape_sources').select('*').eq('lottery_id', lottery.id).eq('is_active', true).limit(1)
        const selectors = (browserSources?.[0]?.selector_config as import('@/types').SelectorConfig) || {}

        const browserRes = await browserScrape(sourceInfo.url, selectors, sourceInfo.searchName)

        if (browserRes.success && browserRes.data) {
          const saveRes = await saveAndSend(db, lottery, {
            top_number: browserRes.data.top_number,
            bottom_number: browserRes.data.bottom_number,
            full_number: browserRes.data.full_number,
          }, `browser://${sourceInfo.url}`, settings, todayStr)

          results.push({
            lottery: lottery.name,
            success: saveRes.success,
            method: 'browser',
          })

          // Update scrape source success if exists
          if (browserSources?.[0]) {
            await db.from('scrape_sources').update({ last_success_at: new Date().toISOString(), last_error: null }).eq('id', browserSources[0].id)
          }
          continue
        }

        // Browser failed — log and try CSS fallback
        if (browserSources?.[0]) {
          await db.from('scrape_sources').update({ last_error: `Browser: ${browserRes.error}` }).eq('id', browserSources[0].id)
        }
        results.push({ lottery: lottery.name, success: false, method: 'browser', error: browserRes.error })
        // Fall through to CSS scrape
      }
    }

    // === METHOD 3: Web Scraping (CSS selectors — axios) ===
    const { data: sources } = await db.from('scrape_sources').select('*').eq('lottery_id', lottery.id).eq('is_active', true)

    if (!sources || sources.length === 0) {
      continue
    }

    // Retry logic
    let scrapeRes: Awaited<ReturnType<typeof scrapeWithFallback>> = { success: false, error: '' }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      scrapeRes = await scrapeWithFallback(sources as ScrapeSource[])
      if (scrapeRes.success) break

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
      await db.from('send_logs').insert({
        lottery_id: lottery.id,
        channel: 'telegram',
        msg_type: 'result',
        status: 'failed',
        error_message: `Scrape failed after ${maxRetries} attempts: ${scrapeRes.error}`,
      })
      results.push({ lottery: lottery.name, success: false, method: 'scrape', error: scrapeRes.error })
      continue
    }

    // Update scrape source success
    if (scrapeRes.source) {
      await db.from('scrape_sources').update({ last_success_at: new Date().toISOString(), last_error: null }).eq('id', scrapeRes.source.id)
    }

    const saveRes = await saveAndSend(db, lottery, {
      top_number: scrapeRes.data.top_number,
      bottom_number: scrapeRes.data.bottom_number,
      full_number: scrapeRes.data.full_number,
    }, scrapeRes.source?.url || 'scrape', settings, todayStr)

    results.push({
      lottery: lottery.name,
      success: saveRes.success,
      method: 'scrape',
    })
  }

  return NextResponse.json({
    fetched: results.length,
    total_in_window: inWindow.length,
    already_have_result: inWindow.length - needFetch.length,
    results,
    timestamp: new Date().toISOString(),
  })
}
