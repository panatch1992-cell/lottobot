// LINE Messaging API helper
// Docs: https://developers.line.biz/en/reference/messaging-api/

import { getServiceClient } from '@/lib/supabase'

const LINE_API = 'https://api.line.me/v2/bot'

// ═══════════════════════════════════════════
// LINE Quota Management (Free plan = 500/เดือน)
// ═══════════════════════════════════════════

/**
 * ตรวจสอบว่า LINE ยังส่งได้ไหม (ไม่เกิน monthly quota)
 * เช็คจาก:
 * 1. bot_settings.line_monthly_limit_month — ถ้าตรงกับเดือนนี้ = ครบ limit แล้ว
 * 2. นับ send_logs ที่ sent สำเร็จเดือนนี้ vs line_monthly_quota
 */
export async function checkLineQuota(): Promise<{
  canSend: boolean
  used: number
  quota: number
  reason?: string
}> {
  try {
    const db = getServiceClient()

    // อ่าน settings
    const { data: settingsData } = await db.from('bot_settings').select('key, value')
    const settings: Record<string, string> = {}
    for (const s of settingsData || []) settings[s.key] = s.value

    const quota = parseInt(settings.line_monthly_quota || '500', 10)
    const currentMonth = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).substring(0, 7) // "2026-04"

    // ถ้าเคย flag ว่าเดือนนี้ครบ limit แล้ว → skip ทันที
    if (settings.line_monthly_limit_month === currentMonth) {
      return { canSend: false, used: quota, quota, reason: `ครบ limit เดือน ${currentMonth} แล้ว (flag)` }
    }

    // นับข้อความ LINE ที่ส่งสำเร็จเดือนนี้
    const monthStart = `${currentMonth}-01`
    const { count } = await db.from('send_logs')
      .select('*', { count: 'exact', head: true })
      .eq('channel', 'line')
      .eq('status', 'sent')
      .gte('created_at', monthStart)

    const used = count || 0

    if (used >= quota) {
      // Flag ไว้ไม่ต้องนับใหม่ทุกครั้ง
      await db.from('bot_settings').upsert({ key: 'line_monthly_limit_month', value: currentMonth })
      return { canSend: false, used, quota, reason: `ใช้ ${used}/${quota} ข้อความแล้ว` }
    }

    return { canSend: true, used, quota }
  } catch {
    // ถ้าเช็คไม่ได้ ให้ส่งได้ (fail open)
    return { canSend: true, used: 0, quota: 500 }
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
