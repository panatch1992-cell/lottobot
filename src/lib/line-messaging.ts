// LINE Messaging API helper
// Docs: https://developers.line.biz/en/reference/messaging-api/

import { getServiceClient } from '@/lib/supabase'

const LINE_API = 'https://api.line.me/v2/bot'

// ═══════════════════════════════════════════
// LINE Quota Management (Free plan = 500/เดือน)
// ═══════════════════════════════════════════

/**
 * ตรวจสอบว่า LINE ยังส่งได้ไหม
 * ใช้ระบบ Daily Budget: กระจาย quota เท่าๆ กันทุกวันที่เหลือในเดือน
 * → ไม่มีทาง quota หมดกลางเดือนอีก
 *
 * สูตร: daily_budget = (quota_remaining × 0.9) ÷ days_remaining
 *        can_send = today_sent < daily_budget
 */
export async function checkLineQuota(): Promise<{
  canSend: boolean
  used: number
  quota: number
  remaining: number
  dailyBudget: number
  todaySent: number
  daysLeft: number
  source: 'line_api' | 'db' | 'flag'
  reason?: string
}> {
  try {
    const db = getServiceClient()

    // อ่าน settings
    const { data: settingsData } = await db.from('bot_settings').select('key, value')
    const settings: Record<string, string> = {}
    for (const s of settingsData || []) settings[s.key] = s.value

    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
    const currentMonth = now.toISOString().substring(0, 7) // "2026-04"
    const todayStr = now.toISOString().substring(0, 10) // "2026-04-03"
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const daysLeft = Math.max(1, daysInMonth - now.getDate() + 1) // รวมวันนี้ด้วย

    // ถ้าเคย flag ว่าเดือนนี้ครบ limit แล้ว → skip ทันที
    if (settings.line_monthly_limit_month === currentMonth) {
      const q = parseInt(settings.line_monthly_quota || '300', 10)
      return { canSend: false, used: q, quota: q, remaining: 0, dailyBudget: 0, todaySent: 0, daysLeft, source: 'flag', reason: `ครบ limit เดือนนี้แล้ว` }
    }

    // นับข้อความที่ส่งสำเร็จวันนี้ (สำหรับ daily budget)
    const { count: todayCount } = await db.from('send_logs')
      .select('*', { count: 'exact', head: true })
      .eq('channel', 'line')
      .eq('status', 'sent')
      .gte('created_at', todayStr)

    const todaySent = todayCount || 0

    // เช็ค quota จาก LINE API จริง
    let monthlyQuota = parseInt(settings.line_monthly_quota || '300', 10)
    let monthlyUsed = 0
    let remaining = monthlyQuota
    let source: 'line_api' | 'db' = 'db'

    const token = settings.line_channel_access_token
    if (token) {
      const apiQuota = await getLineQuotaFromAPI(token)
      if (!apiQuota.error && apiQuota.remaining !== null) {
        monthlyQuota = apiQuota.quota || monthlyQuota
        monthlyUsed = apiQuota.used
        remaining = apiQuota.remaining
        source = 'line_api'
      }
    }

    // Fallback: นับจาก DB
    if (source === 'db') {
      const monthStart = `${currentMonth}-01`
      const { count } = await db.from('send_logs')
        .select('*', { count: 'exact', head: true })
        .eq('channel', 'line')
        .eq('status', 'sent')
        .gte('created_at', monthStart)
      monthlyUsed = count || 0
      remaining = Math.max(0, monthlyQuota - monthlyUsed)
    }

    // Monthly limit reached
    if (remaining <= 0) {
      await db.from('bot_settings').upsert({ key: 'line_monthly_limit_month', value: currentMonth })
      return { canSend: false, used: monthlyUsed, quota: monthlyQuota, remaining: 0, dailyBudget: 0, todaySent, daysLeft, source, reason: `ใช้ ${monthlyUsed}/${monthlyQuota} แล้ว` }
    }

    // ═══ Daily Budget ═══
    // เก็บ 10% เป็น reserve → ใช้ได้ 90% กระจายเท่าๆ กัน
    const usableRemaining = Math.floor(remaining * 0.9)
    const dailyBudget = Math.max(1, Math.floor(usableRemaining / daysLeft))

    // วันนี้ส่งครบ budget แล้ว → หยุด (พรุ่งนี้ส่งได้ใหม่)
    if (todaySent >= dailyBudget) {
      return {
        canSend: false,
        used: monthlyUsed, quota: monthlyQuota, remaining, dailyBudget, todaySent, daysLeft, source,
        reason: `วันนี้ส่งครบ ${todaySent}/${dailyBudget} แล้ว (เหลือ ${remaining} เก็บไว้ ${daysLeft} วัน)`,
      }
    }

    return { canSend: true, used: monthlyUsed, quota: monthlyQuota, remaining, dailyBudget, todaySent, daysLeft, source }
  } catch {
    return { canSend: true, used: 0, quota: 300, remaining: 300, dailyBudget: 10, todaySent: 0, daysLeft: 30, source: 'db' }
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
