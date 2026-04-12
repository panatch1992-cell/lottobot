/**
 * hybrid/bot-account-rotation.ts
 *
 * Rotation pool ของ LINE user accounts ที่ใช้เป็น self-bot trigger sender
 *
 * เลือก bot account หนึ่งตัวต่อ send:
 *   - is_active = true
 *   - cooldown_until IS NULL OR < now
 *   - เรียง priority (ต่ำ = ใช้ก่อน), then last_used_at (เก่าสุดก่อน)
 *
 * บันทึก outcome หลัง send:
 *   - success → reset consecutive_failures, update counters
 *   - failure → +1 consecutive_failures, อาจ auto-pause
 *
 * Auto-pause:
 *   - consecutive_failures >= 3 และ error code 401/403/429
 *   → set cooldown_until = now + bot_account_cooldown_min minutes
 *   → fire alert
 *
 * ถ้า rotation disabled (bot_account_rotation_enabled=false):
 *   - getNextBotAccount() → null → dispatcher ใช้ default unofficial endpoint
 */

import { getServiceClient, getSettings } from '@/lib/supabase'
import { sendText } from '@/lib/messaging-service'
import { fireAlert } from '@/lib/events/alerts'
import type { BotAccount } from '@/types'

type SendResult = {
  success: boolean
  error?: string
  unofficialError?: string
  fallbackSkipped?: boolean
}

export interface SendViaRotationOptions {
  /**
   * Disable Official LINE API fallback on the self-bot side.
   * Hybrid trigger sends MUST set this — Official push can't
   * generate the replyToken we need and wastes monthly quota.
   */
  noFallback?: boolean
}

const DEFAULT_COOLDOWN_MIN = 30
const AUTO_PAUSE_THRESHOLD = 3

async function rotationEnabled(): Promise<boolean> {
  const settings = await getSettings()
  return String(settings.bot_account_rotation_enabled || 'false').toLowerCase() === 'true'
}

async function autoPauseEnabled(): Promise<boolean> {
  const settings = await getSettings()
  return String(settings.bot_account_auto_pause_on_error || 'true').toLowerCase() === 'true'
}

