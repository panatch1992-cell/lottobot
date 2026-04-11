import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, getSettings } from '@/lib/supabase'
import { scrapeWithFallback } from '@/lib/scraper'
import { isStockLottery, fetchStockLotteryResult } from '@/lib/stock-fetcher'
import { isHanoiLaosLottery, getHanoiLaosSource, browserScrape } from '@/lib/browser-scraper'
import { nowBangkok, today, timeToMinutes, sleep } from '@/lib/utils'
import { validateCronConfig, alertConfigIssues } from '@/lib/config-guard'
import { ingestEvent } from '@/lib/events/orchestrator'
import type { Lottery, ScrapeSource } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Vercel max for hobby plan

// ─── saveAndDispatch ───────────────────────────────────
// New responsibility: ONLY save the result row + emit a LOTTERY_RESULT_READY
// event through the orchestrator. All sending, retry, breaker and logging
// live in src/lib/events/dispatcher.ts now.
async function saveAndDispatch(
  db: ReturnType<typeof getServiceClient>,
  lottery: Lottery,
  resultData: { top_number?: string; bottom_number?: string; full_number?: string },
  sourceUrl: string,
  todayStr: string,
): Promise<{ success: boolean; error?: string; dispatched?: { total: number; succeeded: number; failed: number } }> {
  try {
    const { data: savedResult, error: insertError } = await db
      .from('results')
      .upsert(
        {
          lottery_id: lottery.id,
          draw_date: todayStr,
          top_number: resultData.top_number || null,
          bottom_number: resultData.bottom_number || null,
          full_number: resultData.full_number || null,
          raw_data: resultData,
          source_url: sourceUrl,
          scraped_at: new Date().toISOString(),
        },
        { onConflict: 'lottery_id,draw_date' },
      )
      .select()
      .single()

    if (!savedResult) {
      return {
        success: false,
        error: `DB: ${insertError?.message || insertError?.code || 'insert returned null'}`,
      }
    }

    // Deterministic trigger_id per (lottery, date) — safe to collide: the
    // orchestrator uses dispatch_jobs status for authoritative dedup, not
    // trigger_id uniqueness.
    const trigger_id = `scrape-${lottery.id}-${todayStr}`

    const result = await ingestEvent({
      trigger_id,
      source: 'scrape',
      lottery_id: lottery.id,
      draw_date: todayStr,
      round: null,
      numbers: {
        top_number: resultData.top_number || null,
        bottom_number: resultData.bottom_number || null,
        full_number: resultData.full_number || null,
      },
      metadata: {
        source_url: sourceUrl,
        result_id: savedResult.id,
      },
    })

    return {
      success: result.ok,
      error: result.ok ? undefined : result.reason,
      dispatched: result.dispatched,
    }
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

  // ─── Config Guard ──────────────────────────────────────
  const configCheck = await validateCronConfig('scrape')
  if (!configCheck.ok) {
    await alertConfigIssues('scrape', configCheck.issues)
    return NextResponse.json({ error: 'Config issues', issues: configCheck.issues })
  }

  const db = getServiceClient()
  const now = nowBangkok()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const todayStr = today()

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

  // Skip lotteries where we've already successfully dispatched today
  // (dispatch_job with status='succeeded' for same lottery_id).
  const { data: succeededJobs } = await db
    .from('dispatch_jobs')
    .select('lottery_id')
    .eq('status', 'succeeded')
    .gte('created_at', `${todayStr}T00:00:00Z`)
  const alreadyDispatched = new Set((succeededJobs || []).map(r => r.lottery_id))

  // Also skip lotteries where we already have a fresh result but no send yet
  // (orchestrator will handle re-dispatch on the next pass using dispatch_jobs state).
  const { data: existingResults } = await db
    .from('results')
    .select('lottery_id')
    .eq('draw_date', todayStr)
  const hasResult = new Set((existingResults || []).map(r => r.lottery_id))

  const needFetch = inWindow.filter(l => !hasResult.has(l.id) || !alreadyDispatched.has(l.id))

  const results: { lottery: string; success: boolean; method?: string; error?: string; dispatched?: { total: number; succeeded: number; failed: number } }[] = []

  for (const lottery of needFetch) {
    // If we already have a result row but no succeeded dispatch, just re-dispatch
    // without scraping again.
    if (hasResult.has(lottery.id)) {
      const { data: existing } = await db
        .from('results')
        .select('*')
        .eq('lottery_id', lottery.id)
        .eq('draw_date', todayStr)
        .maybeSingle()
      if (existing) {
        const dispatch = await saveAndDispatch(
          db,
          lottery,
          {
            top_number: existing.top_number,
            bottom_number: existing.bottom_number,
            full_number: existing.full_number,
          },
          existing.source_url || 'scrape',
          todayStr,
        )
        results.push({
          lottery: lottery.name,
          success: dispatch.success,
          method: 'redispatch',
          error: dispatch.error,
          dispatched: dispatch.dispatched,
        })
        continue
      }
    }

    // === METHOD 1: Stock Index (หวยหุ้น) — ดึงจาก Yahoo Finance ===
    if (isStockLottery(lottery.name)) {
      const stockRes = await fetchStockLotteryResult(lottery.name)

      if (stockRes.success && stockRes.top_number) {
        const dispatch = await saveAndDispatch(
          db,
          lottery,
          {
            top_number: stockRes.top_number,
            bottom_number: stockRes.bottom_number,
          },
          `stock://${stockRes.symbol}`,
          todayStr,
        )

        results.push({
          lottery: lottery.name,
          success: dispatch.success,
          method: 'stock_index',
          error: dispatch.success ? undefined : (dispatch.error || 'dispatch failed'),
          dispatched: dispatch.dispatched,
        })
        continue
      }

      results.push({
        lottery: lottery.name,
        success: false,
        method: 'stock_index',
        error: stockRes.error,
      })
      // fall through to try scrape sources
    }

    // === METHOD 2: Browser Scrape (Hanoi/Laos) ===
    if (isHanoiLaosLottery(lottery.name)) {
      const sourceInfo = getHanoiLaosSource(lottery.name)
      if (sourceInfo) {
        const { data: browserSources } = await db
          .from('scrape_sources')
          .select('*')
          .eq('lottery_id', lottery.id)
          .eq('is_active', true)
          .limit(1)
        const selectors = (browserSources?.[0]?.selector_config as import('@/types').SelectorConfig) || {}

        const browserRes = await browserScrape(sourceInfo.url, selectors, sourceInfo.searchName)

        if (browserRes.success && browserRes.data) {
          const dispatch = await saveAndDispatch(
            db,
            lottery,
            {
              top_number: browserRes.data.top_number,
              bottom_number: browserRes.data.bottom_number,
              full_number: browserRes.data.full_number,
            },
            `browser://${sourceInfo.url}`,
            todayStr,
          )

          results.push({
            lottery: lottery.name,
            success: dispatch.success,
            method: 'browser',
            error: dispatch.success ? undefined : (dispatch.error || 'dispatch failed'),
            dispatched: dispatch.dispatched,
          })

          if (browserSources?.[0]) {
            await db
              .from('scrape_sources')
              .update({ last_success_at: new Date().toISOString(), last_error: null })
              .eq('id', browserSources[0].id)
          }
          continue
        }

        if (browserSources?.[0]) {
          await db
            .from('scrape_sources')
            .update({ last_error: `Browser: ${browserRes.error}` })
            .eq('id', browserSources[0].id)
        }
        results.push({
          lottery: lottery.name,
          success: false,
          method: 'browser',
          error: browserRes.error || 'browser scrape returned no data',
        })
      }
    }

    // === METHOD 3: Web Scraping (CSS selectors) ===
    const { data: sources } = await db
      .from('scrape_sources')
      .select('*')
      .eq('lottery_id', lottery.id)
      .eq('is_active', true)

    if (!sources || sources.length === 0) continue

    // Retry loop
    let scrapeRes: Awaited<ReturnType<typeof scrapeWithFallback>> = { success: false, error: '' }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      scrapeRes = await scrapeWithFallback(sources as ScrapeSource[])
      if (scrapeRes.success) break

      for (const src of sources as ScrapeSource[]) {
        await db
          .from('scrape_sources')
          .update({ last_error: `Attempt ${attempt}: ${scrapeRes.error}` })
          .eq('id', src.id)
      }

      if (attempt < maxRetries) await sleep(retryDelayMs)
    }

    if (!scrapeRes.success || !scrapeRes.data) {
      results.push({ lottery: lottery.name, success: false, method: 'scrape', error: scrapeRes.error })
      continue
    }

    if (scrapeRes.source) {
      await db
        .from('scrape_sources')
        .update({ last_success_at: new Date().toISOString(), last_error: null })
        .eq('id', scrapeRes.source.id)
    }

    const dispatch = await saveAndDispatch(
      db,
      lottery,
      {
        top_number: scrapeRes.data.top_number,
        bottom_number: scrapeRes.data.bottom_number,
        full_number: scrapeRes.data.full_number,
      },
      scrapeRes.source?.url || 'scrape',
      todayStr,
    )

    results.push({
      lottery: lottery.name,
      success: dispatch.success,
      method: 'scrape',
      error: dispatch.error,
      dispatched: dispatch.dispatched,
    })
  }

  return NextResponse.json({
    fetched: results.length,
    total_in_window: inWindow.length,
    already_dispatched_today: alreadyDispatched.size,
    results,
    timestamp: new Date().toISOString(),
  })
}
