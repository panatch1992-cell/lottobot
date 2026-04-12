/**
 * huaypnk-scraper.ts
 *
 * ดึงรูปเลขเด็ด/สุ่มจาก https://www.huaypnk.com/top (หรือ URL อื่นที่ระบุ)
 * แล้วจับคู่กับชื่อหวยที่ส่งมา (ถ้าไม่พบ → สุ่มจากทั้งหมด)
 *
 * ใช้ axios + cheerio (มีอยู่แล้วใน project)
 *
 * มี in-memory cache (TTL) เพื่อหลีกเลี่ยงการ re-scrape ซ้ำ ๆ ภายในรอบสั้น ๆ
 * — เหมาะกับกรณีหลายหวย/หลายกลุ่มออกผลในเวลาใกล้กัน
 */

import axios from 'axios'
import * as cheerio from 'cheerio'

const HUAYPNK_TOP_URL = 'https://www.huaypnk.com/top'
const HUAYPNK_ORIGIN = 'https://www.huaypnk.com'
const FETCH_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 60_000 // 60 วินาที

const SCRAPER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export interface LuckyImageResult {
  imageUrl: string   // absolute URL (https://...)
  lotteryLabel: string  // ชื่อหวยที่ฝั่งเว็บใช้ (อาจเป็น '' ถ้าหาไม่เจอ)
  matched: boolean   // true ถ้าชื่อตรงกับ lotteryName ที่ขอ
}

// ─── In-memory cache (per warm serverless instance) ──────
// key: source URL · value: { at, images }
const scrapeCache = new Map<string, { at: number; images: LuckyImageResult[] }>()

function readCache(url: string): LuckyImageResult[] | null {
  const hit = scrapeCache.get(url)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    scrapeCache.delete(url)
    return null
  }
  return hit.images
}

function writeCache(url: string, images: LuckyImageResult[]) {
  scrapeCache.set(url, { at: Date.now(), images })
}

export function clearHuaypnkCache() {
  scrapeCache.clear()
}

// ─── Helpers ────────────────────────────────────────────

function makeAbsolute(src: string, baseUrl: string): string {
  if (!src) return ''
  if (src.startsWith('http')) return src
  if (src.startsWith('//')) return `https:${src}`
  try {
    return new URL(src, baseUrl).href
  } catch {
    // fallback: treat baseUrl as origin
    if (src.startsWith('/')) return `${HUAYPNK_ORIGIN}${src}`
    return `${HUAYPNK_ORIGIN}/${src}`
  }
}

