/**
 * events/validate.ts — Reject malformed LotteryEvent payloads
 *
 * Checks:
 *   - required fields present
 *   - lottery_id looks like uuid
 *   - draw_date matches YYYY-MM-DD and is not absurd
 *   - at least one number (top/bottom/full) and each is digit-only
 *   - result_hash is a 64-char hex string
 */

import { LotteryEvent, ValidationIssue, ValidationResult } from './types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DIGITS_RE = /^\d+$/
const HASH_RE = /^[0-9a-f]{64}$/

function pushIf(list: ValidationIssue[], cond: boolean, field: string, message: string) {
  if (cond) list.push({ field, message })
}

export function validateEvent(event: LotteryEvent): ValidationResult {
  const issues: ValidationIssue[] = []

  pushIf(issues, !event.trigger_id, 'trigger_id', 'trigger_id ต้องมีค่า')
  pushIf(issues, !event.source, 'source', 'source ต้องมีค่า')
  pushIf(issues, !event.lottery_id, 'lottery_id', 'lottery_id ต้องมีค่า')
  if (event.lottery_id) {
    pushIf(issues, !UUID_RE.test(event.lottery_id), 'lottery_id', 'lottery_id ต้องเป็น uuid')
  }

  pushIf(issues, !event.draw_date, 'draw_date', 'draw_date ต้องมีค่า')
  if (event.draw_date) {
    if (!DATE_RE.test(event.draw_date)) {
      issues.push({ field: 'draw_date', message: 'draw_date ต้องเป็นรูปแบบ YYYY-MM-DD' })
    } else {
      const year = parseInt(event.draw_date.slice(0, 4), 10)
      if (year < 2020 || year > 2100) {
        issues.push({ field: 'draw_date', message: `ปี ${year} ดูไม่สมเหตุสมผล` })
      }
    }
  }

  pushIf(issues, !event.result_text, 'result_text', 'result_text ต้องมีค่า')
  pushIf(issues, !event.result_hash, 'result_hash', 'result_hash คำนวณไม่ได้')
  if (event.result_hash) {
    pushIf(issues, !HASH_RE.test(event.result_hash), 'result_hash', 'result_hash ต้องเป็น sha256 hex 64 ตัว')
  }

  const { top_number, bottom_number, full_number } = event.numbers
  const hasAny = !!(top_number || bottom_number || full_number)
  if (!hasAny) {
    issues.push({ field: 'numbers', message: 'ต้องมีเลขอย่างน้อย 1 ช่อง (top/bottom/full)' })
  }

  if (top_number && !DIGITS_RE.test(top_number)) {
    issues.push({ field: 'numbers.top_number', message: 'top_number ต้องเป็นตัวเลขล้วน' })
  }
  if (bottom_number && !DIGITS_RE.test(bottom_number)) {
    issues.push({ field: 'numbers.bottom_number', message: 'bottom_number ต้องเป็นตัวเลขล้วน' })
  }
  if (full_number && !DIGITS_RE.test(full_number)) {
    issues.push({ field: 'numbers.full_number', message: 'full_number ต้องเป็นตัวเลขล้วน' })
  }

  // Sanity length checks (loose: every number ≤ 8 digits)
  const maxLen = 8
  if (top_number && top_number.length > maxLen) {
    issues.push({ field: 'numbers.top_number', message: `top_number ยาวเกิน ${maxLen} หลัก` })
  }
  if (bottom_number && bottom_number.length > maxLen) {
    issues.push({ field: 'numbers.bottom_number', message: `bottom_number ยาวเกิน ${maxLen} หลัก` })
  }
  if (full_number && full_number.length > maxLen) {
    issues.push({ field: 'numbers.full_number', message: `full_number ยาวเกิน ${maxLen} หลัก` })
  }

  return { ok: issues.length === 0, issues }
}
