// Browser Scraper — ใช้ Puppeteer + Chromium bypass Cloudflare
// สำหรับหวย Hanoi/Laos ที่เว็บบล็อก axios
//
// ใช้ @sparticuz/chromium-min + ดาวน์โหลด Chromium จาก CDN
// ต้องใช้ Vercel Pro (timeout 60s) เพราะ browser launch ใช้เวลา 5-10s

import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium-min'
import type { SelectorConfig } from '@/types'

// Chromium binary CDN — ดาวน์โหลดอัตโนมัติตอน cold start (~66MB)
const CHROMIUM_PACK_URL = 'https://github.com/Sparticuz/chromium/releases/download/v143.0.4/chromium-v143.0.4-pack.x64.tar'

interface BrowserScrapeResult {
  success: boolean
  data?: {
    top_number?: string
    bottom_number?: string
    full_number?: string
  }
  error?: string
  html_snippet?: string
}

/**
 * ดึงผลหวยด้วย Puppeteer (bypass Cloudflare)
 */
export async function browserScrape(
  url: string,
  selectors: SelectorConfig,
): Promise<BrowserScrapeResult> {
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
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    )

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 })

    // Wait for Cloudflare challenge to complete (if present)
    const isCloudflare = await page.evaluate(() =>
      document.body.innerText.includes('Checking your browser') ||
      document.body.innerText.includes('Please wait')
    )

    if (isCloudflare) {
      // Cloudflare challenge — wait for redirect to actual page
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {})
      // Extra wait for dynamic content after Cloudflare
      await new Promise(r => setTimeout(r, 3000))
    } else {
      await page.waitForFunction(() => document.readyState === 'complete', { timeout: 5000 }).catch(() => {})
    }

    // METHOD 1: Try CSS selectors first (if configured by admin)
    if (selectors.top_selector || selectors.bottom_selector || selectors.full_selector) {
      const selectorResult = await page.evaluate((sel) => {
        const data: { top_number?: string; bottom_number?: string; full_number?: string } = {}
        if (sel.top_selector) {
          const el = document.querySelector(sel.top_selector)
          if (el) data.top_number = (el.textContent || '').trim().replace(/\D/g, '')
        }
        if (sel.bottom_selector) {
          const el = document.querySelector(sel.bottom_selector)
          if (el) data.bottom_number = (el.textContent || '').trim().replace(/\D/g, '')
        }
        if (sel.full_selector) {
          const el = document.querySelector(sel.full_selector)
          if (el) data.full_number = (el.textContent || '').trim().replace(/\D/g, '')
        }
        return data
      }, selectors as Record<string, string>)

      if (selectorResult.top_number || selectorResult.bottom_number || selectorResult.full_number) {
        return { success: true, data: selectorResult }
      }
    }

    // METHOD 2: Smart text extraction — หาตัวเลขจาก pattern ภาษาไทยในหน้าเว็บ
    const smartResult = await page.evaluate(() => {
      const text = document.body.innerText
      const data: { top_number?: string; bottom_number?: string; full_number?: string } = {}

      // Pattern: "3 ตัวบน" หรือ "เลขบน" หรือ "3ตัวบน" ตามด้วยตัวเลข 3 หลัก
      const topPatterns = [
        /(?:3\s*ตัว(?:บน|ตรง)|เลข\s*บน|สาม\s*ตัว(?:บน|ตรง))\s*[:：]?\s*(\d{3})/i,
        /(\d{3})\s*(?:3\s*ตัว(?:บน|ตรง)|เลข\s*บน)/i,
        /บน\s*[:：]?\s*(\d{3})/i,
      ]

      // Pattern: "2 ตัวล่าง" หรือ "เลขล่าง" ตามด้วยตัวเลข 2 หลัก
      const bottomPatterns = [
        /(?:2\s*ตัว(?:ล่าง|ท้าย)|เลข\s*ล่าง|สอง\s*ตัว(?:ล่าง|ท้าย))\s*[:：]?\s*(\d{2})/i,
        /(\d{2})\s*(?:2\s*ตัว(?:ล่าง|ท้าย)|เลข\s*ล่าง)/i,
        /ล่าง\s*[:：]?\s*(\d{2})/i,
      ]

      for (const p of topPatterns) {
        const m = text.match(p)
        if (m) { data.top_number = m[1]; break }
      }

      for (const p of bottomPatterns) {
        const m = text.match(p)
        if (m) { data.bottom_number = m[1]; break }
      }

      // Fallback: ถ้ายังไม่เจอ ลองหา pattern ตัวเลข 3-2 ที่อยู่ใกล้กัน (xxx-yy หรือ xxx / yy)
      if (!data.top_number && !data.bottom_number) {
        const combo = text.match(/(\d{3})\s*[-–/]\s*(\d{2})/)
        if (combo) {
          data.top_number = combo[1]
          data.bottom_number = combo[2]
        }
      }

      return data
    })

    if (smartResult.top_number || smartResult.bottom_number) {
      return { success: true, data: smartResult }
    }

    // Nothing found — return page text for debugging
    const snippet = await page.evaluate(() => document.body.innerText.substring(0, 500))
    return {
      success: false,
      error: 'ไม่พบตัวเลขในหน้าเว็บ — อาจยังไม่ออกผล หรือ HTML เปลี่ยน',
      html_snippet: snippet,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Browser scrape failed',
    }
  } finally {
    if (browser) await browser.close()
  }
}

