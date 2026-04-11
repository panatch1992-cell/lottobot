/**
 * events/logging.ts — Writes to the 3-layer log tables
 *
 *   trigger_events   (1 per incoming trigger)
 *   dispatch_jobs    (1 per dispatch attempt lifecycle)
 *   delivery_logs    (1 per target per attempt)
 *
 * Kept intentionally separate from send_logs so the legacy scrape cron
 * continues writing to send_logs without interference.
 */

import { getServiceClient } from '@/lib/supabase'
import {
  DeliveryLogRow,
  DispatchJob,
  EventStatus,
  JobStatus,
  LotteryEvent,
  ValidationResult,
} from './types'

// ─── trigger_events ────────────────────────────────────
export async function recordTriggerEvent(
  event: LotteryEvent,
  status: EventStatus = 'received',
  validation?: ValidationResult,
): Promise<{ id: string } | null> {
  const db = getServiceClient()
  const row = {
    trigger_id: event.trigger_id,
    event_type: event.event_type,
    source: event.source,
    lottery_id: event.lottery_id || null,
    draw_date: event.draw_date || null,
    round: event.round,
    result_text: event.result_text || '',
    result_hash: event.result_hash || '',
    payload: event as unknown as Record<string, unknown>,
    status,
    validation_errors: validation?.issues && validation.issues.length > 0
      ? (validation.issues as unknown as Record<string, unknown>)
      : null,
  }

  // Upsert on trigger_id so a retry of the same trigger_id doesn't blow up
  const { data, error } = await db
    .from('trigger_events')
    .upsert(row, { onConflict: 'trigger_id' })
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[events/logging] trigger_events upsert failed:', error.message)
    return null
  }
  return data ? { id: data.id } : null
}

export async function updateTriggerStatus(
  triggerEventId: string,
  status: EventStatus,
  patch: Record<string, unknown> = {},
): Promise<void> {
  const db = getServiceClient()
  const { error } = await db
    .from('trigger_events')
    .update({ status, processed_at: new Date().toISOString(), ...patch })
    .eq('id', triggerEventId)
  if (error) console.error('[events/logging] trigger_events update failed:', error.message)
}

// ─── dispatch_jobs ─────────────────────────────────────
export async function createDispatchJob(
  triggerEventId: string,
  triggerId: string,
  lotteryId: string | null,
  opts: { maxAttempts?: number; canary?: boolean; canaryGroup?: string | null } = {},
): Promise<DispatchJob | null> {
  const db = getServiceClient()
  const { data, error } = await db
    .from('dispatch_jobs')
    .insert({
      trigger_event_id: triggerEventId,
      trigger_id: triggerId,
      lottery_id: lotteryId,
      status: 'queued',
      attempt_no: 0,
      max_attempts: opts.maxAttempts ?? 3,
      canary: opts.canary ?? false,
      canary_group: opts.canaryGroup ?? null,
    })
    .select('*')
    .single()

  if (error) {
    console.error('[events/logging] dispatch_jobs insert failed:', error.message)
    return null
  }
  return data as DispatchJob
}

export async function updateDispatchJob(
  jobId: string,
  patch: Partial<Omit<DispatchJob, 'id' | 'trigger_event_id' | 'trigger_id' | 'created_at'>> & {
    status?: JobStatus
  },
): Promise<void> {
  const db = getServiceClient()
  const { error } = await db
    .from('dispatch_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', jobId)
  if (error) console.error('[events/logging] dispatch_jobs update failed:', error.message)
}

// ─── delivery_logs ─────────────────────────────────────
export async function recordDelivery(row: DeliveryLogRow): Promise<void> {
  const db = getServiceClient()
  const { error } = await db.from('delivery_logs').insert({
    dispatch_job_id: row.dispatch_job_id,
    trigger_id: row.trigger_id,
    target_type: row.target_type,
    target_id: row.target_id,
    target_name: row.target_name || null,
    provider: row.provider || null,
    attempt_no: row.attempt_no ?? 1,
    status: row.status,
    http_status: row.http_status ?? null,
    latency_ms: row.latency_ms ?? null,
    error_message: row.error_message ?? null,
    error_code: row.error_code ?? null,
    sent_at: row.sent_at || new Date().toISOString(),
  })
  if (error) console.error('[events/logging] delivery_logs insert failed:', error.message)
}
