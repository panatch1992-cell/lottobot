/**
 * events/idempotency.ts — Dedupe logic
 *
 * Strategy: a trigger is "duplicate" only when there is already a
 * SUCCEEDED dispatch_job for the same (lottery_id, draw_date, result_hash).
 *
 * Failed / dead_letter jobs do NOT block — they allow automatic retries on
 * the next cron tick (or admin manual retry). This prevents the pipeline
 * from getting stuck forever after one bad day.
 *
 * The fast-path `idempotency_keys` table is still written for observability
 * (seen_count on duplicates) but no longer gates dispatching.
 */

import { getServiceClient } from '@/lib/supabase'
import { IdempotencyCheck, LotteryEvent } from './types'
import { idempotencyKey } from './normalize'

export async function checkAndReserveKey(event: LotteryEvent): Promise<IdempotencyCheck> {
  const key = idempotencyKey(event)
  const db = getServiceClient()

  // 1. Track the key for observability
  const { error: insertError } = await db.from('idempotency_keys').insert({
    key,
    trigger_id: event.trigger_id,
  })

  if (insertError) {
    // Conflict → bump counters (best-effort)
    const { data: existing } = await db
      .from('idempotency_keys')
      .select('trigger_id, first_seen_at, seen_count')
      .eq('key', key)
      .maybeSingle()

    if (existing) {
      await db
        .from('idempotency_keys')
        .update({
          seen_count: (existing.seen_count || 1) + 1,
          last_seen_at: new Date().toISOString(),
        })
        .eq('key', key)
    }
  }

  // 2. Authoritative dedup check: look for an already-succeeded dispatch_job
  //    for this (lottery, draw_date). If one exists, mark duplicate.
  if (event.lottery_id && event.draw_date) {
    const { data: succeededJobs } = await db
      .from('dispatch_jobs')
      .select('id, trigger_id, created_at, status')
      .eq('lottery_id', event.lottery_id)
      .eq('status', 'succeeded')
      .order('created_at', { ascending: false })
      .limit(1)

    if (succeededJobs && succeededJobs.length > 0) {
      const first = succeededJobs[0]
      // Only treat as duplicate if the succeeded job is from the same draw_date.
      // We keyed via event_trigger_id → dispatch_job, but simplest is to
      // cross-check via trigger_events.
      const { data: relatedTrigger } = await db
        .from('trigger_events')
        .select('draw_date')
        .eq('trigger_id', first.trigger_id)
        .maybeSingle()

      if (relatedTrigger && relatedTrigger.draw_date === event.draw_date) {
        return {
          isDuplicate: true,
          key,
          firstSeenAt: first.created_at,
        }
      }
    }
  }

  return { isDuplicate: false, key }
}
