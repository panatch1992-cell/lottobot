/**
 * hybrid/trigger-phrases.ts
 *
 * Pool picker สำหรับ trigger phrases ที่ self-bot ใช้ส่งเข้ากลุ่ม LINE
 * เพื่อขอ replyToken จาก webhook
 *
 * หลักคิด:
 *   - เก็บ pools เป็น JSON ใน bot_settings (trigger_phrase_pool_{category})
 *   - avoid-repeat window N ครั้งล่าสุดต่อกลุ่ม (bot_settings.trigger_phrase_recent_window)
 *   - ถ้าหลัง filter แล้ว pool ว่าง → fallback เป็น pool เต็ม (pool เล็กเกินกว่า window)
 *   - บันทึก phrase ที่ใช้ลง trigger_phrase_history ทุกครั้ง (หลัง dispatcher commit)
 */

import { getServiceClient, getSettings } from '@/lib/supabase'
import type { TriggerPhraseCategory } from '@/types'

// Fallback defaults ถ้า settings ไม่ได้ set
const DEFAULT_POOLS: Record<TriggerPhraseCategory, string[]> = {
  general: ['อัพเดทครับ', 'มาแล้วครับ', '📢', '🔔', 'เช็กผล', 'งวดใหม่', '🎯', 'ดูผลกัน'],
  result: ['📢 ผลออกแล้ว', 'ผลมาครับ', '🎉 ออกแล้ว', '🎯 ผลมา', 'เช็กเลขกัน', 'ออกแล้วครับ'],
  announce: ['📢 รายการต่อไป', 'ต่อไป', '➡️ รอบหน้า', 'รอบถัดไป', '🕐 ถัดไป'],
  stats: ['📋 สถิติ', '🔍 ย้อนหลัง', 'ดูสถิติกัน', '📊 ข้อมูล', 'ย้อนไปดู'],
}

const DEFAULT_RECENT_WINDOW = 5

function parseJsonArray(raw: string | undefined): string[] | null {
  if (!raw) return null
  try {
    const arr = JSON.parse(raw)
    if (Array.isArray(arr) && arr.every(x => typeof x === 'string')) return arr
  } catch {
    // fall through
  }
  return null
}

async function loadPool(category: TriggerPhraseCategory): Promise<string[]> {
  const settings = await getSettings()
  const key = `trigger_phrase_pool_${category}` as const
  const fromSettings = parseJsonArray(settings[key])
  if (fromSettings && fromSettings.length > 0) return fromSettings
  return DEFAULT_POOLS[category] || DEFAULT_POOLS.general
}

async function loadRecentWindow(): Promise<number> {
  const settings = await getSettings()
  const raw = settings.trigger_phrase_recent_window
  const n = parseInt(raw || '', 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RECENT_WINDOW
}

async function loadRecentPhrasesForGroup(
  lineGroupId: string,
  windowSize: number,
): Promise<string[]> {
  const db = getServiceClient()
  const { data } = await db
    .from('trigger_phrase_history')
    .select('phrase')
    .eq('line_group_id', lineGroupId)
    .order('used_at', { ascending: false })
    .limit(windowSize)
  return (data || []).map(r => r.phrase as string)
}

export interface PickTriggerPhraseInput {
  lineGroupId: string
  category: TriggerPhraseCategory
}

export interface PickedTriggerPhrase {
  phrase: string
  category: TriggerPhraseCategory
  fromFallback: boolean // true ถ้า filtered เหลือ 0 แล้วต้อง fallback pool เต็ม
}

/**
 * เลือก trigger phrase 1 อันจาก pool ของ category ที่ขอ
 * โดยเลี่ยง phrase ที่เพิ่งใช้ใน recent-window ของกลุ่มนี้
 *
 * ฟังก์ชันนี้อ่าน history อย่างเดียว — ไม่บันทึก
 * (ให้ caller บันทึกหลัง trigger ส่งสำเร็จจริง ๆ)
 */
export async function pickTriggerPhrase(
  input: PickTriggerPhraseInput,
): Promise<PickedTriggerPhrase> {
  const { lineGroupId, category } = input

  const [pool, windowSize] = await Promise.all([
    loadPool(category),
    loadRecentWindow(),
  ])

  if (pool.length === 0) {
    // หมวดว่างจริง ๆ → fallback เป็น general, ถ้า general ก็ว่างก็ใช้ default hard-coded
    const fallback = DEFAULT_POOLS.general
    const pick = fallback[Math.floor(Math.random() * fallback.length)]
    return { phrase: pick, category, fromFallback: true }
  }

  const recent = await loadRecentPhrasesForGroup(lineGroupId, windowSize)
  const recentSet = new Set(recent)

  const available = pool.filter(p => !recentSet.has(p))
  if (available.length > 0) {
    const pick = available[Math.floor(Math.random() * available.length)]
    return { phrase: pick, category, fromFallback: false }
  }

  // pool เล็กเกินกว่า window → ใช้ pool เต็ม + เลือกอันที่ไม่ใช่ตัวล่าสุด
  const notLast = pool.filter(p => p !== recent[0])
  const effective = notLast.length > 0 ? notLast : pool
  const pick = effective[Math.floor(Math.random() * effective.length)]
  return { phrase: pick, category, fromFallback: true }
}

/**
 * บันทึก phrase ที่ใช้แล้วลง trigger_phrase_history
 * เรียกหลัง self-bot ส่ง trigger สำเร็จ (status='trigger_sent')
 */
export async function recordPhraseUsed(params: {
  lineGroupId: string
  phrase: string
  category: TriggerPhraseCategory
}): Promise<void> {
  const db = getServiceClient()
  const { error } = await db.from('trigger_phrase_history').insert({
    line_group_id: params.lineGroupId,
    phrase: params.phrase,
    category: params.category,
  })
  if (error) {
    // non-fatal — observability ลดลงแต่ flow ไม่พัง
    console.warn('[trigger-phrases] recordPhraseUsed failed:', error.message)
  }
}

/**
 * Trim เก่า ๆ ออก (ทำเป็นระยะ ๆ) — เก็บแค่ ~100 แถวต่อกลุ่ม
 * เรียกจาก maintenance cron ได้
 */
export async function trimPhraseHistory(maxPerGroup = 100): Promise<number> {
  const db = getServiceClient()
  // อาศัย row_number/window ไม่ได้ผ่าน supabase client ปกติ → ลบจาก cutoff date
  // ถ้าต้องการแบบ precise ต้องเขียน RPC
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { count } = await db
    .from('trigger_phrase_history')
    .delete({ count: 'exact' })
    .lt('used_at', cutoff)
  void maxPerGroup
  return count || 0
}
