/**
 * hybrid/lucky-image-picker.ts
 *
 * เลือกรูปเลขเด็ดจากตาราง lucky_images สำหรับ dispatcher
 *
 * หลักคิด:
 *   - priority: รูปที่ยังไม่เคยใช้ (last_used_at IS NULL) > รูปที่ใช้น้อยสุด
 *   - per-call rotation: ในการเรียกหนึ่งรอบ (dispatcher loop หลายกลุ่ม)
 *     เรา exclude ID ที่เพิ่ง pick ให้กลุ่มก่อนหน้า → กลุ่มที่ 1/2/3 ได้รูปต่างกัน
 *   - category match ก่อน → ถ้าหมวดว่าง fallback general
 *   - ถ้า lucky_images ว่างเปล่า และ lucky_image_fallback_live_scrape=true
 *     → ดึงสด ๆ จาก huaypnk (via huaypnk-scraper cache)
 *
 * หลัง pick → update use_count + last_used_at แบบ best-effort (ไม่ block caller)
 */

import { getServiceClient, getSettings } from '@/lib/supabase'
import { getRandomLuckyImageUrl } from '@/lib/huaypnk-scraper'
import type { LuckyImage, LuckyImageCategory } from '@/types'

export interface PickLuckyImageInput {
  category?: LuckyImageCategory | string
  excludeIds?: string[]
  lotteryName?: string // ใช้ตอน fallback live scrape เพื่อ match keyword
}

export interface PickedLuckyImage {
  id: string | null           // null ถ้า fallback live scrape (ไม่ได้จาก DB)
  url: string
  source: 'db' | 'live_scrape'
  category?: string
}

const POOL_SIZE = 10 // ดึง top N จาก DB แล้ว random 1

/**
 * เลือกรูปสำหรับ 1 กลุ่ม
 * คืน null ถ้าไม่มีรูปและไม่มี fallback
 */
export async function pickLuckyImage(
  input: PickLuckyImageInput = {},
): Promise<PickedLuckyImage | null> {
  const db = getServiceClient()
  const settings = await getSettings()
  const fallbackEnabled = String(settings.lucky_image_fallback_live_scrape || 'true').toLowerCase() === 'true'

  const category = input.category || 'general'
  const excludeIds = input.excludeIds || []

  // ── Try: DB with category match ──
  let pool = await queryPool(db, category, excludeIds)

  // ── Try: DB with general category (if requested category was specific) ──
  if (pool.length === 0 && category !== 'general') {
    pool = await queryPool(db, 'general', excludeIds)
  }

  // ── Try: DB any active (ignore category) ──
  if (pool.length === 0) {
    pool = await queryPool(db, null, excludeIds)
  }

  if (pool.length > 0) {
    const picked = pool[Math.floor(Math.random() * pool.length)]
    // best-effort update usage stats (ไม่ await)
    void bumpUsage(picked.id)
    return {
      id: picked.id,
      url: picked.public_url,
      source: 'db',
      category: picked.category,
    }
  }

  // ── Fallback: live scrape from huaypnk.com ──
  if (fallbackEnabled) {
    try {
      const directUrl = await getRandomLuckyImageUrl(input.lotteryName)
      if (directUrl) {
        // Proxy ผ่าน /api/lucky-image เพื่อ avoid hotlink
        const baseUrl =
          process.env.NEXT_PUBLIC_SITE_URL ||
          (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://lottobot-chi.vercel.app')
        const proxiedUrl = `${baseUrl}/api/lucky-image?url=${encodeURIComponent(directUrl)}`
        return {
          id: null,
          url: proxiedUrl,
          source: 'live_scrape',
        }
      }
    } catch (err) {
      console.warn('[lucky-image-picker] live scrape fallback failed:', err instanceof Error ? err.message : err)
    }
  }

  return null
}

async function queryPool(
  db: ReturnType<typeof getServiceClient>,
  category: string | null,
  excludeIds: string[],
): Promise<LuckyImage[]> {
  let q = db
    .from('lucky_images')
    .select('*')
    .eq('is_active', true)
    .order('last_used_at', { ascending: true, nullsFirst: true })
    .order('use_count', { ascending: true })
    .limit(POOL_SIZE)

  if (category) {
    q = q.eq('category', category)
  }
  if (excludeIds.length > 0) {
    q = q.not('id', 'in', `(${excludeIds.join(',')})`)
  }

  const { data, error } = await q
  if (error) {
    console.warn('[lucky-image-picker] queryPool error:', error.message)
    return []
  }
  return (data || []) as LuckyImage[]
}

async function bumpUsage(id: string): Promise<void> {
  const db = getServiceClient()
  // Read current use_count then update (no atomic RPC available)
  const { data } = await db
    .from('lucky_images')
    .select('use_count')
    .eq('id', id)
    .maybeSingle()
  const prev = (data?.use_count as number | undefined) || 0
  await db
    .from('lucky_images')
    .update({
      use_count: prev + 1,
      last_used_at: new Date().toISOString(),
    })
    .eq('id', id)
}

/**
 * เลือก N รูปให้ N กลุ่ม (ไม่ซ้ำกันเท่าที่ทำได้)
 * ใช้ใน dispatcher loop ทีเดียว → ลด round-trip DB
 */
export async function pickLuckyImagesForBatch(
  count: number,
  input: Omit<PickLuckyImageInput, 'excludeIds'> = {},
): Promise<PickedLuckyImage[]> {
  const picks: PickedLuckyImage[] = []
  const usedIds: string[] = []

  for (let i = 0; i < count; i++) {
    const picked = await pickLuckyImage({
      ...input,
      excludeIds: usedIds,
    })
    if (!picked) break
    picks.push(picked)
    if (picked.id) usedIds.push(picked.id)
  }

  return picks
}
