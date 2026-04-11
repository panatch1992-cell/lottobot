/**
 * events/idempotency.ts — Dedupe via idempotency_keys table
 *
 * Strategy: source + lottery_id + draw_date + round + result_hash → key
 * First writer wins. Subsequent callers get isDuplicate=true and the
 * trigger_id of the original emission so they can trace back.
 */

import { getServiceClient } from '@/lib/supabase'
import { IdempotencyCheck, LotteryEvent } from './types'
import { idempotencyKey } from './normalize'

export async function checkAndReserveKey(event: LotteryEvent): Promise<IdempotencyCheck> {
  const key = idempotencyKey(event)
  const db = getServiceClient()

  // Try to insert a new row. If it conflicts, the event is a duplicate.
  const { error: insertError } = await db.from('idempotency_keys').insert({
    key,
    trigger_id: event.trigger_id,
  })

  if (!insertError) {
    return { isDuplicate: false, key }
  }

  // Unique violation → existing row wins. Fetch it to return the original
  // trigger_id so tracing is possible.
  const { data: existing } = await db
    .from('idempotency_keys')
    .select('trigger_id, first_seen_at, seen_count')
    .eq('key', key)
    .maybeSingle()

  // Bump seen_count for observability
  if (existing) {
    await db
      .from('idempotency_keys')
      .update({
        seen_count: (existing.seen_count || 1) + 1,
        last_seen_at: new Date().toISOString(),
      })
      .eq('key', key)
  }

  return {
    isDuplicate: true,
    key,
    firstSeenAt: existing?.first_seen_at,
    seenCount: (existing?.seen_count || 1) + 1,
  }
}
