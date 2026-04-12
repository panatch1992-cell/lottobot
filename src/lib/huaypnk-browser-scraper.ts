/**
 * huaypnk-browser-scraper.ts
 *
 * Headless-browser fallback for huaypnk.com/top.
 *
 * Problem: huaypnk.com/top is a SPA — the initial HTML contains no
 * <img> tags because images are rendered by JavaScript after page
 * load. Cheerio (static parser) sees 0 images.
 *
 * Solution: use Puppeteer + Chromium to actually render the page,
 * wait for the network to settle, then extract <img> src attributes
 * from the live DOM.
 *
 * This file mirrors the pattern in src/lib/browser-scraper.ts
 * (same Chromium binary, same launch args, same CDN download URL).
 *
 * Cold start cost: ~10-15 seconds (Chromium download + launch).
 * Subsequent runs on the same warm instance: ~3-5 seconds.
 *
 * Only used by:
 *   - /api/admin/lucky-images/sync-huaypnk (fallback after static scrape)
 *   - /api/admin/lucky-images/debug-huaypnk (diagnostic)
 *
 * Not used in runtime hot-path — the dispatcher always reads from DB.
 */

import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium-min'

const CHROMIUM_PACK_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v143.0.4/chromium-v143.0.4-pack.x64.tar'

const HUAYPNK_TOP_URL = 'https://www.huaypnk.com/top'
const HUAYPNK_ORIGIN = 'https://www.huaypnk.com'

export interface BrowserScrapedImage {
  imageUrl: string
  lotteryLabel: string
  matched: boolean
}

export interface BrowserScrapeDebug {
  pageTitle: string
  bodyTextLength: number
  totalImgs: number
  withSrc: number
  accepted: number
  sampleSrcs: Array<{ src: string; accepted: boolean; reason: string }>
}

