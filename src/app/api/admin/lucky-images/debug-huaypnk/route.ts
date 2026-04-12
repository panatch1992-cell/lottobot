/**
 * GET /api/admin/lucky-images/debug-huaypnk
 *
 * Diagnostic endpoint for the huaypnk scraper.
 * Returns raw details of what the scraper sees — useful when sync
 * returns 0 images and we need to figure out why.
 *
 * Response shape:
 *   {
 *     ok, httpStatus, contentLength,
 *     imgTotal, imgWithSrc, imgFiltered, imgAccepted,
 *     sampleSrcs: [{src, reason}],
 *     acceptedImages: [{url, label}]
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { browserScrapeHuaypnk } from '@/lib/huaypnk-browser-scraper'

export const dynamic = 'force-dynamic'
// Browser scrape needs up to 60s on cold start
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

const HUAYPNK_TOP_URL = 'https://www.huaypnk.com/top'
const SCRAPER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function classifySrc(src: string): { accepted: boolean; reason: string } {
  if (!src) return { accepted: false, reason: 'empty src' }
  const lower = src.toLowerCase()

  // Skip icons/logos/etc
  if (lower.includes('logo')) return { accepted: false, reason: 'logo' }
  if (lower.includes('icon')) return { accepted: false, reason: 'icon' }
  if (lower.includes('favicon')) return { accepted: false, reason: 'favicon' }
  if (lower.includes('banner')) return { accepted: false, reason: 'banner' }
  if (lower.includes('sprite')) return { accepted: false, reason: 'sprite' }
  if (lower.includes('avatar')) return { accepted: false, reason: 'avatar' }

  // Accept: known image extensions (broader set)
  if (lower.match(/\.(jpe?g|png|webp|gif|avif)(\?[^#]*)?(#.*)?$/i)) {
    return { accepted: true, reason: 'file extension' }
  }
  // Accept: known content paths
  if (lower.includes('/storage/')) return { accepted: true, reason: 'storage path' }
  if (lower.includes('/uploads/')) return { accepted: true, reason: 'uploads path' }
  if (lower.includes('/img/')) return { accepted: true, reason: 'img path' }
  if (lower.includes('/images/')) return { accepted: true, reason: 'images path' }
  if (lower.includes('/media/')) return { accepted: true, reason: 'media path' }
  if (lower.includes('/cdn/')) return { accepted: true, reason: 'cdn path' }
  if (lower.includes('/assets/')) return { accepted: true, reason: 'assets path' }
  if (lower.includes('/files/')) return { accepted: true, reason: 'files path' }
  if (lower.includes('/public/')) return { accepted: true, reason: 'public path' }

  return { accepted: false, reason: 'no match' }
}

export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  const url = req.nextUrl.searchParams.get('url') || HUAYPNK_TOP_URL
  const mode = req.nextUrl.searchParams.get('mode') || 'auto'

  // ─── Browser-only mode ──────────────────────────────
  // ?mode=browser → bypass static scrape, go straight to Puppeteer
  if (mode === 'browser') {
    const t0 = Date.now()
    const result = await browserScrapeHuaypnk(url)
    return NextResponse.json({
      mode: 'browser',
      url,
      latencyMs: Date.now() - t0,
      ok: result.images.length > 0,
      error: result.error,
      debug: result.debug,
      acceptedImages: result.images.slice(0, 10).map(i => ({
        url: i.imageUrl.slice(0, 200),
        label: i.lotteryLabel.slice(0, 80),
      })),
      imgAccepted: result.images.length,
    })
  }

  // ── Fetch the page ──
  let httpStatus = 0
  let contentLength = 0
  let html = ''
  let fetchError: string | undefined
  const start = Date.now()

  try {
    const res = await axios.get<string>(url, {
      timeout: 15000,
      headers: {
        'User-Agent': SCRAPER_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://www.huaypnk.com/',
        'Cache-Control': 'no-cache',
      },
      validateStatus: () => true, // don't throw on 4xx/5xx
    })
    httpStatus = res.status
    html = res.data as string
    contentLength = typeof html === 'string' ? html.length : 0
  } catch (err) {
    fetchError = err instanceof Error ? err.message : String(err)
  }

  const latencyMs = Date.now() - start

  if (fetchError || !html) {
    return NextResponse.json({
      ok: false,
      url,
      latencyMs,
      httpStatus,
      contentLength,
      fetchError: fetchError || 'empty response',
      note: 'Fetch failed — huaypnk may be blocking Vercel IP or network issue',
    })
  }

  // ── Parse + classify every <img> ──
  const $ = cheerio.load(html)
  const imgElements = $('img')
  const imgTotal = imgElements.length

  const sampleSrcs: Array<{ src: string; reason: string; accepted: boolean }> = []
  const acceptedImages: Array<{ url: string; label: string }> = []
  let imgWithSrc = 0
  let imgAccepted = 0

  imgElements.each((_, el) => {
    const src = (
      $(el).attr('src') ||
      $(el).attr('data-src') ||
      $(el).attr('data-lazy-src') ||
      $(el).attr('data-original') ||
      ''
    ).trim()

    if (!src) return
    imgWithSrc++

    const { accepted, reason } = classifySrc(src)
    if (sampleSrcs.length < 20) {
      sampleSrcs.push({ src: src.slice(0, 200), reason, accepted })
    }

    if (accepted) {
      imgAccepted++
      // Extract label (same logic as main scraper)
      let label = ''
      const el$ = $(el)
      let node = el$.parent()
      for (let depth = 0; depth < 4 && node.length; depth++) {
        const heading = node.find('h1,h2,h3,h4,h5,h6').first().text().trim()
        if (heading) { label = heading; break }
        const titled = node.find('[class*="title"],[class*="name"],[class*="label"],[class*="header"],[class*="caption"]').first().text().trim()
        if (titled) { label = titled; break }
        node = node.parent()
      }
      if (!label) {
        label = el$.attr('alt') || el$.attr('title') || ''
      }
      if (acceptedImages.length < 10) {
        acceptedImages.push({ url: src.slice(0, 200), label: label.slice(0, 80) })
      }
    }
  })

  // Also probe for CSS background-image references (modern sites use these)
  const bgImagePattern = /background-image\s*:\s*url\(['"]?([^'")]+)['"]?\)/gi
  const bgMatches: string[] = []
  const styleAttrs = $('[style]').toArray()
  for (const el of styleAttrs) {
    const style = $(el).attr('style') || ''
    let m
    while ((m = bgImagePattern.exec(style)) !== null) {
      bgMatches.push(m[1].slice(0, 200))
      if (bgMatches.length >= 10) break
    }
    if (bgMatches.length >= 10) break
  }

  return NextResponse.json({
    ok: imgAccepted > 0,
    url,
    latencyMs,
    httpStatus,
    contentLength,
    imgTotal,
    imgWithSrc,
    imgAccepted,
    acceptedImages,
    sampleSrcs,
    bgImageHints: bgMatches,
    htmlSnippet: html.slice(0, 500),
  })
}
