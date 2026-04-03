// LINE Messaging API helper
// Docs: https://developers.line.biz/en/reference/messaging-api/

import { getServiceClient } from '@/lib/supabase'

const LINE_API = 'https://api.line.me/v2/bot'

// ═══════════════════════════════════════════
// LINE Quota Management (Free plan = 500/เดือน)
// ═══════════════════════════════════════════

/**
 * ตรวจสอบว่า LINE ยังส่งได้ไหม
 * เช็คจาก LINE API จริง (quota + consumption)
 * ถ้า API เช็คไม่ได้ → fallback นับจาก DB
 */
export async function checkLineQuota(): Promise<{
  canSend: boolean
  used: number
  quota: number
  remaining: number
  source: 'line_api' | 'db' | 'flag'
  reason?: string
}> {
  try {
    const db = getServiceClient()

    // อ่าน settings
    const { data: settingsData } = await db.from('bot_settings').select('key, value')
    const settings: Record<string, string> = {}
    for (const s of settingsData || []) settings[s.key] = s.value

    const currentMonth = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).substring(0, 7)

    // ถ้าเคย flag ว่าเดือนนี้ครบ limit แล้ว → skip ทันที (ไม่ต้องเรียก API)
    if (settings.line_monthly_limit_month === currentMonth) {
      const q = parseInt(settings.line_monthly_quota || '500', 10)
      return { canSend: false, used: q, quota: q, remaining: 0, source: 'flag', reason: `ครบ limit เดือน ${currentMonth} แล้ว` }
    }

    // เช็คจาก LINE API จริง
    const token = settings.line_channel_access_token
    if (token) {
      const apiQuota = await getLineQuotaFromAPI(token)
      if (!apiQuota.error && apiQuota.remaining !== null) {
        if (apiQuota.remaining <= 0) {
          // Flag ไว้ไม่ต้องเรียก API ซ้ำ
          await db.from('bot_settings').upsert({ key: 'line_monthly_limit_month', value: currentMonth })
          return {
            canSend: false,
            used: apiQuota.used,
            quota: apiQuota.quota || 500,
            remaining: 0,
            source: 'line_api',
            reason: `LINE API: ใช้ ${apiQuota.used}/${apiQuota.quota} แล้ว`,
          }
        }
        return {
          canSend: true,
          used: apiQuota.used,
          quota: apiQuota.quota || 500,
          remaining: apiQuota.remaining,
          source: 'line_api',
        }
      }
    }

    // Fallback: นับจาก DB
    const dbQuota = parseInt(settings.line_monthly_quota || '500', 10)
    const monthStart = `${currentMonth}-01`
    const { count } = await db.from('send_logs')
      .select('*', { count: 'exact', head: true })
      .eq('channel', 'line')
      .eq('status', 'sent')
      .gte('created_at', monthStart)

    const used = count || 0
    const remaining = Math.max(0, dbQuota - used)

    if (remaining <= 0) {
      await db.from('bot_settings').upsert({ key: 'line_monthly_limit_month', value: currentMonth })
      return { canSend: false, used, quota: dbQuota, remaining: 0, source: 'db', reason: `DB: ใช้ ${used}/${dbQuota} แล้ว` }
    }

    return { canSend: true, used, quota: dbQuota, remaining, source: 'db' }
  } catch {
    return { canSend: true, used: 0, quota: 500, remaining: 500, source: 'db' }
  }
}

/**
 * Flag ว่าเดือนนี้ครบ monthly limit (เมื่อ LINE API return error)
 */
export async function flagMonthlyLimitHit(): Promise<void> {
  try {
    const db = getServiceClient()
    const currentMonth = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).substring(0, 7)
    await db.from('bot_settings').upsert({ key: 'line_monthly_limit_month', value: currentMonth })
  } catch {
    // silent
  }
}

export async function pushTextMessage(
  channelAccessToken: string,
  to: string,
  text: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${LINE_API}/message/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${channelAccessToken}`,
      },
      body: JSON.stringify({
        to,
        messages: [{ type: 'text', text }],
      }),
    })

    if (res.ok) {
      return { success: true }
    }

    const data = await res.json().catch(() => ({}))
    return {
      success: false,
      error: data.message || `HTTP ${res.status}`,
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// Send text + image together (image first, then text caption)
export async function pushImageAndText(
  channelAccessToken: string,
  to: string,
  imageUrl: string,
  text: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${LINE_API}/message/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${channelAccessToken}`,
      },
      body: JSON.stringify({
        to,
        messages: [
          {
            type: 'image',
            originalContentUrl: imageUrl,
            previewImageUrl: imageUrl,
          },
          { type: 'text', text },
        ],
      }),
    })

    if (res.ok) {
      return { success: true }
    }

    const data = await res.json().catch(() => ({}))
    return {
      success: false,
      error: data.message || `HTTP ${res.status}`,
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function getGroupSummary(
  channelAccessToken: string,
  groupId: string
): Promise<{ name?: string; memberCount?: number; error?: string }> {
  try {
    const res = await fetch(`${LINE_API}/group/${groupId}/summary`, {
      headers: { Authorization: `Bearer ${channelAccessToken}` },
    })
    if (!res.ok) {
      return { error: `HTTP ${res.status}` }
    }
    const data = await res.json()
    return { name: data.groupName, memberCount: data.memberCount }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * เช็ค quota จริงจาก LINE API (ไม่ใช่แค่นับใน DB)
 */
export async function getLineQuotaFromAPI(channelAccessToken: string): Promise<{
  quota: number | null   // null = unlimited
  used: number
  remaining: number | null
  error?: string
}> {
  try {
    const [quotaRes, usageRes] = await Promise.all([
      fetch('https://api.line.me/v2/bot/message/quota', {
        headers: { Authorization: `Bearer ${channelAccessToken}` },
      }),
      fetch('https://api.line.me/v2/bot/message/quota/consumption', {
        headers: { Authorization: `Bearer ${channelAccessToken}` },
      }),
    ])

    const quotaData = await quotaRes.json().catch(() => ({}))
    const usageData = await usageRes.json().catch(() => ({}))

    // quotaData.type: "limited" or "none" (unlimited)
    // quotaData.value: number (only if type="limited")
    // usageData.totalUsage: number
    const totalQuota = quotaData.type === 'limited' ? quotaData.value : null
    const totalUsage = usageData.totalUsage || 0
    const remaining = totalQuota !== null ? Math.max(0, totalQuota - totalUsage) : null

    return { quota: totalQuota, used: totalUsage, remaining }
  } catch (err) {
    return { quota: null, used: 0, remaining: null, error: err instanceof Error ? err.message : 'Unknown' }
  }
}

export async function verifyChannelToken(
  channelAccessToken: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch('https://api.line.me/v2/oauth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: channelAccessToken }),
    })
    const data = await res.json()
    if (res.ok && data.client_id) {
      return { valid: true }
    }
    return { valid: false, error: data.error_description || `HTTP ${res.status}` }
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
