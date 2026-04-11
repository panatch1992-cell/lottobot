/**
 * events/dispatcher.ts — Controlled dispatch for lottery results
 *
 * Supports 3 modes via bot_settings.line_send_mode:
 *   - trigger    → send "." per group, OA Reply API answers for free
 *   - push       → send image+text per group (unofficial endpoint)
 *   - broadcast  → send once to all friends (Official LINE broadcast)
 *
 * Every dispatch writes:
 *   - delivery_logs rows per target (LINE groups + Telegram admin chat)
 *   - dispatch_job status transitions (queued → dispatching → succeeded|failed|dead_letter)
 *   - circuit breaker updates
 *   - alerts on breaker_open / dead_letter
 *
 * Retry:
 *   - Per-target in-process retry with exponential backoff + jitter
 *   - Only retryable errors (timeout, 5xx, 429, network) get retried
 *   - Failed final state feeds the circuit breaker
 */

import { getServiceClient, getSettings } from '@/lib/supabase'
import {
  sendText,
  pushTextMessage,
  pushImageAndText,
  broadcastImageAndText,
  broadcastText,
  flagMonthlyLimitHit,
} from '@/lib/messaging-service'
import { sendToTelegram } from '@/lib/telegram'
import { formatResult, formatTgAdminLog } from '@/lib/formatter'
import { sleep } from '@/lib/utils'
import type { Lottery, LineGroup, Result } from '@/types'
import {
  DispatchJob,
  LotteryEvent,
  isRetryableError,
} from './types'
import { recordDelivery, updateDispatchJob } from './logging'
import { recordFailure, recordSuccess } from './breaker'
import { fireAlert } from './alerts'

const TRIGGER_CHAR = '.'

type SendMode = 'trigger' | 'push' | 'broadcast'

interface DispatcherOptions {
  mode: SendMode
  batchSize: number
  batchDelayMs: number
  jitterMs: number
  maxAttempts: number
  retryBaseMs: number
  canaryEnabled: boolean
  canaryGroup: string | null
  theme: string
  fontStyle: string
  digitSize: string
  layout: string
  telegramBotToken: string | null
  telegramAdminChannel: string | null
}