function looksLikeContentImage(src: string): { ok: boolean; reason: string } {
  if (!src) return { ok: false, reason: 'empty' }
  const lower = src.toLowerCase()
  if (lower.startsWith('data:')) return { ok: false, reason: 'data-uri' }
  if (lower.includes('logo')) return { ok: false, reason: 'logo' }
  if (lower.includes('icon')) return { ok: false, reason: 'icon' }
  if (lower.includes('favicon')) return { ok: false, reason: 'favicon' }
  if (lower.includes('banner')) return { ok: false, reason: 'banner' }
  if (lower.includes('sprite')) return { ok: false, reason: 'sprite' }
  if (lower.includes('avatar')) return { ok: false, reason: 'avatar' }

  if (lower.match(/\.(jpe?g|png|webp|gif|avif)(\?[^#]*)?(#.*)?$/i)) {
    return { ok: true, reason: 'ext' }
  }
  if (lower.includes('/storage/')) return { ok: true, reason: 'storage' }
  if (lower.includes('/uploads/')) return { ok: true, reason: 'uploads' }
  if (lower.includes('/img/')) return { ok: true, reason: 'img' }
  if (lower.includes('/images/')) return { ok: true, reason: 'images' }
  if (lower.includes('/media/')) return { ok: true, reason: 'media' }
  if (lower.includes('/cdn/')) return { ok: true, reason: 'cdn' }
  if (lower.includes('/assets/')) return { ok: true, reason: 'assets' }
  if (lower.includes('/files/')) return { ok: true, reason: 'files' }
  if (lower.includes('/public/')) return { ok: true, reason: 'public' }
  if (lower.includes('/_next/image')) return { ok: true, reason: 'next-image' }
  return { ok: false, reason: 'no-match' }
}

function makeAbsolute(src: string, base: string): string {
  if (!src) return ''
  if (src.startsWith('http')) return src
  if (src.startsWith('//')) return `https:${src}`
  try {
    return new URL(src, base).href
  } catch {
    if (src.startsWith('/')) return `${HUAYPNK_ORIGIN}${src}`
    return `${HUAYPNK_ORIGIN}/${src}`
  }
}

/**
 * Launch Chromium, render huaypnk.com/top, extract <img> src attributes,
 * and close the browser.
 *
 * @param sourceUrl override the page URL (default huaypnk.com/top)
 * @returns { images: [...], debug: {...} }
 */
export async function browserScrapeHuaypnk(
  sourceUrl: string = HUAYPNK_TOP_URL,
): Promise<{ images: BrowserScrapedImage[]; debug: BrowserScrapeDebug | null; error?: string }> {
  let browser = null

  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1280, height: 720 },
      executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
      headless: 'shell',
    })

    const page = await browser.newPage()
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    )
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
    })

    // Navigate and wait for network to settle (SPA needs this)
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 30000 })

    // Extra wait: some SPAs lazy-load images after initial render
    await new Promise(r => setTimeout(r, 2000))

    // Trigger any lazy loads by scrolling to the bottom
    await page
      .evaluate(async () => {
        const step = 400
        const max = document.body.scrollHeight
        for (let y = 0; y < max; y += step) {
          window.scrollTo(0, y)
          await new Promise(r => setTimeout(r, 100))
        }
      })
      .catch(() => {})

    await new Promise(r => setTimeout(r, 1000))

    // Pull every image src + nearest label text from the live DOM
    const extracted = await page.evaluate(() => {
      const out: Array<{ src: string; label: string }> = []
      const imgs = Array.from(document.querySelectorAll('img')) as HTMLImageElement[]

      for (const img of imgs) {
        const src =
          img.currentSrc ||
          img.src ||
          img.getAttribute('data-src') ||
          img.getAttribute('data-lazy-src') ||
          img.getAttribute('data-original') ||
          ''

        // Find nearest heading/title/label in ancestor chain
        let label = ''
        let node: Element | null = img.parentElement
        for (let depth = 0; depth < 5 && node; depth++) {
          const heading = node.querySelector('h1,h2,h3,h4,h5,h6')
          if (heading && heading.textContent) {
            label = heading.textContent.trim()
            break
          }
          const titled = node.querySelector(
            '[class*="title"],[class*="name"],[class*="label"],[class*="header"],[class*="caption"]',
          )
          if (titled && titled.textContent) {
            label = titled.textContent.trim()
            break
          }
          node = node.parentElement
        }

        if (!label) {
          label = img.alt || img.title || ''
        }

        out.push({ src: src.trim(), label: label.trim() })
      }

      const pageTitle = document.title || ''
      const bodyTextLength = (document.body && document.body.innerText)
        ? document.body.innerText.length
        : 0

      return { out, pageTitle, bodyTextLength }
    })

    const { out: raw, pageTitle, bodyTextLength } = extracted
    const totalImgs = raw.length
    const withSrc = raw.filter(r => r.src).length

    const seen = new Set<string>()
    const images: BrowserScrapedImage[] = []
    const sampleSrcs: BrowserScrapeDebug['sampleSrcs'] = []

    for (const { src, label } of raw) {
      if (!src) continue
      const check = looksLikeContentImage(src)
      if (sampleSrcs.length < 20) {
        sampleSrcs.push({ src: src.slice(0, 200), accepted: check.ok, reason: check.reason })
      }
      if (!check.ok) continue

      const absolute = makeAbsolute(src, sourceUrl)
      if (!absolute || seen.has(absolute)) continue
      seen.add(absolute)
      images.push({
        imageUrl: absolute,
        lotteryLabel: label,
        matched: false,
      })
    }

    const debug: BrowserScrapeDebug = {
      pageTitle,
      bodyTextLength,
      totalImgs,
      withSrc,
      accepted: images.length,
      sampleSrcs,
    }

    return { images, debug }
  } catch (err) {
    return {
      images: [],
      debug: null,
      error: err instanceof Error ? err.message : 'browser scrape failed',
    }
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}
