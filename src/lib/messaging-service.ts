/**
 * messaging-service.ts — Unofficial LINE endpoint only
 *
 * ส่งข้อความทั้งหมดผ่าน Unofficial endpoint (Render)
 * ไม่มี provider toggle, ไม่มี fallback — เรียบง่าย
 */

import { getSettings } from '@/lib/supabase'

export type SendResult = {
  success: boolean
  error?: string
  unofficialError?: string
  fallbackSkipped?: boolean
  circuitBreaker?: boolean
  rateLimited?: boolean
}

export interface SendOptions {
  /**
   * When true, tells the self-bot endpoint NOT to fall back to the
   * Official LINE Messaging API if unofficial (user account) fails.
   *
   * Hybrid-mode trigger sends MUST set this: the whole point is to
   * have a user-account message in the group so LINE issues a
   * replyToken. Official push can't do that and wastes monthly quota.
   */
  noFallback?: boolean
}

export type HealthCheckResult = {
  ok: boolean
  hasAuthToken?: boolean
  hasLineToken?: boolean
  latencyMs: number
  error?: string
}

// ─── Config ─────────────────────────────────────────────

async function getUnofficialConfig() {
  const settings = await getSettings()
  const endpoint = (settings.unofficial_line_endpoint || process.env.UNOFFICIAL_LINE_ENDPOINT || '').replace(/\/+$/, '')
  const token = settings.unofficial_line_token || process.env.UNOFFICIAL_LINE_TOKEN || ''
  return { endpoint, token }
}

// ─── Core: call Render/VPS endpoint ─────────────────────

async function callUnofficial(
  mode: string,
  payload: Record<string, string | boolean>,
): Promise<SendResult> {
  const { endpoint, token } = await getUnofficialConfig()

  if (!endpoint) {
    return { success: false, error: 'Unofficial endpoint not configured' }
  }

  const sendUrl = endpoint.endsWith('/send') ? endpoint : `${endpoint}/send`

  try {
    const res = await fetch(sendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ mode, ...payload }),
    })

    const data = await res.json().catch(() => null)

    if (!res.ok) {
      // Parse the richer error envelope the server now returns
      const errorParts: string[] = [`HTTP ${res.status}`]
      if (data && typeof data === 'object') {
        if (data.error) errorParts.push(String(data.error).slice(0, 200))
      } else {
        const body = await res.text().catch(() => '')
        if (body) errorParts.push(body.slice(0, 180))
      }
      return {
        success: false,
        error: errorParts.join(': '),
        unofficialError: data?.unofficial_error || undefined,
        fallbackSkipped: data?.fallback_skipped || false,
        circuitBreaker: data?.circuitBreaker || false,
        rateLimited: data?.rateLimited || false,
      }
    }

    if (data && data.success === false) {
      return {
        success: false,
        error: data.error || 'endpoint returned failure',
        unofficialError: data.unofficial_error,
      }
    }

    return {
      success: true,
      unofficialError: data?.unofficial_error, // present when fallback succeeded after unofficial failed
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ─── Public API ─────────────────────────────────────────

export async function sendText(
  to: string,
  text: string,
  officialTo?: string,
  options: SendOptions = {},
): Promise<SendResult> {
  const payload: Record<string, string | boolean> = { to, text }
  if (officialTo) payload.officialTo = officialTo
  if (options.noFallback) payload.no_fallback = true
  return callUnofficial('push_text', payload)
}

export async function sendImageAndText(
  to: string,
  imageUrl: string,
  text: string,
  officialTo?: string,
  options: SendOptions = {},
): Promise<SendResult> {
  const payload: Record<string, string | boolean> = { to, imageUrl, text }
  if (officialTo) payload.officialTo = officialTo
  if (options.noFallback) payload.no_fallback = true
  return callUnofficial('push_image_text', payload)
}

export async function broadcastTextMessage(text: string): Promise<SendResult> {
  return callUnofficial('broadcast_text', { text })
}

export async function broadcastImageText(imageUrl: string, text: string): Promise<SendResult> {
  return callUnofficial('broadcast_image_text', { imageUrl, text })
}

// Backward-compatible wrappers (old code passes token as first arg — ignore it)
export async function pushTextMessage(_token: string, to: string, text: string, officialTo?: string) {
  return sendText(to, text, officialTo)
}

export async function pushImageAndText(_token: string, to: string, imageUrl: string, text: string, officialTo?: string) {
  return sendImageAndText(to, imageUrl, text, officialTo)
}

export async function broadcastText(_token: string, text: string) {
  return broadcastTextMessage(text)
}

export async function broadcastImageAndText(_token: string, imageUrl: string, text: string) {
  return broadcastImageText(imageUrl, text)
}

// ─── Health Check ───────────────────────────────────────

export async function checkUnofficialHealth(): Promise<HealthCheckResult> {
  const { endpoint } = await getUnofficialConfig()

  if (!endpoint) {
    return { ok: false, latencyMs: 0, error: 'Unofficial endpoint not configured' }
  }

  const start = Date.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)

    const res = await fetch(`${endpoint}/health`, { signal: controller.signal })
    clearTimeout(timer)

    const latencyMs = Date.now() - start

    if (!res.ok) return { ok: false, latencyMs, error: `HTTP ${res.status}` }

    const data = await res.json().catch(() => ({}))
    return {
      ok: !!data.ok,
      hasAuthToken: data.hasAuthToken,
      hasLineToken: data.hasLineToken,
      latencyMs,
    }
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error
        ? (err.name === 'AbortError' ? 'Timeout (8s)' : err.message)
        : 'Unknown error',
    }
  }
}

// ─── Quota (unofficial = unlimited from app perspective) ─

export async function checkLineQuota() {
  return {
    canSend: true,
    used: 0,
    quota: 0,
    remaining: 9999,
    dailyBudget: 9999,
    todaySent: 0,
    daysLeft: 1,
    source: 'unofficial' as const,
    reason: 'Unofficial endpoint — ไม่มี quota จำกัด',
  }
}

export async function flagMonthlyLimitHit() {
  // no-op for unofficial
}

// Keep exports for backward compatibility (system-check uses these)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function verifyChannelToken(_token?: string) {
  const health = await checkUnofficialHealth()
  return health.ok
}

export async function getLineQuotaFromAPI() {
  return checkLineQuota()
}