async function loadDispatcherOptions(): Promise<DispatcherOptions> {
  const settings = await getSettings()
  const rawMode = (settings.line_send_mode || 'push').toLowerCase()
  const mode: SendMode =
    rawMode === 'trigger' ? 'trigger' :
    rawMode === 'broadcast' ? 'broadcast' :
    'push'

  return {
    mode,
    batchSize: parseInt(settings.event_batch_size || '5', 10),
    batchDelayMs: parseInt(settings.event_batch_delay_ms || '500', 10),
    jitterMs: parseInt(settings.event_batch_jitter_ms || '500', 10),
    maxAttempts: parseInt(settings.event_max_attempts || '2', 10),
    retryBaseMs: parseInt(settings.event_retry_base_ms || '1000', 10),
    canaryEnabled: String(settings.event_canary_enabled || 'false').toLowerCase() === 'true',
    canaryGroup: settings.event_canary_group || null,
    theme: settings.default_theme || 'shopee',
    fontStyle: settings.default_font_style || 'rounded',
    digitSize: settings.default_digit_size || 'm',
    layout: settings.default_layout || 'horizontal',
    telegramBotToken: settings.telegram_bot_token || null,
    telegramAdminChannel: settings.telegram_admin_channel || null,
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

// Build image URL for push mode (theme/font/etc. come from settings)
function buildImageUrl(lottery: Lottery, result: Result, opts: DispatcherOptions): string {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
    || 'https://lottobot-chi.vercel.app'
  const thaiDate = new Date(result.draw_date).toLocaleDateString('th-TH', {
    year: '2-digit', month: 'short', day: 'numeric',
  })
  const params = new URLSearchParams({
    lottery_name: lottery.name,
    flag: lottery.flag,
    date: thaiDate,
    ...(result.top_number ? { top_number: result.top_number } : {}),
    ...(result.bottom_number ? { bottom_number: result.bottom_number } : {}),
    ...(result.full_number ? { full_number: result.full_number } : {}),
    theme: opts.theme,
    font_style: opts.fontStyle,
    digit_size: opts.digitSize,
    layout: opts.layout,
  })
  return `${baseUrl}/api/generate-image?${params.toString()}`
}

// Generic retry wrapper for a single send callable
async function withRetry<T extends { success: boolean; error?: string }>(
  fn: () => Promise<T>,
  opts: DispatcherOptions,
): Promise<{ result: T; attempts: number }> {
  let attempts = 0
  let lastResult: T = { success: false, error: 'no attempts' } as T

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    attempts = attempt
    try {
      const res = await fn()
      lastResult = res
      if (res.success) return { result: res, attempts }
      if (!isRetryableError(res.error || '')) return { result: res, attempts }
    } catch (err) {
      lastResult = { success: false, error: err instanceof Error ? err.message : String(err) } as T
      if (!isRetryableError(err)) return { result: lastResult, attempts }
    }

    if (attempt < opts.maxAttempts) {
      const delay = opts.retryBaseMs * Math.pow(2, attempt - 1) + jitter(opts.jitterMs)
      await sleep(delay)
    }
  }
  return { result: lastResult, attempts }
}

// ─── Telegram admin log ───────────────────────────────
async function sendTelegramAdminLog(
  jobId: string,
  triggerId: string,
  lottery: Lottery,
  result: Result,
  lineGroupCount: number,
  opts: DispatcherOptions,
): Promise<void> {
  if (!opts.telegramBotToken || !opts.telegramAdminChannel) return

  const msg = formatTgAdminLog(lottery, result, lineGroupCount, 0)
  const start = Date.now()
  const { result: res, attempts } = await withRetry(
    () => sendToTelegram(opts.telegramBotToken!, opts.telegramAdminChannel!, msg),
    opts,
  )
  const latency = Date.now() - start

  await recordDelivery({
    dispatch_job_id: jobId,
    trigger_id: triggerId,
    target_type: 'telegram_chat',
    target_id: opts.telegramAdminChannel!,
    target_name: 'admin_channel',
    provider: 'telegram',
    attempt_no: attempts,
    status: res.success ? 'sent' : 'failed',
    latency_ms: latency,
    error_message: res.error || null,
  })
}

// ─── Mode: trigger ("." per group) ─────────────────────
async function dispatchTrigger(
  job: DispatchJob,
  groups: LineGroup[],
  opts: DispatcherOptions,
): Promise<{ succeeded: number; failed: number; details: Array<{ group: string; success: boolean; attempts: number; error?: string }> }> {
  let succeeded = 0
  let failed = 0
  const details: Array<{ group: string; success: boolean; attempts: number; error?: string }> = []

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]
    const unofficialId = group.unofficial_group_id || (group.line_group_id || '').toLowerCase()
    const officialId = group.line_group_id || ''
    const targetId = unofficialId

    if (!targetId) {
      await recordDelivery({
        dispatch_job_id: job.id, trigger_id: job.trigger_id,
        target_type: 'line_group', target_id: '', target_name: group.name,
        provider: 'unofficial_line', status: 'skipped', error_message: 'no group id',
      })
      details.push({ group: group.name, success: false, attempts: 0, error: 'no group id' })
      failed++
      continue
    }

    const start = Date.now()
    const { result, attempts } = await withRetry(
      () => sendText(targetId, TRIGGER_CHAR, officialId),
      opts,
    )
    const latency = Date.now() - start

    await recordDelivery({
      dispatch_job_id: job.id, trigger_id: job.trigger_id,
      target_type: 'line_group', target_id: targetId, target_name: group.name,
      provider: 'unofficial_line', attempt_no: attempts,
      status: result.success ? 'sent' : 'failed',
      latency_ms: latency, error_message: result.error || null,
    })

    if (result.success) succeeded++
    else failed++
    details.push({ group: group.name, success: result.success, attempts, error: result.error })

    const delay = opts.batchDelayMs + jitter(opts.jitterMs)
    await sleep((i + 1) % opts.batchSize === 0 ? delay * 2 : delay)
  }

  return { succeeded, failed, details }
}

