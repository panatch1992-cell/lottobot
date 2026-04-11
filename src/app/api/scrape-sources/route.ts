import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { scrapeResult, scrapeWithFallback } from '@/lib/scraper'
import { isStockLottery, getStockInfo, fetchStockLotteryResult } from '@/lib/stock-fetcher'
import { isHanoiLaosLottery, getHanoiLaosSource, browserScrape, browserFetchHTML } from '@/lib/browser-scraper'
import { ingestEvent } from '@/lib/events/orchestrator'
import { today } from '@/lib/utils'
import type { ScrapeSource } from '@/types'

// Helper: บันทึกผลแล้วยิงเข้า event pipeline
async function saveResultAndSend(
  db: ReturnType<typeof getServiceClient>,
  lotteryId: string,
  resultData: { top_number?: string; bottom_number?: string; full_number?: string },
  sourceUrl: string,
  todayStr: string,
) {
  const { data: savedResult } = await db.from('results').upsert({
    lottery_id: lotteryId,
    draw_date: todayStr,
    top_number: resultData.top_number || null,
    bottom_number: resultData.bottom_number || null,
    full_number: resultData.full_number || null,
    raw_data: resultData,
    source_url: sourceUrl,
    scraped_at: new Date().toISOString(),
  }).select().single()

  if (!savedResult) {
    return NextResponse.json({ error: 'Failed to save result' }, { status: 500 })
  }

  // Admin "fetch now" is intentionally re-dispatchable — use unique trigger_id
  // so dedup doesn't block intentional manual retries.
  const trigger_id = `admin-fetch-${lotteryId}-${todayStr}-${Date.now()}`
  const ingestRes = await ingestEvent({
    trigger_id,
    source: 'manual',
    lottery_id: lotteryId,
    draw_date: todayStr,
    round: null,
    numbers: {
      top_number: resultData.top_number || null,
      bottom_number: resultData.bottom_number || null,
      full_number: resultData.full_number || null,
    },
    metadata: { source_url: sourceUrl, actor: 'admin_fetch_now' },
  })

  return NextResponse.json({
    success: ingestRes.ok,
    result: savedResult,
    pipeline: ingestRes,
    source_url: sourceUrl,
  })
}

