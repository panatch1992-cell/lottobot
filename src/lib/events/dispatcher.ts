/**
 * events/dispatcher.ts — Controlled dispatch to LINE groups with per-target
 * logging, retry policy, circuit-breaker recording and canary support.
 *
 * Strategy: reuse the existing /api/line/trigger endpoint (the "." OA reply
 * pattern already deployed in production) but instrument every target with
 * delivery_logs, apply jitter/delay between sends, and classify retry vs
 * dead-letter.
 */

import { getServiceClient, getSettings } from '@/lib/supabase'
import { sendText } from '@/lib/messaging-service'
import { sleep } from '@/lib/utils'
import type { LineGroup } from '@/types'
import {
  DispatchJob,
  LotteryEvent,
  isRetryableError,
} from './types'
import { recordDelivery, updateDispatchJob } from './logging'
import { recordFailure, recordSuccess } from './breaker'
import { fireAlert } from './alerts'

const TRIGGER_CHAR = '.'

interface DispatcherOptions {
  batchSize: number
  batchDelayMs: number
  jitterMs: number
  maxConcurrency: number
  maxAttempts: number
  retryBaseMs: number
  canaryEnabled: boolean
  canaryGroup: string | null
}

async function loadDispatcherOptions(): Promise<DispatcherOptions> {
  const settings = await getSettings()
  return {
    batchSize: parseInt(settings.event_batch_size || '5', 10),
    batchDelayMs: parseInt(settings.event_batch_delay_ms || '500', 10),
    jitterMs: parseInt(settings.event_batch_jitter_ms || '500', 10),
    maxConcurrency: parseInt(settings.event_max_concurrency || '1', 10),
    maxAttempts: parseInt(settings.event_max_attempts || '3', 10),
    retryBaseMs: parseInt(settings.event_retry_base_ms || '2000', 10),
    canaryEnabled: String(settings.event_canary_enabled || 'false').toLowerCase() === 'true',
    canaryGroup: settings.event_canary_group || null,
  }
}

async function loadTargetGroups(opts: DispatcherOptions): Promise<LineGroup[]> {
  const db = getServiceClient()
  const { data } = await db.from('line_groups').select('*').eq('is_active', true)
  const groups = (data || []) as LineGroup[]

  if (opts.canaryEnabled && opts.canaryGroup) {
    return groups.filter(g => g.name === opts.canaryGroup)
  }
  return groups
}

function jitter(ms: number): number {
  return Math.floor(Math.random() * ms)
}

async function sendWithRetry(
  targetId: string,
  officialTo: string,
  text: string,
  opts: DispatcherOptions,
): Promise<{ success: boolean; error?: string; attempts: number }> {
  let lastError = ''
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const start = Date.now()
    try {
      const res = await sendText(targetId, text, officialTo)
      if (res.success) return { success: true, attempts: attempt }
      lastError = res.error || 'unknown'
      if (!isRetryableError(lastError)) {
        return { success: false, error: lastError, attempts: attempt }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      if (!isRetryableError(err)) {
        return { success: false, error: lastError, attempts: attempt }
      }
    } finally {
      // tiny adaptive delay to prevent hot-looping on transient failure
      void start
    }

    if (attempt < opts.maxAttempts) {
      // exponential backoff with jitter
      const delay = opts.retryBaseMs * Math.pow(2, attempt - 1) + jitter(opts.jitterMs)
      await sleep(delay)
    }
  }
  return { success: false, error: lastError, attempts: opts.maxAttempts }
}

export interface DispatchReport {
  jobId: string
  total: number
  succeeded: number
  failed: number
  canary: boolean
  details: Array<{ group: string; success: boolean; attempts: number; error?: string }>
}

/**
 * Run a single dispatch job through to completion.
 * Writes delivery_logs, updates dispatch_job row, feeds breaker state.
 */
