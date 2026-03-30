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
  searchName?: string,
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

    // METHOD 2: Smart text extraction — หาตัวเลขจาก pattern ในหน้าเว็บ
    // ถ้ามี searchName จะหาเฉพาะส่วนที่อยู่ใกล้ชื่อหวยนั้น (สำหรับหน้ารวมผล)
    const smartResult = await page.evaluate((name) => {
      const fullText = document.body.innerText
      const data: { top_number?: string; bottom_number?: string; full_number?: string } = {}

      // ถ้ามีชื่อหวยที่ต้องค้นหา → ตัดเอาเฉพาะส่วน 300 ตัวอักษรรอบๆ ชื่อหวยนั้น
      let text = fullText
      if (name) {
        const idx = fullText.indexOf(name)
        if (idx >= 0) {
          text = fullText.substring(idx, idx + 300)
        } else {
          // ลอง search แบบ flexible (ไม่สน space/dash)
          const flexName = name.replace(/[-\s]/g, '.*?')
          const flexMatch = fullText.match(new RegExp(flexName))
          if (flexMatch && flexMatch.index !== undefined) {
            text = fullText.substring(flexMatch.index, flexMatch.index + 300)
          }
        }
      }

      // Pattern: "3 ตัวบน/ตรง" หรือ "เลขบน" + ตัวเลข 3 หลัก
      const topPatterns = [
        /(?:3\s*ตัว(?:บน|ตรง)|เลข\s*บน|สาม\s*ตัว(?:บน|ตรง))\s*[:：]?\s*(\d{3})/i,
        /(\d{3})\s*[-–]\s*\d{2}/,  // xxx-yy pattern (top part)
        /บน\s*[:：]?\s*(\d{3})/i,
      ]

      // Pattern: "2 ตัวล่าง/ท้าย" หรือ "เลขล่าง" + ตัวเลข 2 หลัก
      const bottomPatterns = [
        /(?:2\s*ตัว(?:ล่าง|ท้าย)|เลข\s*ล่าง|สอง\s*ตัว(?:ล่าง|ท้าย))\s*[:：]?\s*(\d{2})/i,
        /\d{3}\s*[-–]\s*(\d{2})/,  // xxx-yy pattern (bottom part)
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

      return data
    }, searchName || null)

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

// ใช้หน้ารวมผล (มีทุกหวยในหน้าเดียว) แทนหน้าเดี่ยว
// Puppeteer เปิดหน้ารวม แล้วหาชื่อหวยในเนื้อหา + ดึงตัวเลขที่อยู่ใกล้กัน
const HANOI_PAGE = 'https://www.raakaadee.com/ตรวจหวย-หุ้น/หวยฮานอย/'
const LAOS_PAGE = 'https://www.raakaadee.com/ตรวจหวย-หุ้น/หวยลาว/'

export const HANOI_LAOS_SOURCES: Record<string, {
  url: string
  searchName: string
  name: string
}> = {
  // Hanoi — ใช้หน้ารวมหวยฮานอย 19 ชนิด
  'ฮานอย HD': { url: HANOI_PAGE, searchName: 'ฮานอย HD', name: 'Hanoi HD' },
  'ฮานอยสตาร์': { url: HANOI_PAGE, searchName: 'ฮานอยสตาร์', name: 'Hanoi Star' },
  'ฮานอย TV': { url: HANOI_PAGE, searchName: 'ฮานอย TV', name: 'Hanoi TV' },
  'ฮานอยกาชาด': { url: HANOI_PAGE, searchName: 'ฮานอยกาชาด', name: 'Hanoi Red Cross' },
  'ฮานอยพิเศษ': { url: HANOI_PAGE, searchName: 'ฮานอยพิเศษ', name: 'Hanoi Special' },
  'ฮานอยสามัคคี': { url: HANOI_PAGE, searchName: 'ฮานอยสามัคคี', name: 'Hanoi Samakkee' },
  'ฮานอยปกติ': { url: HANOI_PAGE, searchName: 'ฮานอยปกติ', name: 'Hanoi Normal' },
  'ฮานอย VIP': { url: HANOI_PAGE, searchName: 'ฮานอย VIP', name: 'Hanoi VIP' },
  'ฮานอยพัฒนา': { url: HANOI_PAGE, searchName: 'ฮานอยพัฒนา', name: 'Hanoi Pattana' },
  'ฮานอย Extra': { url: HANOI_PAGE, searchName: 'ฮานอย Extra', name: 'Hanoi Extra' },
  // Laos — ใช้หน้ารวมหวยลาว
  'ลาว TV': { url: LAOS_PAGE, searchName: 'ลาว TV', name: 'Laos TV' },
  'ลาว HD': { url: LAOS_PAGE, searchName: 'ลาว HD', name: 'Laos HD' },
  'ลาวสตาร์': { url: LAOS_PAGE, searchName: 'ลาวสตาร์', name: 'Laos Star' },
  'ลาวสามัคคี': { url: LAOS_PAGE, searchName: 'ลาวสามัคคี', name: 'Laos Samakkee' },
  'ลาวพัฒนา': { url: LAOS_PAGE, searchName: 'ลาวพัฒนา', name: 'Laos Pattana' },
  'ลาว VIP': { url: LAOS_PAGE, searchName: 'ลาว VIP', name: 'Laos VIP' },
  'ลาวสตาร์ VIP': { url: LAOS_PAGE, searchName: 'ลาวสตาร์ VIP', name: 'Laos Star VIP' },
  'ลาวกาชาด': { url: LAOS_PAGE, searchName: 'ลาวกาชาด', name: 'Laos Red Cross' },
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
