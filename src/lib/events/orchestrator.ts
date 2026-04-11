/**
 * events/orchestrator.ts — LOTTERY_RESULT_READY pipeline entry point
 *
 * Flow (step-by-step, matches customer spec):
 *   1. normalize raw input → canonical LotteryEvent
 *   2. validate (required fields, date/number format)
 *   3. record trigger_event (status: received)
 *   4. dedupe via idempotency_keys
 *   5. preflight gate (breaker + /health)
 *   6. create dispatch_job (status: queued → preflight → dispatching)
 *   7. runDispatchJob: controlled send + per-target delivery_logs
 *   8. finalize trigger_event status + return OrchestratorResult
 *
 * This function is called from three entrypoints:
 *   - POST /api/events/ingest            (orchestrator webhook)
 *   - POST /api/events/manual            (admin manual fallback)
 *   - internal: saveAndSend in cron/scrape (feature-flagged)
 */

import { getSettings } from '@/lib/supabase'
import {
  OrchestratorResult,
  RawTriggerInput,
  ValidationResult,
} from './types'
import { normalizeEvent } from './normalize'
import { validateEvent } from './validate'
import { checkAndReserveKey } from './idempotency'
import { runPreflight } from './preflight'
import {
  createDispatchJob,
  recordTriggerEvent,
  updateTriggerStatus,
} from './logging'
import { runDispatchJob } from './dispatcher'
import { fireAlert } from './alerts'

async function pipelineEnabled(): Promise<boolean> {
  const settings = await getSettings()
  const flag = String(settings.event_pipeline_enabled || 'true').toLowerCase()
  return flag === 'true' || flag === '1' || flag === 'on' || flag === 'yes'
}

export async function ingestEvent(input: RawTriggerInput): Promise<OrchestratorResult> {
  // ─── 1. Kill switch ────────────────────────────────
  if (!(await pipelineEnabled())) {
    return { ok: false, reason: 'pipeline disabled' }
  }

  // ─── 2. Normalize ──────────────────────────────────
  const event = normalizeEvent(input)

  // ─── 3. Validate ───────────────────────────────────
  const validation: ValidationResult = validateEvent(event)

  if (!validation.ok) {
    // Record failing trigger for forensics; no dispatch, no breaker touch.
    const te = await recordTriggerEvent(event, 'failed', validation)
    await fireAlert({
      alert_key: `validation_failed:${event.source}`,
      severity: 'warn',
      title: 'Trigger validation failed',
      detail: validation.issues.map(i => `${i.field}: ${i.message}`).join('\n'),
      metadata: { trigger_id: event.trigger_id, source: event.source },
    })
    return {
      ok: false,
      reason: 'validation_failed',
      trigger_event_id: te?.id,
      event,
      validation,
    }
  }

  // ─── 4. Record trigger event (received) ────────────
  const trigger = await recordTriggerEvent(event, 'received')
  if (!trigger) {
    return { ok: false, reason: 'trigger_event_insert_failed', event }
  }

  // ─── 5. Dedupe ─────────────────────────────────────
  const dedupe = await checkAndReserveKey(event)
  if (dedupe.isDuplicate) {
    await updateTriggerStatus(trigger.id, 'deduped', {
      validation_errors: null,
    })
    return {
      ok: true,
      reason: 'duplicate',
      duplicate: true,
      trigger_event_id: trigger.id,
      event,
    }
  }
  await updateTriggerStatus(trigger.id, 'validated')

  // ─── 6. Preflight ──────────────────────────────────
  const preflight = await runPreflight()
  if (!preflight.ready) {
    await updateTriggerStatus(trigger.id, 'failed')
    await fireAlert({
      alert_key: `preflight_failed:${preflight.reason || 'unknown'}`,
      severity: 'error',
      title: 'Preflight gate failed',
      detail: `reason: ${preflight.reason}\nbreaker: ${preflight.breakerState}`,
      metadata: { trigger_id: event.trigger_id, preflight: preflight as unknown as Record<string, unknown> },
    })
    return {
      ok: false,
      reason: `preflight_failed:${preflight.reason}`,
      trigger_event_id: trigger.id,
      event,
      preflight,
    }
  }

  // ─── 7. Dispatch job ───────────────────────────────
  const settings = await getSettings()
  const canaryEnabled = String(settings.event_canary_enabled || 'false').toLowerCase() === 'true'
  const maxAttempts = parseInt(settings.event_max_attempts || '3', 10)

  const job = await createDispatchJob(trigger.id, event.trigger_id, event.lottery_id || null, {
    maxAttempts,
    canary: canaryEnabled,
    canaryGroup: settings.event_canary_group || null,
  })

  if (!job) {
    await updateTriggerStatus(trigger.id, 'failed')
    return { ok: false, reason: 'dispatch_job_insert_failed', trigger_event_id: trigger.id, event }
  }

  await updateTriggerStatus(trigger.id, 'queued')

  // ─── 8. Run dispatch ───────────────────────────────
  const report = await runDispatchJob(job, event)

  await updateTriggerStatus(trigger.id, 'dispatched')

  return {
    ok: report.succeeded > 0,
    trigger_event_id: trigger.id,
    dispatch_job_id: job.id,
    event,
    preflight,
    dispatched: {
      total: report.total,
      succeeded: report.succeeded,
      failed: report.failed,
    },
  }
}
