// Web Scraping Engine — Cheerio + Axios
// CSS selectors เก็บใน DB (scrape_sources.selector_config)

import axios from 'axios'
import * as cheerio from 'cheerio'
import type { ScrapeSource, SelectorConfig } from '@/types'

interface ScrapeResult {
  top_number?: string
  bottom_number?: string
  full_number?: string
  raw_html?: string
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
]

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

export async function scrapeResult(source: ScrapeSource): Promise<{
  success: boolean
  data?: ScrapeResult
  error?: string
}> {
  const config = source.selector_config as SelectorConfig | null
  if (!config) {
    return { success: false, error: 'No selector_config defined' }
  }

  try {
    const { data: html } = await axios.get(source.url, {
      headers: { 'User-Agent': randomUA() },
      timeout: 15000,
    })

    const $ = cheerio.load(html)

    const result: ScrapeResult = { raw_html: html.substring(0, 500) }

    if (config.top_selector) {
      const text = $(config.top_selector).first().text().trim()
      if (text) result.top_number = text.replace(/\D/g, '')
    }

    if (config.bottom_selector) {
      const text = $(config.bottom_selector).first().text().trim()
      if (text) result.bottom_number = text.replace(/\D/g, '')
    }

    if (config.full_selector) {
      const text = $(config.full_selector).first().text().trim()
      if (text) result.full_number = text.replace(/\D/g, '')
    }

    // ต้องได้อย่างน้อย 1 ค่า
    if (!result.top_number && !result.bottom_number && !result.full_number) {
      return { success: false, error: 'No numbers found with selectors' }
    }

    return { success: true, data: result }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Scrape failed',
    }
  }
}

export async function scrapeWithFallback(sources: ScrapeSource[]): Promise<{
  success: boolean
  data?: ScrapeResult
  source?: ScrapeSource
  error?: string
}> {
  // เรียง primary ก่อน
  const sorted = [...sources].sort((a, b) => (a.is_primary ? -1 : 1) - (b.is_primary ? -1 : 1))

  for (const source of sorted) {
    if (!source.is_active) continue
    const result = await scrapeResult(source)
    if (result.success) {
      return { success: true, data: result.data, source }
    }
  }

  return { success: false, error: 'All sources failed' }
}