export async function GET(req: NextRequest) {
  try {
    const db = getServiceClient()
    const lotteryId = req.nextUrl.searchParams.get('lottery_id')

    let query = db.from('scrape_sources').select('*, lotteries(name, flag)')

    if (lotteryId) {
      query = query.eq('lottery_id', lotteryId)
    }

    const { data, error } = await query.order('is_primary', { ascending: false })

    // Get stock + browser lottery info for all active lotteries
    const { data: allLotteries } = await db.from('lotteries').select('id, name').eq('status', 'active')
    const stockMap: Record<string, { symbol: string; name: string }> = {}
    const browserMap: Record<string, { url: string; name: string }> = {}
    for (const l of allLotteries || []) {
      const stockInfo = getStockInfo(l.name)
      if (stockInfo) { stockMap[l.id] = stockInfo; continue }
      const browserInfo = getHanoiLaosSource(l.name)
      if (browserInfo) browserMap[l.id] = browserInfo
    }

    if (error) throw error
    return NextResponse.json({ sources: data || [], stockLotteries: stockMap, browserLotteries: browserMap })
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
        id: 'test', lottery_id: 'test', url,
        is_primary: true, selector_config: selector_config || null,
        is_active: true, last_success_at: null, last_error: null, created_at: '',
      }
      const result = await scrapeResult(testSource)
      return NextResponse.json({
        success: result.success,
        data: result.data,
        error: result.error,
      })
    }

    // Discover HTML — ใช้ Puppeteer เปิดหน้าเว็บแล้วส่ง HTML กลับ (สำหรับหา selectors)
    if (action === 'discover') {
      const { url } = body
      if (!url) {
        return NextResponse.json({ error: 'URL required' }, { status: 400 })
      }
      const result = await browserFetchHTML(url)
      return NextResponse.json(result)
    }

    // Test browser — ทดสอบดึงผลด้วย Puppeteer
    if (action === 'test_browser') {
      const { url, selector_config } = body
      if (!url) {
        return NextResponse.json({ error: 'URL required' }, { status: 400 })
      }
      const result = await browserScrape(url, selector_config || {})
      return NextResponse.json(result)
    }

    // Test stock — ทดสอบดึงราคาหุ้นสำหรับหวยหุ้น
    if (action === 'test_stock') {
      const { lottery_name } = body
      if (!lottery_name) {
        return NextResponse.json({ error: 'lottery_name required' }, { status: 400 })
      }
      const result = await fetchStockLotteryResult(lottery_name)
      return NextResponse.json(result)
    }

    // Manual fetch — ดึงผลตอนนี้ (stock หรือ scrape)
    if (action === 'scrape_now') {
      const { lottery_id, preview_only } = body
      if (!lottery_id) {
        return NextResponse.json({ error: 'lottery_id required' }, { status: 400 })
      }

      const todayStr = today()

      // preview_only ข้ามการเช็คผลเดิม (แค่ดึงตัวเลข ยังไม่บันทึก)
      if (!preview_only) {
      // Check existing result
      const { data: existing } = await db.from('results')
        .select('id')
        .eq('lottery_id', lottery_id)
        .eq('draw_date', todayStr)
        .maybeSingle()

      if (existing) {
        return NextResponse.json({ error: 'วันนี้มีผลแล้ว ลบผลเดิมก่อนหรือใช้หน้ากรอกผลแทน' }, { status: 400 })
      }
      } // end if (!preview_only)

      // Get lottery name
      const { data: lotteryInfo } = await db.from('lotteries').select('name').eq('id', lottery_id).single()

      // Try stock index first
      if (lotteryInfo && isStockLottery(lotteryInfo.name)) {
        const stockRes = await fetchStockLotteryResult(lotteryInfo.name)
        if (stockRes.success && stockRes.top_number) {
          if (preview_only) {
            return NextResponse.json({ success: true, result: { top_number: stockRes.top_number, bottom_number: stockRes.bottom_number }, source_url: `stock://${stockRes.symbol}` })
          }
          return saveResultAndSend(db, lottery_id, {
            top_number: stockRes.top_number,
            bottom_number: stockRes.bottom_number,
          }, `stock://${stockRes.symbol}`, todayStr)
        }
      }

      // Try browser scrape for Hanoi/Laos
      if (lotteryInfo && isHanoiLaosLottery(lotteryInfo.name)) {
        const sourceInfo = getHanoiLaosSource(lotteryInfo.name)
        if (sourceInfo) {
          const { data: browserSources } = await db.from('scrape_sources').select('selector_config').eq('lottery_id', lottery_id).eq('is_active', true).limit(1)
          const selectors = (browserSources?.[0]?.selector_config as import('@/types').SelectorConfig) || {}
          const browserRes = await browserScrape(sourceInfo.url, selectors, sourceInfo.searchName)
          if (browserRes.success && browserRes.data) {
            if (preview_only) {
              return NextResponse.json({ success: true, result: browserRes.data, source_url: `browser://${sourceInfo.url}` })
            }
            return saveResultAndSend(db, lottery_id, {
              top_number: browserRes.data.top_number,
              bottom_number: browserRes.data.bottom_number,
              full_number: browserRes.data.full_number,
            }, `browser://${sourceInfo.url}`, todayStr)
          }
          return NextResponse.json({ success: false, error: browserRes.error || 'Browser scrape ไม่สำเร็จ', html_snippet: browserRes.html_snippet })
        }
      }

      // Try CSS scrape sources
      const { data: sources } = await db.from('scrape_sources')
        .select('*')
        .eq('lottery_id', lottery_id)
        .eq('is_active', true)

      if (!sources || sources.length === 0) {
        if (lotteryInfo && isStockLottery(lotteryInfo.name)) {
          return NextResponse.json({ success: false, error: 'ดึงราคาหุ้นไม่สำเร็จ — Yahoo Finance อาจยังไม่อัปเดต' })
        }
        return NextResponse.json({ error: 'ไม่มี scrape source ที่ active อยู่' }, { status: 400 })
      }

      const scrapeRes = await scrapeWithFallback(sources as ScrapeSource[])

      if (!scrapeRes.success || !scrapeRes.data) {
        return NextResponse.json({
          success: false,
          error: scrapeRes.error || 'ดึงผลไม่สำเร็จ',
        })
      }

      // Update source success
      if (scrapeRes.source) {
        await db.from('scrape_sources').update({
          last_success_at: new Date().toISOString(),
          last_error: null,
        }).eq('id', scrapeRes.source.id)
      }

      return saveResultAndSend(db, lottery_id, {
        top_number: scrapeRes.data.top_number,
        bottom_number: scrapeRes.data.bottom_number,
        full_number: scrapeRes.data.full_number,
      }, scrapeRes.source?.url || 'scrape', todayStr)
    }

    // Add new scrape source
    const { lottery_id, url, is_primary, selector_config } = body
    if (!lottery_id || !url) {
      return NextResponse.json({ error: 'lottery_id and url required' }, { status: 400 })
    }

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