/**
 * ดึง HTML จากหน้าเว็บด้วย Puppeteer (สำหรับค้นหา selectors)
 */
export async function browserFetchHTML(url: string): Promise<{
  success: boolean
  html?: string
  text?: string
  error?: string
}> {
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
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    )

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 })

    const html = await page.content()
    const text = await page.evaluate(() => document.body.innerText)

    return { success: true, html: html.substring(0, 10000), text: text.substring(0, 3000) }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Browser fetch failed',
    }
  } finally {
    if (browser) await browser.close()
  }
}

// ============================================
// Mapping หวย Hanoi/Laos → URL + Selectors
// ============================================
// ใช้ raakaadee.com เป็นแหล่งหลัก (มีครบทุกหวย)
// Selectors ต้อง discover หลัง deploy (ใช้ปุ่ม "สำรวจ HTML" ในหน้า admin)

const RAAKAADEE_BASE = 'https://www.raakaadee.com/ตรวจหวย-หุ้น'

export const HANOI_LAOS_SOURCES: Record<string, {
  url: string
  backupUrl?: string
  name: string
}> = {
  // Hanoi
  'ฮานอย HD': { url: `${RAAKAADEE_BASE}/หวยฮานอย-HD/`, name: 'Hanoi HD' },
  'ฮานอยสตาร์': { url: `${RAAKAADEE_BASE}/หวยฮานอยสตาร์/`, name: 'Hanoi Star' },
  'ฮานอย TV': { url: `${RAAKAADEE_BASE}/หวยฮานอย-TV/`, name: 'Hanoi TV' },
  'ฮานอยกาชาด': { url: `${RAAKAADEE_BASE}/หวยฮานอยกาชาด/`, name: 'Hanoi Red Cross' },
  'ฮานอยพิเศษ': { url: `${RAAKAADEE_BASE}/หวยฮานอยพิเศษ/`, name: 'Hanoi Special' },
  'ฮานอยสามัคคี': { url: `${RAAKAADEE_BASE}/หวยฮานอยสามัคคี/`, name: 'Hanoi Samakkee' },
  'ฮานอยปกติ': { url: `${RAAKAADEE_BASE}/หวยฮานอยปกติ/`, name: 'Hanoi Normal' },
  'ฮานอย VIP': { url: `${RAAKAADEE_BASE}/หวยฮานอย-VIP/`, name: 'Hanoi VIP' },
  'ฮานอยพัฒนา': { url: `${RAAKAADEE_BASE}/หวยฮานอยพัฒนา/`, name: 'Hanoi Pattana' },
  'ฮานอย Extra': { url: `${RAAKAADEE_BASE}/หวยฮานอย-Extra/`, name: 'Hanoi Extra' },
  // Laos
  'ลาว TV': { url: `${RAAKAADEE_BASE}/หวยลาว-TV/`, name: 'Laos TV' },
  'ลาว HD': { url: `${RAAKAADEE_BASE}/หวยลาว-HD/`, name: 'Laos HD' },
  'ลาวสตาร์': { url: `${RAAKAADEE_BASE}/หวยลาวสตาร์/`, name: 'Laos Star' },
  'ลาวสามัคคี': { url: `${RAAKAADEE_BASE}/หวยลาวสามัคคี/`, name: 'Laos Samakkee' },
  'ลาวพัฒนา': { url: `${RAAKAADEE_BASE}/หวยลาวพัฒนา/`, name: 'Laos Pattana' },
  'ลาว VIP': { url: `${RAAKAADEE_BASE}/หวยลาว-VIP/`, name: 'Laos VIP' },
  'ลาวสตาร์ VIP': { url: `${RAAKAADEE_BASE}/หวยลาวสตาร์-VIP/`, name: 'Laos Star VIP' },
  'ลาวกาชาด': { url: `${RAAKAADEE_BASE}/หวยลาวกาชาด/`, name: 'Laos Red Cross' },
}

/**
 * ตรวจว่าหวยนี้เป็น Hanoi/Laos (ต้องใช้ browser scrape) หรือไม่
 */
export function isHanoiLaosLottery(name: string): boolean {
  return name in HANOI_LAOS_SOURCES
}

/**
 * ดึงข้อมูล URL สำหรับหวย Hanoi/Laos
 */
export function getHanoiLaosSource(name: string) {
  return HANOI_LAOS_SOURCES[name] || null
}