// ─── Mode: push (image+text per group) ─────────────────
async function dispatchPush(
  job: DispatchJob,
  lottery: Lottery,
  result: Result,
  groups: LineGroup[],
  opts: DispatcherOptions,
): Promise<{ succeeded: number; failed: number; details: Array<{ group: string; success: boolean; attempts: number; error?: string }> }> {
  const db = getServiceClient()
  const formatted = formatResult(lottery, result)
  const imageUrl = buildImageUrl(lottery, result, opts)

  // Per-group mapping: which groups receive which lotteries
  const { data: allGroupLotteries } = await db.from('group_lotteries').select('group_id, lottery_id')
  const groupLotteryMap = new Map<string, Set<string>>()
  for (const gl of allGroupLotteries || []) {
    if (!groupLotteryMap.has(gl.group_id)) groupLotteryMap.set(gl.group_id, new Set())
    groupLotteryMap.get(gl.group_id)!.add(gl.lottery_id)
  }

  let succeeded = 0
  let failed = 0
  const details: Array<{ group: string; success: boolean; attempts: number; error?: string }> = []

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i] as LineGroup & { send_all_lotteries?: boolean; custom_link?: string; custom_message?: string }
    const unofficialId = group.unofficial_group_id || (group.line_group_id || '').toLowerCase()
    const officialId = group.line_group_id || ''
    const primaryId = unofficialId || officialId

    if (!primaryId) {
      await recordDelivery({
        dispatch_job_id: job.id, trigger_id: job.trigger_id,
        target_type: 'line_group', target_id: '', target_name: group.name,
        provider: 'unofficial_line', status: 'skipped', error_message: 'no group id',
      })
      details.push({ group: group.name, success: false, attempts: 0, error: 'no group id' })
      failed++
      continue
    }

    // Selective lottery routing
    const sendAll = group.send_all_lotteries !== false
    if (!sendAll) {
      const allowed = groupLotteryMap.get(group.id)
      if (!allowed || !allowed.has(lottery.id)) {
        await recordDelivery({
          dispatch_job_id: job.id, trigger_id: job.trigger_id,
          target_type: 'line_group', target_id: primaryId, target_name: group.name,
          provider: 'unofficial_line', status: 'skipped',
          error_message: 'lottery not in group subscription',
        })
        details.push({ group: group.name, success: false, attempts: 0, error: 'not subscribed' })
        continue
      }
    }

    let lineMsg = formatted.line
    if (group.custom_message) lineMsg += `\n${group.custom_message}`
    if (group.custom_link) lineMsg += `\n🔗 ${group.custom_link}`

    const start = Date.now()
    // Try image+text first, fall back to plain text on non-quota failures
    const { result: primary, attempts } = await withRetry(async () => {
      const r = await pushImageAndText('', primaryId, imageUrl, lineMsg, officialId)
      if (!r.success && r.error?.includes('monthly limit')) {
        await flagMonthlyLimitHit()
      }
      return r
    }, opts)

    let finalResult = primary
    let finalAttempts = attempts
    if (!primary.success && !primary.error?.includes('monthly limit')) {
      const fallback = await withRetry(
        () => pushTextMessage('', primaryId, lineMsg, officialId),
        opts,
      )
      if (fallback.result.success) {
        finalResult = fallback.result
        finalAttempts = attempts + fallback.attempts
      }
    }

    const latency = Date.now() - start
    await recordDelivery({
      dispatch_job_id: job.id, trigger_id: job.trigger_id,
      target_type: 'line_group', target_id: primaryId, target_name: group.name,
      provider: 'unofficial_line', attempt_no: finalAttempts,
      status: finalResult.success ? 'sent' : 'failed',
      latency_ms: latency, error_message: finalResult.error || null,
    })

    if (finalResult.success) succeeded++
    else failed++
    details.push({ group: group.name, success: finalResult.success, attempts: finalAttempts, error: finalResult.error })

    const delay = opts.batchDelayMs + jitter(opts.jitterMs)
    await sleep((i + 1) % opts.batchSize === 0 ? delay * 2 : delay)
  }

  return { succeeded, failed, details }
}

// ─── Mode: broadcast (single send to all friends) ──────
async function dispatchBroadcast(
  job: DispatchJob,
  lottery: Lottery,
  result: Result,
  opts: DispatcherOptions,
): Promise<{ succeeded: number; failed: number; details: Array<{ group: string; success: boolean; attempts: number; error?: string }> }> {
  const formatted = formatResult(lottery, result)
  const imageUrl = buildImageUrl(lottery, result, opts)

  const start = Date.now()
  const { result: primary, attempts } = await withRetry(async () => {
    const r = await broadcastImageAndText('', imageUrl, formatted.line)
    if (!r.success && r.error?.includes('monthly limit')) {
      await flagMonthlyLimitHit()
    }
    return r
  }, opts)

  let finalResult = primary
  let finalAttempts = attempts
  if (!primary.success && !primary.error?.includes('monthly limit')) {
    const fallback = await withRetry(
      () => broadcastText('', formatted.line),
      opts,
    )
    if (fallback.result.success) {
      finalResult = fallback.result
      finalAttempts = attempts + fallback.attempts
    }
  }
  const latency = Date.now() - start

  await recordDelivery({
    dispatch_job_id: job.id, trigger_id: job.trigger_id,
    target_type: 'broadcast', target_id: 'all_friends', target_name: 'broadcast',
    provider: 'official_line', attempt_no: finalAttempts,
    status: finalResult.success ? 'sent' : 'failed',
    latency_ms: latency, error_message: finalResult.error || null,
  })

  return {
    succeeded: finalResult.success ? 1 : 0,
    failed: finalResult.success ? 0 : 1,
    details: [{ group: 'broadcast', success: finalResult.success, attempts: finalAttempts, error: finalResult.error }],
  }
}