function looksLikeContentImage(src: string): boolean {
  if (!src) return false
  const lower = src.toLowerCase()
  // ข้ามรูป icon / logo / banner / favicon / tiny sprite
  if (lower.includes('logo') || lower.includes('icon') ||
      lower.includes('favicon') || lower.includes('banner') ||
      lower.includes('sprite') || lower.includes('avatar')) return false
  // ยอมรับ: extension รู้จัก (jpg/png/webp/gif/avif) + query string + hash
  if (lower.match(/\.(jpe?g|png|webp|gif|avif)(\?[^#]*)?(#.*)?$/i)) return true
  // ยอมรับ: path ที่มักเป็นรูปเนื้อหา (CDN / storage / assets / media / ฯลฯ)
  if (lower.includes('/storage/')) return true
  if (lower.includes('/uploads/')) return true
  if (lower.includes('/img/')) return true
  if (lower.includes('/images/')) return true
  if (lower.includes('/media/')) return true
  if (lower.includes('/cdn/')) return true
  if (lower.includes('/assets/')) return true
  if (lower.includes('/files/')) return true
  if (lower.includes('/public/')) return true
  // ยอมรับ: Next.js image optimizer path
  if (lower.includes('/_next/image')) return true
  return false
}

/**
 * แตกคำสำคัญจากชื่อหวยสำหรับจับคู่กับ label บนเว็บ
 * เช่น "ลาวสตาร์" → ["ลาวสตาร์", "ลาว", "สตาร์"]
 */
function extractKeywords(lotteryName: string): string[] {
  const lower = lotteryName.toLowerCase().trim()
  // แยกด้วยช่องว่าง วงเล็บ ยัติภังค์ ทับ
  const parts = lower.split(/[\s()\-\/]+/).filter(p => p.length >= 2)
  return Array.from(new Set([lower, ...parts]))
}

// ─── Main scraper ────────────────────────────────────────

/**
 * ดึงรูปเลขเด็ดจาก URL ที่ระบุ (default: huaypnk.com/top)
 * ถ้า lotteryName ระบุมา → พยายาม match ก่อน → ถ้าไม่พบ return ทั้งหมด
 * ถ้าไม่ระบุ → return ทุกรูป
 *
 * มี cache ภายใน TTL=60s ต่อ URL เพื่อลด traffic
 */
export async function scrapeLuckyImages(
  lotteryName?: string,
  sourceUrl: string = HUAYPNK_TOP_URL,
): Promise<LuckyImageResult[]> {
  const cached = readCache(sourceUrl)
  const allImages = cached ?? (await fetchAndParse(sourceUrl))

  if (!cached && allImages.length > 0) writeCache(sourceUrl, allImages)

  if (allImages.length === 0) return []
  if (!lotteryName) return allImages

  // พยายาม match ชื่อหวย
  const keywords = extractKeywords(lotteryName)
  const matched = allImages.filter(img => {
    const lbl = img.lotteryLabel.toLowerCase()
    if (!lbl) return false
    return keywords.some(k => lbl.includes(k))
  })

  if (matched.length > 0) {
    return matched.map(m => ({ ...m, matched: true }))
  }

  // ไม่พบการจับคู่ → คืนทั้งหมด (caller สุ่มเอง)
  return allImages
}

async function fetchAndParse(sourceUrl: string): Promise<LuckyImageResult[]> {
  let html: string
  try {
    const { data } = await axios.get<string>(sourceUrl, {
      timeout: FETCH_TIMEOUT_MS,
      headers: {
        'User-Agent': SCRAPER_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': HUAYPNK_ORIGIN + '/',
        'Cache-Control': 'no-cache',
        'Sec-Ch-Ua': '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
    })
    html = data
  } catch {
    return []
  }

  const $ = cheerio.load(html)
  const allImages: LuckyImageResult[] = []
  const seenUrls = new Set<string>()

  function pushImage(src: string, labelHint: string) {
    if (!src) return
    if (!looksLikeContentImage(src)) return
    const absoluteUrl = makeAbsolute(src, sourceUrl)
    if (!absoluteUrl) return
    if (seenUrls.has(absoluteUrl)) return
    seenUrls.add(absoluteUrl)
    allImages.push({
      imageUrl: absoluteUrl,
      lotteryLabel: labelHint.trim(),
      matched: false,
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function labelNearEl(el: any): string {
    const el$ = $(el)
    let label = ''
    // ลอง parent chain ไม่เกิน 4 ระดับ
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
    return label
  }

  // ─── 1. <img> tags (incl. lazy-load data-src variants) ─
  $('img').each((_, el) => {
    const src = (
      $(el).attr('src') ||
      $(el).attr('data-src') ||
      $(el).attr('data-lazy-src') ||
      $(el).attr('data-original') ||
      $(el).attr('data-srcset')?.split(',')[0]?.trim().split(/\s+/)[0] ||
      ''
    ).trim()
    pushImage(src, labelNearEl(el))
  })

  // ─── 2. <source srcset> inside <picture> ───────────────
  $('source[srcset]').each((_, el) => {
    const srcset = $(el).attr('srcset') || ''
    // srcset format: "url1 1x, url2 2x" — take the first one
    const first = srcset.split(',')[0]?.trim().split(/\s+/)[0]
    if (first) pushImage(first, labelNearEl(el))
  })

  // ─── 3. style="background-image: url(...)" ─────────────
  const bgPattern = /background-image\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/gi
  $('[style]').each((_, el) => {
    const style = $(el).attr('style') || ''
    let m
    while ((m = bgPattern.exec(style)) !== null) {
      pushImage(m[1], labelNearEl(el))
    }
  })

  // ─── 4. <a href="*.jpg"> direct links to images ────────
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || ''
    if (/\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(href)) {
      pushImage(href, labelNearEl(el))
    }
  })

  return allImages
}

/**
 * ดึง URL รูปสุ่มสำหรับหวย lotteryName
 * คืน null ถ้าดึงไม่ได้หรือหน้าว่าง
 */
export async function getRandomLuckyImageUrl(
  lotteryName?: string,
  sourceUrl: string = HUAYPNK_TOP_URL,
): Promise<string | null> {
  const images = await scrapeLuckyImages(lotteryName, sourceUrl)
  if (images.length === 0) return null
  return images[Math.floor(Math.random() * images.length)].imageUrl
}

/**
 * ดึงหลาย URL รูปสุ่ม (ไม่ซ้ำกัน) สำหรับแจกหลายกลุ่ม
 * คืน empty array ถ้าดึงไม่ได้
 */
export async function getShuffledLuckyImageUrls(
  count: number,
  sourceUrl: string = HUAYPNK_TOP_URL,
): Promise<string[]> {
  const images = await scrapeLuckyImages(undefined, sourceUrl)
  if (images.length === 0) return []
  const shuffled = images.slice().sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count).map(i => i.imageUrl)
}