async function cooldownMinutes(): Promise<number> {
  const settings = await getSettings()
  const n = parseInt(settings.bot_account_cooldown_min || '', 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_COOLDOWN_MIN
}

/**
 * เลือก bot account ถัดไปจาก rotation pool
 * Returns null ถ้า disabled หรือไม่มี account พร้อมใช้
 */
export async function getNextBotAccount(): Promise<BotAccount | null> {
  if (!(await rotationEnabled())) return null

  const db = getServiceClient()
  const nowIso = new Date().toISOString()

  const { data, error } = await db
    .from('bot_accounts')
    .select('*')
    .eq('is_active', true)
    .or(`cooldown_until.is.null,cooldown_until.lt.${nowIso}`)
    .order('priority', { ascending: true })
    .order('last_used_at', { ascending: true, nullsFirst: true })
    .limit(1)

  if (error) {
    console.warn('[bot-rotation] getNextBotAccount error:', error.message)
    return null
  }

  return ((data || [])[0] as BotAccount) || null
}

/**
 * Mark account as used และ update counters (best effort)
 */
export async function markAccountUsed(
  accountId: string,
  success: boolean,
  errorMsg?: string,
): Promise<void> {
  const db = getServiceClient()
  const nowIso = new Date().toISOString()

  // Read current counters
  const { data: current } = await db
    .from('bot_accounts')
    .select('*')
    .eq('id', accountId)
    .maybeSingle()
  if (!current) return

  const next: Record<string, unknown> = {
    last_used_at: nowIso,
    updated_at: nowIso,
  }

  if (success) {
    next.consecutive_failures = 0
    next.consecutive_successes = (current.consecutive_successes || 0) + 1
    next.daily_send_count = (current.daily_send_count || 0) + 1
    next.hourly_send_count = (current.hourly_send_count || 0) + 1
    next.health_status = 'healthy'
  } else {
    const failures = (current.consecutive_failures || 0) + 1
    next.consecutive_failures = failures
    next.consecutive_successes = 0
    next.last_error = (errorMsg || 'unknown').slice(0, 500)
    next.last_error_at = nowIso

    // Auto-pause logic
    const isBanSignal =
      !!errorMsg &&
      (/401|403|429|ban|block|suspend|rate.?limit/i.test(errorMsg))

    if (isBanSignal && (await autoPauseEnabled()) && failures >= AUTO_PAUSE_THRESHOLD) {
      const cooldownMs = (await cooldownMinutes()) * 60_000
      next.cooldown_until = new Date(Date.now() + cooldownMs).toISOString()
      next.health_status = 'cooldown'

      // Fire alert (best-effort, non-blocking)
      void fireAlert({
        alert_key: `bot_account_paused:${accountId}`,
        severity: 'error',
        title: `Bot account paused: ${current.name}`,
        detail: `${failures} consecutive failures with ban signal. Cooldown until ${next.cooldown_until}. last_error: ${String(errorMsg).slice(0, 180)}`,
        metadata: { accountId },
      })
    } else if (failures >= AUTO_PAUSE_THRESHOLD) {
      next.health_status = 'degraded'
    }
  }

  const { error } = await db.from('bot_accounts').update(next).eq('id', accountId)
  if (error) {
    console.warn('[bot-rotation] markAccountUsed update error:', error.message)
  }
}

/**
 * ส่งข้อความผ่าน bot account ที่ round-robin เลือกมา
 * ถ้า rotation disabled → fallback default unofficial endpoint (messaging-service.sendText)
 *
 * Returns result + accountId ที่ใช้ (null ถ้า fallback)
 */
export async function sendViaRotation(
  to: string,
  text: string,
  officialTo?: string,
  options: SendViaRotationOptions = {},
): Promise<{ result: SendResult; accountId: string | null }> {
  const account = await getNextBotAccount()

  if (!account) {
    // Rotation disabled or no available account → fallback default
    const result = await sendText(to, text, officialTo, { noFallback: options.noFallback })
    return { result, accountId: null }
  }

  // If account has custom endpoint, call it directly; otherwise use default
  if (account.endpoint_url) {
    const result = await callBotEndpoint(account, to, text, officialTo, options)
    await markAccountUsed(account.id, result.success, result.error)
    return { result, accountId: account.id }
  }

  // Shared endpoint path — still track usage on this account row
  const result = await sendText(to, text, officialTo, { noFallback: options.noFallback })
  await markAccountUsed(account.id, result.success, result.error)
  return { result, accountId: account.id }
}

async function callBotEndpoint(
  account: BotAccount,
  to: string,
  text: string,
  officialTo: string | undefined,
  options: SendViaRotationOptions,
): Promise<SendResult> {
  if (!account.endpoint_url) {
    return { success: false, error: 'no endpoint_url' }
  }
  const base = account.endpoint_url.replace(/\/+$/, '')
  const sendUrl = base.endsWith('/send') ? base : `${base}/send`

  try {
    const res = await fetch(sendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(account.endpoint_token ? { Authorization: `Bearer ${account.endpoint_token}` } : {}),
      },
      body: JSON.stringify({
        mode: 'push_text',
        to,
        text,
        ...(officialTo ? { officialTo } : {}),
        ...(options.noFallback ? { no_fallback: true } : {}),
      }),
    })

    const data = await res.json().catch(() => null) as (Record<string, unknown> | null)

    if (!res.ok) {
      const errorMsg = (data?.error as string) || `HTTP ${res.status}`
      return {
        success: false,
        error: `HTTP ${res.status}: ${errorMsg.slice(0, 200)}`,
        unofficialError: (data?.unofficial_error as string) || undefined,
        fallbackSkipped: Boolean(data?.fallback_skipped),
      }
    }

    if (data && data.success === false) {
      return {
        success: false,
        error: (data.error as string) || 'endpoint returned failure',
        unofficialError: (data.unofficial_error as string) || undefined,
      }
    }
    return {
      success: true,
      unofficialError: (data?.unofficial_error as string) || undefined,
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}

/**
 * Daily counter reset — เรียกจาก maintenance cron
 */
export async function resetDailyCounters(): Promise<number> {
  const db = getServiceClient()
  const nowIso = new Date().toISOString()
  const { count } = await db
    .from('bot_accounts')
    .update(
      {
        daily_send_count: 0,
        daily_reset_at: nowIso,
        updated_at: nowIso,
      },
      { count: 'exact' },
    )
    .gt('daily_send_count', 0)
  return count || 0
}

/**
 * Hourly counter reset
 */
export async function resetHourlyCounters(): Promise<number> {
  const db = getServiceClient()
  const nowIso = new Date().toISOString()
  const { count } = await db
    .from('bot_accounts')
    .update(
      {
        hourly_send_count: 0,
        hourly_reset_at: nowIso,
        updated_at: nowIso,
      },
      { count: 'exact' },
    )
    .gt('hourly_send_count', 0)
  return count || 0
}
