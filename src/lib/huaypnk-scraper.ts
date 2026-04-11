/**
 * huaypnk-scraper.ts
 *
 * ดึงรูปเลขเด็ด/สุ่มจาก https://www.huaypnk.com/top
 * แล้วจับคู่กับชื่อหวยที่ส่งมา (ถ้าไม่พบ → สุ่มจากทั้งหมด)
 *
 * ใช้ axios + cheerio (มีอยู่แล้วใน project)
 */

import axios from 'axios'
import * as cheerio from 'cheerio'

const HUAYPNK_TOP_URL = 'https://www.huaypnk.com/top'
const FETCH_TIMEOUT_MS = 10_000

const SCRAPER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export interface LuckyImageResult {
  imageUrl: string   // absolute URL (https://...)
  lotteryLabel: string  // ชื่อหวยที่ฝั่งเว็บใช้ (อาจเป็น '' ถ้าหาไม่เจอ)
  matched: boolean   // true ถ้าชื่อตรงกับ lotteryName ที่ขอ
}

// ─── Helpers ────────────────────────────────────────────

function makeAbsolute(src: string): string {
  if (!src) return ''
  if (src.startsWith('http')) return src
  if (src.startsWith('//')) return `https:${src}`
  if (src.startsWith('/')) return `https://www.huaypnk.com${src}`
  return `https://www.huaypnk.com/${src}`
}

function looksLikeContentImage(src: string): boolean {
  if (!src) return false
  const lower = src.toLowerCase()
  // ข้ามรูป icon / logo / banner / favicon / tiny sprite
  if (lower.includes('logo') || lower.includes('icon') ||
      lower.includes('favicon') || lower.includes('banner') ||
      lower.includes('sprite') || lower.includes('avatar')) return false
  // ต้องเป็น JPEG/PNG/WEBP หรืออยู่ใน path ที่คาดว่าเป็นรูปเนื้อหา
  return !!(
    lower.match(/\.(jpe?g|png|webp)(\?[^#]*)?$/i) ||
    lower.includes('/storage/') ||
    lower.includes('/uploads/') ||
    lower.includes('/img/') ||
    lower.includes('/images/')
  )
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
 * ดึงรูปเลขเด็ดจาก huaypnk.com/top
 * ถ้า lotteryName ระบุมา → พยายาม match ก่อน → ถ้าไม่พบ return ทั้งหมด
 * ถ้าไม่ระบุ → return ทุกรูป
 */
export async function scrapeLuckyImages(lotteryName?: string): Promise<LuckyImageResult[]> {
  let html: string
  try {
    const { data } = await axios.get<string>(HUAYPNK_TOP_URL, {
      timeout: FETCH_TIMEOUT_MS,
      headers: {
        'User-Agent': SCRAPER_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://www.huaypnk.com/',
        'Cache-Control': 'no-cache',
      },
    })
    html = data
  } catch {
    return []
  }

  const $ = cheerio.load(html)
  const allImages: LuckyImageResult[] = []

  $('img').each((_, el) => {
    const src = (
      $(el).attr('src') ||
      $(el).attr('data-src') ||
      $(el).attr('data-lazy-src') ||
      $(el).attr('data-original') ||
      ''
    ).trim()

    if (!looksLikeContentImage(src)) return

    const absoluteUrl = makeAbsolute(src)
    if (!absoluteUrl) return

    // หา label ที่ใกล้รูปที่สุด
    let label = ''
    const el$ = $(el)

    // ลอง parent chain ไม่เกิน 3 ระดับ
    let node = el$.parent()
    for (let depth = 0; depth < 4 && node.length; depth++) {
      // heading ใน element นี้
      const heading = node.find('h1,h2,h3,h4,h5,h6').first().text().trim()
      if (heading) { label = heading; break }

      // element ที่มี class title / name / label / header
      const titled = node.find('[class*="title"],[class*="name"],[class*="label"],[class*="header"],[class*="caption"]').first().text().trim()
      if (titled) { label = titled; break }

      node = node.parent()
    }

    // ถ้ายังไม่ได้ → ลอง alt / title attribute
    if (!label) {
      label = el$.attr('alt') || el$.attr('title') || ''
    }

    allImages.push({
      imageUrl: absoluteUrl,
      lotteryLabel: label.trim(),
      matched: false,
    })
  })

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

/**
 * ดึง URL รูปสุ่มสำหรับหวย lotteryName
 * คืน null ถ้าดึงไม่ได้หรือหน้าว่าง
 */
export async function getRandomLuckyImageUrl(lotteryName?: string): Promise<string | null> {
  const images = await scrapeLuckyImages(lotteryName)
  if (images.length === 0) return null
  return images[Math.floor(Math.random() * images.length)].imageUrl
}