// ─── Load lottery + result from DB for a LotteryEvent ──
async function loadLotteryAndResult(
  event: LotteryEvent,
): Promise<{ lottery: Lottery | null; result: Result | null }> {
  const db = getServiceClient()
  const [lotteryRes, resultRes] = await Promise.all([
    db.from('lotteries').select('*').eq('id', event.lottery_id).maybeSingle(),
    db.from('results').select('*').eq('lottery_id', event.lottery_id).eq('draw_date', event.draw_date).maybeSingle(),
  ])
  return {
    lottery: (lotteryRes.data || null) as Lottery | null,
    result: (resultRes.data || null) as Result | null,
  }
}

// ─── Dispatch report shape ─────────────────────────────
export interface DispatchReport {
  jobId: string
  mode: SendMode
  total: number
  succeeded: number
  failed: number
  canary: boolean
  details: Array<{ group: string; success: boolean; attempts: number; error?: string }>
}

/**
 * Run a single dispatch job through to completion.
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

  const { lottery, result } = await loadLotteryAndResult(event)
  if (!lottery || !result) {
    await updateDispatchJob(job.id, {
      status: 'failed',
      last_error: 'lottery or result row not found',
      completed_at: new Date().toISOString(),
    })
    return { jobId: job.id, mode: opts.mode, total: 0, succeeded: 0, failed: 0, canary: opts.canaryEnabled, details: [] }
  }

  const groups = await loadTargetGroups(opts)

  // Telegram admin log (independent of mode — always send)
  await sendTelegramAdminLog(job.id, job.trigger_id, lottery, result, groups.length, opts)

  // LINE dispatch per mode
  let outcome: { succeeded: number; failed: number; details: Array<{ group: string; success: boolean; attempts: number; error?: string }> }

  if (opts.mode === 'broadcast') {
    outcome = await dispatchBroadcast(job, lottery, result, opts)
  } else if (groups.length === 0) {
    await updateDispatchJob(job.id, {
      status: 'skipped',
      total_targets: 0,
      last_error: 'no active groups',
      completed_at: new Date().toISOString(),
    })
    return { jobId: job.id, mode: opts.mode, total: 0, succeeded: 0, failed: 0, canary: opts.canaryEnabled, details: [] }
  } else if (opts.mode === 'trigger') {
    outcome = await dispatchTrigger(job, groups, opts)
  } else {
    outcome = await dispatchPush(job, lottery, result, groups, opts)
  }

  await updateDispatchJob(job.id, {
    total_targets: outcome.succeeded + outcome.failed,
    succeeded_targets: outcome.succeeded,
    failed_targets: outcome.failed,
  })

  // Finalize + breaker
  if (outcome.succeeded > 0) {
    await updateDispatchJob(job.id, {
      status: 'succeeded',
      completed_at: new Date().toISOString(),
      last_error: outcome.failed > 0 ? `partial: ${outcome.failed} failed` : null,
    })
    await recordSuccess()
  } else {
    const errMsg = outcome.details.map(d => d.error).filter(Boolean)[0] || 'all targets failed'
    const nextStatus = job.attempt_no + 1 >= job.max_attempts ? 'dead_letter' : 'failed'
    await updateDispatchJob(job.id, {
      status: nextStatus,
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
        title: `Dispatch dead-lettered: ${lottery.name}`,
        detail: `trigger_id=${event.trigger_id} max attempts reached. last_error: ${errMsg.slice(0, 180)}`,
        metadata: { jobId: job.id, trigger_id: event.trigger_id },
      })
    }
  }

  return {
    jobId: job.id,
    mode: opts.mode,
    total: outcome.succeeded + outcome.failed,
    succeeded: outcome.succeeded,
    failed: outcome.failed,
    canary: opts.canaryEnabled,
    details: outcome.details,
  }
}
