/**
 * POST /api/admin/lucky-images/sync-huaypnk
 *
 * Scrape https://www.huaypnk.com/top → upsert เข้า lucky_images
 * ใช้ /api/lucky-image?url=... เป็น proxy URL (หลีกเลี่ยง hotlink block ของ LINE)
 *
 * Strategy:
 *   1. Try static Cheerio scrape first (fast, ~1-2s)
 *   2. If static returns 0 images → fall back to headless Puppeteer
 *      (slower ~10-30s but handles SPA rendering)
 *
 * Response:
 *   { added, skipped, failed, source: 'static'|'browser', errors?: string[] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { scrapeLuckyImages } from '@/lib/huaypnk-scraper'
import { browserScrapeHuaypnk } from '@/lib/huaypnk-browser-scraper'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
// Allow up to 60s for the headless browser cold-start + page render
export const maxDuration = 60

function hasAuthCookie(req: NextRequest): boolean {
  const allCookies = req.cookies.getAll()
  return allCookies.some(c =>
    (c.name.startsWith('sb-') && c.name.endsWith('-auth-token')) ||
    c.name === 'sb-access-token'
  )
}

function requireAuth(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '')
  if (authHeader && authHeader === process.env.CRON_SECRET) return null
  if (!hasAuthCookie(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

function hashUrl(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 32)
}

interface ScrapedLuckyImage {
  imageUrl: string
  lotteryLabel: string
  matched: boolean
}

export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  const db = getServiceClient()
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://lottobot-chi.vercel.app')

  // Allow admin to override the source URL via body or query string
  let overrideUrl: string | undefined
  try {
    const body = await req.json().catch(() => ({}))
    if (typeof body.url === 'string' && body.url.trim()) overrideUrl = body.url.trim()
  } catch { /* ignore */ }
  if (!overrideUrl) {
    const qp = req.nextUrl.searchParams.get('url')
    if (qp && qp.trim()) overrideUrl = qp.trim()
  }

  // ─── 1. Try static scraper first ──────────────────
  let images: ScrapedLuckyImage[] = []
  let source: 'static' | 'browser' = 'static'
  let browserError: string | undefined

  try {
    images = overrideUrl
      ? await scrapeLuckyImages(undefined, overrideUrl)
      : await scrapeLuckyImages()
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'scrape failed' },
      { status: 500 },
    )
  }

  // ─── 2. If static returns 0 → fall back to headless browser ──
  if (images.length === 0) {
    source = 'browser'
    try {
      const browserResult = await browserScrapeHuaypnk(overrideUrl)
      if (browserResult.error) browserError = browserResult.error
      images = browserResult.images
    } catch (err) {
      browserError = err instanceof Error ? err.message : 'browser scrape failed'
    }
  }

  if (images.length === 0) {
    return NextResponse.json({
      added: 0,
      skipped: 0,
      failed: 0,
      source,
      note: 'no images found from huaypnk (both static and browser)',
      ...(browserError && { browser_error: browserError }),
    })
  }

  let added = 0
  let skipped = 0
  let failed = 0
  const errors: string[] = []

  for (const img of images) {
    const proxiedUrl = `${baseUrl}/api/lucky-image?url=${encodeURIComponent(img.imageUrl)}`
    const hash = hashUrl(img.imageUrl)

    // Check if already exists (by source_hash)
    const { data: existing } = await db
      .from('lucky_images')
      .select('id')
      .eq('source_hash', hash)
      .maybeSingle()

    if (existing) {
      skipped++
      continue
    }

    // Infer category from label keywords
    const label = img.lotteryLabel.toLowerCase()
    let category = 'general'
    if (/ลาว|laos/.test(label)) category = 'laos'
    else if (/เวียด|vietnam|hanoi|ฮานอย/.test(label)) category = 'vietnam'
    else if (/หุ้น|stock|dow|nikkei|ดาว|นิเก|ฮั่งเส็ง|hang/.test(label)) category = 'stock'
    else if (/จีน|china/.test(label)) category = 'china'
    else if (/เกาหลี|korea/.test(label)) category = 'korea'
    else if (/ญี่ปุ่น|japan/.test(label)) category = 'japan'
    else if (/ไทย|thai/.test(label)) category = 'thai'

    const { error } = await db.from('lucky_images').insert({
      public_url: proxiedUrl,
      storage_path: proxiedUrl,
      source_url: img.imageUrl,
      source_hash: hash,
      category,
      caption: img.lotteryLabel || null,
      uploaded_by: `huaypnk-sync-${source}`,
    })

    if (error) {
      failed++
      if (errors.length < 5) errors.push(error.message)
    } else {
      added++
    }
  }

  return NextResponse.json({
    added,
    skipped,
    failed,
    source,
    url: overrideUrl || 'https://www.huaypnk.com/top',
    total_scraped: images.length,
    ...(errors.length > 0 && { errors }),
  })
}
