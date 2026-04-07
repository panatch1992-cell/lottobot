import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, getSettings } from '@/lib/supabase'
import { scrapeWithFallback } from '@/lib/scraper'
import { isStockLottery, fetchStockLotteryResult } from '@/lib/stock-fetcher'
import { isHanoiLaosLottery, getHanoiLaosSource, browserScrape } from '@/lib/browser-scraper'
import { formatResult, formatTgAdminLog } from '@/lib/formatter'
import { sendToTelegram } from '@/lib/telegram'
import { pushTextMessage, pushImageAndText, broadcastImageAndText, broadcastText, checkLineQuota, flagMonthlyLimitHit } from '@/lib/messaging-service'
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
  try {
  // Save result
  const { data: savedResult, error: insertError } = await db.from('results').upsert({
    lottery_id: lottery.id,
    draw_date: todayStr,
    top_number: resultData.top_number || null,
    bottom_number: resultData.bottom_number || null,
    full_number: resultData.full_number || null,
    raw_data: resultData,
    source_url: sourceUrl,
    scraped_at: new Date().toISOString(),
  }, { onConflict: 'lottery_id,draw_date' }).select().single()

  if (!savedResult) return { success: false, error: `DB: ${insertError?.message || insertError?.code || 'insert returned null'}` }

  // Check if already sent OR recently failed (prevent infinite retry)
  const { data: existingLogs } = await db.from('send_logs')
    .select('channel, status, error_message, line_group_id')
    .eq('result_id', savedResult.id)

  const alreadySentTG = existingLogs?.some(l => l.channel === 'telegram' && l.status === 'sent')

  // Per-group tracking: which groups already sent or hit monthly limit
  const sentLineGroupIds = new Set(
    (existingLogs || [])
      .filter(l => l.channel === 'line' && l.status === 'sent' && l.line_group_id)
      .map(l => l.line_group_id)
  )
  const limitLineGroupIds = new Set(
    (existingLogs || [])
      .filter(l => l.channel === 'line' && l.error_message?.includes('monthly limit') && l.line_group_id)
      .map(l => l.line_group_id)
  )

  // Format
  const formatted = formatResult(lottery, savedResult)

  // Send to Telegram (skip if already sent)
  if (!alreadySentTG && settings.telegram_bot_token && settings.telegram_admin_channel) {
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

  // Send to LINE
  const lineToken = settings.line_channel_access_token
  const sendMode = settings.line_send_mode || 'push' // 'push' (ส่งทีละกลุ่ม) หรือ 'broadcast' (ส่งถึงเพื่อนทุกคน)

  // Global quota check
  const lineQuota = lineToken ? await checkLineQuota() : null
  if (lineToken && lineQuota && !lineQuota.canSend) {
    // ไม่ส่ง LINE แต่ยังบันทึกผลได้
  }

  if (lineToken && lineQuota?.canSend) {
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

    // ═══ BROADCAST MODE: ส่งครั้งเดียวถึงเพื่อนทุกคน (ประหยัด quota) ═══
    if (sendMode === 'broadcast') {
      const alreadyBroadcast = existingLogs?.some(l => l.channel === 'line' && l.status === 'sent' && !l.line_group_id)
      if (!alreadyBroadcast) {
        const startLine = Date.now()
        let lineResult = await broadcastImageAndText(lineToken, imageUrl, formatted.line)
        if (!lineResult.success) {
          if (lineResult.error?.includes('monthly limit')) {
            await flagMonthlyLimitHit()
          } else {
            lineResult = await broadcastText(lineToken, formatted.line)
            if (!lineResult.success && lineResult.error?.includes('monthly limit')) {
              await flagMonthlyLimitHit()
            }
          }
        }
        await db.from('send_logs').insert({
          lottery_id: lottery.id,
          result_id: savedResult.id,
          channel: 'line',
          msg_type: 'result',
          status: lineResult.success ? 'sent' : 'failed',
          sent_at: new Date().toISOString(),
          duration_ms: Date.now() - startLine,
          error_message: lineResult.error || null,
        })
      }
    }

    // ═══ PUSH MODE: ส่งทีละกลุ่ม (รองรับ per-group customization) ═══
    if (sendMode === 'push') {
    const { data: groups } = await db.from('line_groups').select('*').eq('is_active', true)

    // Get group-lottery mapping for selective sending
    const { data: allGroupLotteries } = await db.from('group_lotteries').select('group_id, lottery_id')
    const groupLotteryMap = new Map<string, Set<string>>()
    for (const gl of allGroupLotteries || []) {
      if (!groupLotteryMap.has(gl.group_id)) groupLotteryMap.set(gl.group_id, new Set())
      groupLotteryMap.get(gl.group_id)!.add(gl.lottery_id)
    }

    for (const group of (groups || []) as (LineGroup & { send_all_lotteries?: boolean; custom_link?: string; custom_message?: string })[]) {
      if (!group.line_group_id) continue

      // Per-group: skip if already sent or hit monthly limit
      if (sentLineGroupIds.has(group.id)) continue
      if (limitLineGroupIds.has(group.id)) continue

      // Check if this group should receive this lottery
      const sendAll = group.send_all_lotteries !== false
      if (!sendAll) {
        const allowedLotteries = groupLotteryMap.get(group.id)
        if (!allowedLotteries || !allowedLotteries.has(lottery.id)) continue
      }

      // Build message with optional custom link/message
      let lineMsg = formatted.line
      if (group.custom_message) lineMsg += `\n${group.custom_message}`
      if (group.custom_link) lineMsg += `\n🔗 ${group.custom_link}`

      const startLine = Date.now()
      const unofficialId = (group as unknown as { unofficial_group_id?: string }).unofficial_group_id || ''
      const officialId = group.line_group_id || ''
      const primaryId = unofficialId || officialId  // unofficial first, fallback official
      let lineResult = await pushImageAndText(lineToken, primaryId, imageUrl, lineMsg, officialId)
      if (!lineResult.success) {
        if (lineResult.error?.includes('monthly limit')) {
          await flagMonthlyLimitHit()
        } else {
          lineResult = await pushTextMessage(lineToken, primaryId, lineMsg, officialId)
          if (!lineResult.success && lineResult.error?.includes('monthly limit')) {
            await flagMonthlyLimitHit()
          }
        }
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

      // Random delay between groups to look natural (2-5 seconds)
      await sleep(2000 + Math.floor(Math.random() * 3000))
    }
    } // end push mode
  }

  return { success: true }
  } catch (err) {
    return { success: false, error: `Exception: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export async function GET(req: NextRequest) {
  // Verify cron secret
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  const testMode = req.nextUrl.searchParams.get('test') === '1'
  if (!testMode && secret !== process.env.CRON_SECRET && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getServiceClient()
  const now = nowBangkok()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const todayStr = today()

  // Get settings via REST API (bypasses Supabase JS client empty-string bug)
  const settings = await getSettings()

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
          error: saveRes.success ? undefined : (saveRes.error || 'Save/send failed'),
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
            error: saveRes.success ? undefined : (saveRes.error || 'save failed'),
          })

          if (browserSources?.[0]) {
            await db.from('scrape_sources').update({ last_success_at: new Date().toISOString(), last_error: null }).eq('id', browserSources[0].id)
          }
          continue
        }

        // Browser failed
        if (browserSources?.[0]) {
          await db.from('scrape_sources').update({ last_error: `Browser: ${browserRes.error}` }).eq('id', browserSources[0].id)
        }
        results.push({ lottery: lottery.name, success: false, method: 'browser', error: browserRes.error || 'browser scrape returned no data' })
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
