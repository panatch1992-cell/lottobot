/**
 * hybrid/pending-replies.ts
 *
 * CRUD layer สำหรับตาราง pending_replies
 *
 * Lifecycle:
 *   pending        → dispatcher สร้างไว้ รอ self-bot ส่ง trigger
 *   trigger_sent   → self-bot ส่ง trigger แล้ว รอ webhook
 *   replied        → webhook เรียก Reply API สำเร็จ
 *   expired        → หมดเวลา ไม่มี webhook มา
 *   failed         → trigger ส่งไม่สำเร็จ หรือ reply fail permanent
 *
 * Atomic claim:
 *   Webhook อาจรับหลาย event ซ้อน → ใช้ conditional update
 *   .eq('status', 'trigger_sent') เป็น guard เพื่อ race-safe
 */

import { getServiceClient, getSettings } from '@/lib/supabase'
import type {
  PendingReply,
  PendingReplyIntent,
  PendingReplyPayload,
  PendingReplyStatus,
} from '@/types'

const DEFAULT_EXPIRY_MIN = 5
const DEFAULT_MAX_RETRIES = 2

async function getExpiryMinutes(): Promise<number> {
  const settings = await getSettings()
  const n = parseInt(settings.pending_reply_expiry_min || '', 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_EXPIRY_MIN
}

async function getMaxRetries(): Promise<number> {
  const settings = await getSettings()
  const n = parseInt(settings.pending_reply_max_retries || '', 10)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MAX_RETRIES
}

export interface CreatePendingReplyInput {
  lineGroupId: string
  lotteryId: string | null
  intent: PendingReplyIntent
  payload: PendingReplyPayload
  triggerText: string
  triggerPhraseUsed?: string | null
}

/**
 * สร้าง pending_reply row ใหม่ (status=pending)
 * expires_at คำนวณจาก now() + pending_reply_expiry_min
 */
export async function createPendingReply(
  input: CreatePendingReplyInput,
): Promise<PendingReply | null> {
  const db = getServiceClient()
  const expiryMin = await getExpiryMinutes()
  const maxRetries = await getMaxRetries()

  const expiresAt = new Date(Date.now() + expiryMin * 60_000).toISOString()

  const { data, error } = await db
    .from('pending_replies')
    .insert({
      line_group_id: input.lineGroupId,
      lottery_id: input.lotteryId,
      intent_type: input.intent,
      payload: input.payload,
      trigger_text: input.triggerText,
      trigger_phrase_used: input.triggerPhraseUsed || null,
      status: 'pending',
      retry_count: 0,
      max_retries: maxRetries,
      expires_at: expiresAt,
    })
    .select('*')
    .single()

  if (error) {
    console.error('[pending-replies] create failed:', error.message)
    return null
  }
  return data as PendingReply
}

/**
 * เปลี่ยน status เป็น 'trigger_sent' + stamp trigger_sent_at
 * เรียกหลัง self-bot ส่ง trigger สำเร็จ
 */
export async function markTriggerSent(id: string): Promise<boolean> {
  const db = getServiceClient()
  const { error } = await db
    .from('pending_replies')
    .update({
      status: 'trigger_sent',
      trigger_sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'pending')
  if (error) {
    console.error('[pending-replies] markTriggerSent failed:', error.message)
    return false
  }
  return true
}

/**
 * Trigger ส่งล้มเหลว → เพิ่ม retry_count, เก็บ error
 * ถ้า retry_count >= max_retries → mark failed
 */
export async function markTriggerFailed(
  id: string,
  error: string,
): Promise<boolean> {
  const db = getServiceClient()
  // Read current retry_count + max_retries
  const { data: row } = await db
    .from('pending_replies')
    .select('retry_count, max_retries')
    .eq('id', id)
    .maybeSingle()
  if (!row) return false

  const nextRetry = (row.retry_count || 0) + 1
  const shouldFail = nextRetry >= (row.max_retries || DEFAULT_MAX_RETRIES)

  const { error: updErr } = await db
    .from('pending_replies')
    .update({
      retry_count: nextRetry,
      last_error: error.slice(0, 500),
      status: shouldFail ? 'failed' : 'pending',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (updErr) {
    console.error('[pending-replies] markTriggerFailed failed:', updErr.message)
    return false
  }
  return true
}

/**
 * หา pending replies ที่พร้อม flush สำหรับกลุ่มนี้
 *
 * Logic:
 *   - กรอง status ∈ {trigger_sent, pending} (opportunistic เอา pending ด้วย)
 *   - กรอง expires_at > now()
 *   - เรียง created_at ascending (FIFO)
 *   - limit สูงสุด 5 rows (LINE Reply API รองรับ 5 messages ต่อ reply)
 *
 * ถ้า onlyTriggerSent=true → เอาเฉพาะ trigger_sent (flow ปกติ ที่ trigger ส่งแล้วแน่ ๆ)
 */
export async function findFlushable(
  lineGroupIdDb: string,
  options: { onlyTriggerSent?: boolean; limit?: number } = {},
): Promise<PendingReply[]> {
  const db = getServiceClient()
  const limit = options.limit ?? 5
  const statuses = options.onlyTriggerSent
    ? ['trigger_sent']
    : ['trigger_sent', 'pending']

  const { data, error } = await db
    .from('pending_replies')
    .select('*')
    .eq('line_group_id', lineGroupIdDb)
    .in('status', statuses)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('[pending-replies] findFlushable failed:', error.message)
    return []
  }
  return (data || []) as PendingReply[]
}

/**
 * Atomic claim → เปลี่ยน status เป็น 'replied' ก็ต่อเมื่อยังไม่มีใครชิง
 *
 * Returns ids ที่ claim สำเร็จ (subset ของ input)
 * ids ที่ race lose → ไม่คืน (caller ต้องเช็คเอง)
 */
export async function claimForReply(params: {
  ids: string[]
  replyToken: string
  webhookEventId?: string | null
}): Promise<string[]> {
  if (params.ids.length === 0) return []
  const db = getServiceClient()
  const nowIso = new Date().toISOString()

  // เราใช้ update ... in('id', ids) ... in('status', ['pending','trigger_sent'])
  // เป็น atomic guard — row ที่ status เปลี่ยนไปแล้วจะไม่ match
  const { data, error } = await db
    .from('pending_replies')
    .update({
      status: 'replied',
      replied_at: nowIso,
      reply_token_used: params.replyToken,
      webhook_event_id: params.webhookEventId || null,
      updated_at: nowIso,
    })
    .in('id', params.ids)
    .in('status', ['pending', 'trigger_sent'])
    .select('id')

  if (error) {
    console.error('[pending-replies] claimForReply failed:', error.message)
    return []
  }
  return (data || []).map(r => r.id as string)
}

/**
 * Reply API call ล้มเหลว → revert claim (status=pending) + บันทึก error
 * ไม่ delete row — คงไว้ให้ retry ได้
 */
export async function revertClaim(params: {
  ids: string[]
  error: string
}): Promise<void> {
  if (params.ids.length === 0) return
  const db = getServiceClient()
  const { error } = await db
    .from('pending_replies')
    .update({
      status: 'pending',
      last_error: params.error.slice(0, 500),
      reply_token_used: null,
      replied_at: null,
      updated_at: new Date().toISOString(),
    })
    .in('id', params.ids)
    .eq('status', 'replied') // guard — revert only rows we just claimed

  if (error) {
    console.error('[pending-replies] revertClaim failed:', error.message)
  }
}

/**
 * Mark เป็น expired ถ้าเลย expires_at แล้ว (ไม่มี webhook มา)
 * เรียกจาก cron สะสาง — idempotent
 */
export async function expireStale(): Promise<number> {
  const db = getServiceClient()
  const { count, error } = await db
    .from('pending_replies')
    .update(
      { status: 'expired', updated_at: new Date().toISOString() },
      { count: 'exact' },
    )
    .in('status', ['pending', 'trigger_sent'])
    .lt('expires_at', new Date().toISOString())
  if (error) {
    console.error('[pending-replies] expireStale failed:', error.message)
    return 0
  }
  return count || 0
}

/**
 * เช็คว่ามี pending_reply (intent, lottery, group) อยู่แล้วหรือยัง (dedup ใน dispatcher)
 * เพื่อกัน dispatcher สร้างรายการซ้ำในรอบ cron เดียวกัน
 */
export async function hasActiveForIntent(params: {
  lineGroupId: string
  lotteryId: string | null
  intent: PendingReplyIntent
}): Promise<boolean> {
  const db = getServiceClient()
  let q = db
    .from('pending_replies')
    .select('id')
    .eq('line_group_id', params.lineGroupId)
    .eq('intent_type', params.intent)
    .in('status', ['pending', 'trigger_sent', 'replied'])
    .gt('expires_at', new Date(Date.now() - 24 * 60 * 60_000).toISOString()) // เอาย้อนหลัง 24 ชม.

  if (params.lotteryId) {
    q = q.eq('lottery_id', params.lotteryId)
  } else {
    q = q.is('lottery_id', null)
  }

  const { data } = await q.limit(1)
  return (data?.length || 0) > 0
}

/**
 * ดึง row เดี่ยว (สำหรับ debugging / dashboard)
 */
export async function getById(id: string): Promise<PendingReply | null> {
  const db = getServiceClient()
  const { data } = await db
    .from('pending_replies')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  return (data || null) as PendingReply | null
}

export type { PendingReplyStatus }
