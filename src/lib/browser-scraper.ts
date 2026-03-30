// Browser Scraper — ใช้ Puppeteer + Chromium bypass Cloudflare
// สำหรับหวย Hanoi/Laos ที่เว็บบล็อก axios
//
// ใช้ @sparticuz/chromium-min + ดาวน์โหลด Chromium จาก CDN
// ต้องใช้ Vercel Pro (timeout 60s) เพราะ browser launch ใช้เวลา 5-10s

import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium-min'
import type { SelectorConfig } from '@/types'

// Chromium binary CDN — ดาวน์โหลดอัตโนมัติตอน cold start
const CHROMIUM_PACK_URL = 'https://github.com/nicholasgasior/puppeteer-lambda-chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar'

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
      headless: true,
    })

    const page = await browser.newPage()
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    )

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 })

    // Wait for dynamic content
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 5000 }).catch(() => {})

    // Extract numbers using selectors
    const result = await page.evaluate((sel: SelectorConfig) => {
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

    if (!result.top_number && !result.bottom_number && !result.full_number) {
      // Selectors didn't match — return page snippet for debugging
      const snippet = await page.evaluate(() => {
        return document.body.innerText.substring(0, 500)
      })
      return {
        success: false,
        error: 'No numbers found with selectors',
        html_snippet: snippet,
      }
    }

    return { success: true, data: result }
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
      headless: true,
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
