/**
 * hybrid/reply-composer.ts
 *
 * แปลง PendingReply[] → LINE message array สำหรับ Reply API
 *
 * ข้อจำกัด LINE Reply API:
 *   - สูงสุด 5 messages ต่อ 1 replyToken
 *   - แต่ละ text message ≤ 5000 ตัวอักษร
 *   - Image ต้อง original + preview URL (https, JPEG/PNG, <10MB)
 *
 * Strategy:
 *   - แต่ละ pending_reply → 1-2 bubbles (text + optional image)
 *   - ถ้ารวมกันเกิน 5 → เอามาเท่าที่พอดี 5 (FIFO — caller กรองด้วย findFlushable)
 *   - Image bubble ใช้ payload.image_url (pre-computed URL, อาจ proxy ผ่าน /api/lucky-image)
 */

import type { LineMessage } from '@/lib/line-reply'
import type { PendingReply, PendingReplyPayload } from '@/types'

const MAX_BUBBLES_PER_REPLY = 5
const MAX_TEXT_LENGTH = 4900

function safeText(s: string | undefined | null): string {
  if (!s) return ''
  const trimmed = s.trim()
  if (trimmed.length <= MAX_TEXT_LENGTH) return trimmed
  return trimmed.slice(0, MAX_TEXT_LENGTH - 5) + '\n...'
}

function isHttpsUrl(url: string | undefined | null): url is string {
  if (!url) return false
  return /^https:\/\//i.test(url)
}

/**
 * แปลง 1 pending_reply → LINE bubbles (สูงสุด 2 bubble: text + image)
 *
 * Rules:
 *   - payload.text  → text bubble
 *   - payload.image_url → image bubble
 *   - ถ้าไม่มีทั้งคู่ → ใช้ trigger_text เป็น fallback
 */
export function composeSingle(pending: PendingReply): LineMessage[] {
  const payload = (pending.payload || {}) as PendingReplyPayload
  const bubbles: LineMessage[] = []

  // Text bubble (priority: text > result_text > stats_text > trigger_text)
  const text =
    safeText(payload.text) ||
    safeText(payload.result_text) ||
    safeText(payload.stats_text) ||
    safeText(pending.trigger_text)

  if (text) {
    bubbles.push({ type: 'text', text })
  }

  // Image bubble
  if (isHttpsUrl(payload.image_url)) {
    bubbles.push({
      type: 'image',
      originalContentUrl: payload.image_url,
      previewImageUrl: payload.image_url,
    })
  }

  // Safety: ถ้าไม่มี bubble เลย → ส่ง trigger_text (กัน reply ว่าง)
  if (bubbles.length === 0) {
    bubbles.push({ type: 'text', text: pending.trigger_text || '📢' })
  }

  return bubbles
}

/**
 * รวม pending_replies[] → LINE message array (ตัดที่ 5 bubbles)
 *
 * ลำดับ: FIFO ตาม pending[] ที่ input เข้ามา
 * Returns:
 *   - messages: LINE message array (≤ 5)
 *   - usedIds: pending IDs ที่ถูก compose เข้าผลลัพธ์จริง ๆ
 *   - leftoverIds: pending IDs ที่ compose ไม่ทันเพราะเต็ม 5 แล้ว
 */
export function composeBatch(pendings: PendingReply[]): {
  messages: LineMessage[]
  usedIds: string[]
  leftoverIds: string[]
} {
  const messages: LineMessage[] = []
  const usedIds: string[] = []
  const leftoverIds: string[] = []

  for (const pending of pendings) {
    if (messages.length >= MAX_BUBBLES_PER_REPLY) {
      leftoverIds.push(pending.id)
      continue
    }

    const bubbles = composeSingle(pending)
    const remaining = MAX_BUBBLES_PER_REPLY - messages.length

    if (bubbles.length <= remaining) {
      messages.push(...bubbles)
      usedIds.push(pending.id)
    } else {
      // ใส่ bubble ได้บางส่วน → ให้ข้ามเพราะเราอยาก reply แบบ atomic ต่อ pending
      // (ถ้าเอาครึ่ง ๆ user จะเห็น stats แต่ไม่มีรูป ไม่สมบูรณ์)
      leftoverIds.push(pending.id)
    }
  }

  return { messages, usedIds, leftoverIds }
}
