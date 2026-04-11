/**
 * POST /api/admin/lucky-images/sync-huaypnk
 *
 * Scrape https://www.huaypnk.com/top → upsert เข้า lucky_images
 * ใช้ /api/lucky-image?url=... เป็น proxy URL (หลีกเลี่ยง hotlink block ของ LINE)
 *
 * Response:
 *   { added, skipped, failed, errors?: string[] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { scrapeLuckyImages } from '@/lib/huaypnk-scraper'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

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

export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  const db = getServiceClient()
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://lottobot-chi.vercel.app')

  let images
  try {
    images = await scrapeLuckyImages()
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'scrape failed' },
      { status: 500 },
    )
  }

  if (images.length === 0) {
    return NextResponse.json({ added: 0, skipped: 0, failed: 0, note: 'no images found from huaypnk' })
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
      uploaded_by: 'huaypnk-sync',
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
    total_scraped: images.length,
    ...(errors.length > 0 && { errors }),
  })
}
