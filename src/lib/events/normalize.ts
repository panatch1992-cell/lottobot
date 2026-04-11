/**
 * events/normalize.ts — Turn raw trigger input into a canonical LotteryEvent
 *
 * Every source (scrape, telegram, manual, webhook) must go through this
 * function so the rest of the pipeline sees exactly one shape.
 */

import { createHash, randomUUID } from 'crypto'
import {
  LOTTERY_RESULT_READY,
  LotteryEvent,
  RawTriggerInput,
  TriggerSource,
} from './types'

const ALLOWED_SOURCES: TriggerSource[] = ['scrape', 'telegram', 'manual', 'webhook']

function coerceSource(value: unknown): TriggerSource {
  const s = String(value || '').toLowerCase().trim() as TriggerSource
  return ALLOWED_SOURCES.includes(s) ? s : 'manual'
}

function canonicalResultText(
  explicit: string | undefined,
  numbers: RawTriggerInput['numbers'] | undefined,
): string {
  if (explicit && explicit.trim()) return explicit.trim()

  const top = numbers?.top_number?.trim() || ''
  const bottom = numbers?.bottom_number?.trim() || ''
  const full = numbers?.full_number?.trim() || ''

  if (full) return `FULL:${full}`
  if (top && bottom) return `${top}-${bottom}`
  if (top) return `TOP:${top}`
  if (bottom) return `BOT:${bottom}`
  return ''
}

export function computeResultHash(
  lotteryId: string,
  drawDate: string,
  round: string | null,
  resultText: string,
): string {
  const key = [lotteryId, drawDate, round || '', resultText].join('|')
  return createHash('sha256').update(key).digest('hex')
}

export function idempotencyKey(event: LotteryEvent): string {
  return [event.source, event.lottery_id, event.draw_date, event.round || '', event.result_hash].join(':')
}

/**
 * Build a LotteryEvent from a raw input. This will always return *something*,
 * even when fields are missing — validation runs next and decides whether
 * the event is allowed to proceed.
 */
export function normalizeEvent(input: RawTriggerInput): LotteryEvent {
  const source = coerceSource(input.source)
  const lottery_id = (input.lottery_id || '').trim()
  const draw_date = (input.draw_date || '').trim()
  const round = input.round === undefined ? null : (input.round || null)
  const numbers = input.numbers || {}
  const result_text = canonicalResultText(input.result_text, numbers)

  const result_hash = lottery_id && draw_date && result_text
    ? computeResultHash(lottery_id, draw_date, round, result_text)
    : ''

  const trigger_id = (input.trigger_id || '').trim() || `${source}-${randomUUID()}`

  return {
    event_type: LOTTERY_RESULT_READY,
    trigger_id,
    source,
    lottery_id,
    draw_date,
    round,
    result_text,
    result_hash,
    numbers: {
      top_number: numbers.top_number || null,
      bottom_number: numbers.bottom_number || null,
      full_number: numbers.full_number || null,
    },
    metadata: input.metadata || {},
  }
}
