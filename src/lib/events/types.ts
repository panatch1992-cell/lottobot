/**
 * events/types.ts — LOTTERY_RESULT_READY event pipeline types
 *
 * Event pipeline (step-by-step):
 *   1. Trigger source (scrape / telegram / manual / webhook) → RawTriggerInput
 *   2. normalize() → LotteryEvent (with result_hash)
 *   3. validate() → ValidationResult
 *   4. dedupe() → IdempotencyCheck
 *   5. preflight() → PreflightStatus
 *   6. dispatch() → DispatchJob
 *   7. delivery attempts → DeliveryLogRow (per target per attempt)
 */

export const LOTTERY_RESULT_READY = 'LOTTERY_RESULT_READY' as const

export type TriggerSource = 'scrape' | 'telegram' | 'manual' | 'webhook'

export type EventStatus =
  | 'received'
  | 'validated'
  | 'deduped'
  | 'queued'
  | 'dispatched'
  | 'failed'

export type JobStatus =
  | 'queued'
  | 'preflight'
  | 'dispatching'
  | 'succeeded'
  | 'failed'
  | 'dead_letter'
  | 'skipped'

export type DeliveryStatus = 'sent' | 'failed' | 'skipped' | 'retry'

export type BreakerState = 'closed' | 'open' | 'half_open'

// ─── Canonical payload ─────────────────────────────────
// All sources must normalize to this shape before entering the pipeline.
export interface LotteryEvent {
  event_type: typeof LOTTERY_RESULT_READY
  trigger_id: string              // idempotency: unique per source emission
  source: TriggerSource
  lottery_id: string              // uuid (must exist in lotteries table)
  draw_date: string               // YYYY-MM-DD
  round: string | null            // optional: งวดที่ xxx (null if not applicable)
  result_text: string             // canonical result text ("034 / 97")
  result_hash: string             // sha256(lottery_id|draw_date|round|result_text)
  numbers: {
    top_number?: string | null
    bottom_number?: string | null
    full_number?: string | null
  }
  metadata?: Record<string, unknown>
}

// Raw shape accepted by the ingest endpoint (result_hash computed server-side)
export interface RawTriggerInput {
  trigger_id?: string
  source?: TriggerSource | string
  lottery_id?: string
  draw_date?: string
  round?: string | null
  result_text?: string
  numbers?: {
    top_number?: string | null
    bottom_number?: string | null
    full_number?: string | null
  }
  metadata?: Record<string, unknown>
}

// ─── Validation ────────────────────────────────────────
export interface ValidationIssue {
  field: string
  message: string
}

export interface ValidationResult {
  ok: boolean
  issues: ValidationIssue[]
}

// ─── Idempotency ───────────────────────────────────────
export interface IdempotencyCheck {
  isDuplicate: boolean
  key: string
  firstSeenAt?: string
  seenCount?: number
}

// ─── Preflight ─────────────────────────────────────────
export interface PreflightStatus {
  ready: boolean
  clientReady: boolean
  breakerState: BreakerState
  endpoint: string | null
  latencyMs?: number
  reason?: string
  detail?: Record<string, unknown>
}

// ─── Dispatch job ──────────────────────────────────────
export interface DispatchJob {
  id: string
  trigger_event_id: string
  trigger_id: string
  lottery_id: string | null
  status: JobStatus
  attempt_no: number
  max_attempts: number
  next_attempt_at: string | null
  last_error: string | null
  last_error_code: string | null
  preflight_passed: boolean | null
  preflight_detail: Record<string, unknown> | null
  dispatched_at: string | null
  completed_at: string | null
  total_targets: number | null
  succeeded_targets: number
  failed_targets: number
  canary: boolean
  canary_group: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

// ─── Delivery log rows ─────────────────────────────────
export interface DeliveryLogRow {
  id?: string
  dispatch_job_id: string
  trigger_id: string
  target_type: 'line_group' | 'telegram_chat' | 'broadcast'
  target_id: string
  target_name?: string | null
  provider?: string | null
  attempt_no?: number
  status: DeliveryStatus
  http_status?: number | null
  latency_ms?: number | null
  error_message?: string | null
  error_code?: string | null
  sent_at?: string
}

// ─── Orchestrator result ───────────────────────────────
export interface OrchestratorResult {
  ok: boolean
  reason?: string
  trigger_event_id?: string
  dispatch_job_id?: string
  event?: LotteryEvent
  duplicate?: boolean
  validation?: ValidationResult
  preflight?: PreflightStatus
  dispatched?: {
    total: number
    succeeded: number
    failed: number
  }
}

// Retryable error classification
export function isRetryableError(err: unknown): boolean {
  if (!err) return false
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()
  if (lower.includes('timeout')) return true
  if (lower.includes('network')) return true
  if (lower.includes('econnreset')) return true
  if (lower.includes('econnrefused')) return true
  if (lower.includes('eai_again')) return true
  // HTTP 5xx
  const httpMatch = lower.match(/http\s*(\d{3})/)
  if (httpMatch) {
    const code = parseInt(httpMatch[1], 10)
    if (code >= 500 && code < 600) return true
    if (code === 429) return true
  }
  return false
}
