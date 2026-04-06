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

// ─── Core: call Render endpoint ─────────────────────────

async function callUnofficial(
  mode: string,
  payload: Record<string, string>,
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

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { success: false, error: `HTTP ${res.status}${body ? `: ${body.slice(0, 180)}` : ''}` }
    }

    const data = await res.json().catch(() => ({}))
    if (data?.success === false) {
      return { success: false, error: data.error || 'endpoint returned failure' }
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ─── Public API ─────────────────────────────────────────

export async function sendText(to: string, text: string): Promise<SendResult> {
  return callUnofficial('push_text', { to, text })
}

export async function sendImageAndText(to: string, imageUrl: string, text: string): Promise<SendResult> {
  return callUnofficial('push_image_text', { to, imageUrl, text })
}

export async function broadcastTextMessage(text: string): Promise<SendResult> {
  return callUnofficial('broadcast_text', { text })
}

export async function broadcastImageText(imageUrl: string, text: string): Promise<SendResult> {
  return callUnofficial('broadcast_image_text', { imageUrl, text })
}

// Backward-compatible wrappers (old code passes token as first arg — ignore it)
export async function pushTextMessage(_token: string, to: string, text: string) {
  return sendText(to, text)
}

export async function pushImageAndText(_token: string, to: string, imageUrl: string, text: string) {
  return sendImageAndText(to, imageUrl, text)
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