export async function runDispatchJob(
  job: DispatchJob,
  event: LotteryEvent,
): Promise<DispatchReport> {
  const opts = await loadDispatcherOptions()

  await updateDispatchJob(job.id, {
    status: 'dispatching',
    attempt_no: job.attempt_no + 1,
    dispatched_at: new Date().toISOString(),
  })

  const groups = await loadTargetGroups(opts)
  const total = groups.length

  await updateDispatchJob(job.id, { total_targets: total })

  if (total === 0) {
    await updateDispatchJob(job.id, {
      status: 'skipped',
      last_error: 'no active groups',
      completed_at: new Date().toISOString(),
    })
    return { jobId: job.id, total: 0, succeeded: 0, failed: 0, canary: opts.canaryEnabled, details: [] }
  }

  const details: DispatchReport['details'] = []
  let succeeded = 0
  let failed = 0

  // Simple batch + delay loop. We intentionally keep concurrency = 1 by default
  // to stay friendly with the unofficial endpoint.
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]
    const unofficialId = group.unofficial_group_id || (group.line_group_id || '').toLowerCase()
    const officialId = group.line_group_id || ''
    const targetId = unofficialId

    if (!targetId) {
      await recordDelivery({
        dispatch_job_id: job.id,
        trigger_id: job.trigger_id,
        target_type: 'line_group',
        target_id: '',
        target_name: group.name,
        provider: 'unofficial_line',
        status: 'skipped',
        error_message: 'no group id',
      })
      details.push({ group: group.name, success: false, attempts: 0, error: 'no group id' })
      failed++
      continue
    }

    const start = Date.now()
    const result = await sendWithRetry(targetId, officialId, TRIGGER_CHAR, opts)
    const latency = Date.now() - start

    await recordDelivery({
      dispatch_job_id: job.id,
      trigger_id: job.trigger_id,
      target_type: 'line_group',
      target_id: targetId,
      target_name: group.name,
      provider: 'unofficial_line',
      attempt_no: result.attempts,
      status: result.success ? 'sent' : 'failed',
      latency_ms: latency,
      error_message: result.error || null,
      sent_at: new Date().toISOString(),
    })

    details.push({
      group: group.name,
      success: result.success,
      attempts: result.attempts,
      error: result.error,
    })

    if (result.success) succeeded++
    else failed++

    // Batch boundary: every `batchSize` messages take a longer breather
    const delay = opts.batchDelayMs + jitter(opts.jitterMs)
    if ((i + 1) % opts.batchSize === 0) {
      await sleep(delay * 2)
    } else {
      await sleep(delay)
    }
  }

  // Final status + breaker integration
  if (succeeded > 0 && failed === 0) {
    await updateDispatchJob(job.id, {
      status: 'succeeded',
      succeeded_targets: succeeded,
      failed_targets: failed,
      completed_at: new Date().toISOString(),
      last_error: null,
    })
    await recordSuccess()
  } else if (succeeded > 0 && failed > 0) {
    // partial success — still considered success from breaker POV
    await updateDispatchJob(job.id, {
      status: 'succeeded',
      succeeded_targets: succeeded,
      failed_targets: failed,
      completed_at: new Date().toISOString(),
      last_error: `partial: ${failed}/${total} failed`,
    })
    await recordSuccess()
  } else {
    // all failed
    const errMsg = details.map(d => d.error).filter(Boolean)[0] || 'all targets failed'
    const nextStatus = job.attempt_no + 1 >= job.max_attempts ? 'dead_letter' : 'failed'
    await updateDispatchJob(job.id, {
      status: nextStatus,
      succeeded_targets: succeeded,
      failed_targets: failed,
      last_error: errMsg,
      completed_at: nextStatus === 'dead_letter' ? new Date().toISOString() : null,
    })
    const { opened } = await recordFailure(errMsg)
    if (opened) {
      await fireAlert({
        alert_key: 'breaker_open:lottery_dispatch',
        severity: 'critical',
        title: 'Circuit breaker OPEN (lottery_dispatch)',
        detail: `consecutive failures hit threshold. last_error: ${errMsg.slice(0, 180)}`,
        metadata: { jobId: job.id, trigger_id: event.trigger_id },
      })
    }
    if (nextStatus === 'dead_letter') {
      await fireAlert({
        alert_key: `dead_letter:${event.lottery_id || 'unknown'}`,
        severity: 'error',
        title: `Dispatch dead-lettered: ${event.lottery_id}`,
        detail: `trigger_id=${event.trigger_id} max attempts reached. last_error: ${errMsg.slice(0, 180)}`,
        metadata: { jobId: job.id, trigger_id: event.trigger_id },
      })
    }
  }

  return {
    jobId: job.id,
    total,
    succeeded,
    failed,
    canary: opts.canaryEnabled,
    details,
  }
}
