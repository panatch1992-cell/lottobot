import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, getSettings } from '@/lib/supabase'
import { formatCountdown, formatStats, formatNextLottery, formatClosing } from '@/lib/formatter'
import { sendToTelegram } from '@/lib/telegram'
import { sendViaRotation } from '@/lib/hybrid/bot-account-rotation'
import { createPendingReply, markTriggerSent, markTriggerFailed } from '@/lib/hybrid/pending-replies'
import { pickLuckyImage } from '@/lib/hybrid/lucky-image-picker'
import { nowBangkok, today, timeToMinutes, sleep } from '@/lib/utils'
import { validateCronConfig, alertConfigIssues } from '@/lib/config-guard'
import type { Lottery, LineGroup, Result } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ─── Hybrid Flow ──────────────────────────────────────────
// Phase 1 (T-30): Announce → self-bot sends trigger text
//                  → webhook Reply: stats + lucky image
// Phase 2 (T-20): self-bot sends countdown text (direct)
// Phase 3 (T-10): self-bot sends countdown text (direct)
// Phase 4 (T-5):  self-bot sends countdown text (direct)
// Phase 5 (T=0):  self-bot sends closing text (direct)
// Phase 6 (T+result): handled by cron/scrape (already Hybrid)

const FLOW_STEPS = [
  { type: 'announce', minutesBefore: 30, needsReply: true, phraseCategory: 'announce' as const },
  { type: 'countdown', minutesBefore: 20, needsReply: false, phraseCategory: 'general' as const },
  { type: 'countdown', minutesBefore: 10, needsReply: false, phraseCategory: 'general' as const },
  { type: 'countdown', minutesBefore: 5, needsReply: false, phraseCategory: 'general' as const },
  { type: 'closing', minutesBefore: 0, needsReply: false, phraseCategory: 'general' as const },
]

// ─── Dedup check ───────────────────────────────────────────

async function alreadySent(
  db: ReturnType<typeof getServiceClient>,
  lotteryId: string,
  msgType: string,
  todayStr: string,
  tag: string,
  groupId?: string,
): Promise<boolean> {
  let query = db.from('send_logs')
    .select('id')
    .eq('lottery_id', lotteryId)
    .eq('msg_type', msgType)
    .eq('status', 'sent')
    .gte('created_at', todayStr)
    .like('error_message', `%${tag}%`)

  if (groupId) {
    query = query.eq('line_group_id', groupId)
  } else {
    query = query.eq('channel', 'telegram')
  }

  const { data } = await query
  return (data || []).length > 0
}

async function logSend(
  db: ReturnType<typeof getServiceClient>,
  lotteryId: string,
  channel: string,
  msgType: string,
  success: boolean,
  tag: string,
  error?: string,
  groupId?: string,
) {
  await db.from('send_logs').insert({
    lottery_id: lotteryId,
    line_group_id: groupId || null,
    channel,
    msg_type: msgType,
    status: success ? 'sent' : 'failed',
    sent_at: new Date().toISOString(),
    error_message: success ? tag : `${tag}: ${error}`,
  })
}

// ─── Load groups with explicit column select ───────────────

async function loadActiveGroups(db: ReturnType<typeof getServiceClient>): Promise<LineGroup[]> {
  const { data, error } = await db.from('line_groups')
    .select('id, name, line_group_id, unofficial_group_id, is_active, custom_link, custom_message, send_all_lotteries, line_notify_token, member_count, created_at, updated_at')
    .eq('is_active', true)

  if (error) {
    console.error('[countdown] loadActiveGroups error:', error.message)
  }
  return (data || []) as LineGroup[]
}

function getGroupPrimaryId(group: LineGroup): { primaryId: string; officialId: string } {
  const unofficialId = group.unofficial_group_id || ''
  const officialId = group.line_group_id || ''
  const primaryId = unofficialId || officialId.toLowerCase()
  return { primaryId, officialId }
}

// ─── Main handler ───────────────────────────────────────────

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  const testMode = req.nextUrl.searchParams.get('test') === '1'
  if (!testMode && secret !== process.env.CRON_SECRET && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getServiceClient()
  const now = nowBangkok()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const todayStr = today()

  // Config Guard
  const configCheck = await validateCronConfig('countdown')
  if (!configCheck.ok) {
    await alertConfigIssues('countdown', configCheck.issues)
    return NextResponse.json({ error: 'Config issues', issues: configCheck.issues })
  }

  const settings = await getSettings()

  if (settings.send_countdown !== 'true') {
    return NextResponse.json({ sent: 0, skipped: 'countdown disabled' })
  }

  const addFriendLink = settings.line_add_friend_link || ''

  const { data: lotteries } = await db.from('lotteries').select('*').eq('status', 'active')
  const activeGroups = await loadActiveGroups(db)

  const sent: string[] = []

  for (const lottery of (lotteries || []) as Lottery[]) {
    const closeTime = lottery.close_time || lottery.result_time
    if (!closeTime) continue
    const closeMinutes = timeToMinutes(closeTime)

    for (const step of FLOW_STEPS) {
      const triggerAt = closeMinutes - step.minutesBefore

      // ตรงเวลา? (ภายใน 1 นาที)
      if (nowMinutes < triggerAt || nowMinutes > triggerAt + 1) continue

      const tag = `${step.type}_${step.minutesBefore}min`
      const tgSent = await alreadySent(db, lottery.id, step.type, todayStr, tag)

      // ═══ Phase 1: ANNOUNCE (T-30) ═══
      // Trigger: self-bot sends next-lottery announcement
      // Reply: webhook replies with stats + lucky image (via pending_reply)
      if (step.type === 'announce') {
        const closeTimeStr = closeTime.slice(0, 5)
        const formatted = formatNextLottery(lottery, closeTimeStr)

        // Telegram admin log
        if (!tgSent && settings.telegram_bot_token && settings.telegram_admin_channel) {
          const r = await sendToTelegram(settings.telegram_bot_token, settings.telegram_admin_channel, formatted.tg)
          await logSend(db, lottery.id, 'telegram', step.type, r.success, tag, r.error)
        }

        // Pre-compute stats text for Reply payload
        const statsCount = Number(settings.stats_count) || 10
        const { data: results } = await db.from('results')
          .select('*')
          .eq('lottery_id', lottery.id)
          .order('draw_date', { ascending: false })
          .limit(statsCount)
        const statsFormatted = results && results.length > 0
          ? formatStats(lottery, results as Result[])
          : null

        // Pre-pick lucky image for Reply payload
        const luckyPick = await pickLuckyImage({
          category: 'general',
          lotteryName: lottery.name,
        })

        // Send to each LINE group via Hybrid
        for (const group of activeGroups) {
          const { primaryId, officialId } = getGroupPrimaryId(group)
          if (!primaryId) continue
          if (await alreadySent(db, lottery.id, step.type, todayStr, tag, group.id)) continue

          // Build reply payload (stats + lucky image)
          const replyText = statsFormatted
            ? `${formatted.line}\n\n${statsFormatted.line}`
            : formatted.line

          // Create pending_reply for webhook to flush
          const pending = await createPendingReply({
            lineGroupId: group.id,
            lotteryId: lottery.id,
            intent: 'announce',
            payload: {
              text: replyText,
              stats_text: statsFormatted?.line || undefined,
              lucky_image_url: luckyPick?.url || null,
              lottery_name: lottery.name,
            },
            triggerText: formatted.line,
            triggerPhraseUsed: formatted.line.slice(0, 50),
          })

          // Self-bot sends the announcement as trigger
          const { result: sendRes } = await sendViaRotation(
            primaryId,
            formatted.line,
            officialId,
            { noFallback: true },
          )

          if (sendRes.success && pending) {
            await markTriggerSent(pending.id)
          } else if (pending) {
            await markTriggerFailed(pending.id, sendRes.error || 'unknown')
          }

          await logSend(db, lottery.id, 'line', step.type, sendRes.success, tag, sendRes.error, group.id)
          await sleep(300 + Math.floor(Math.random() * 500))
        }
        sent.push(`${lottery.name} (📢 announce+stats+image)`)
      }

      // ═══ Phase 2-4: COUNTDOWN (T-20/10/5) ═══
      // Direct send: self-bot sends full countdown text
      if (step.type === 'countdown') {
        const formatted = formatCountdown(lottery, step.minutesBefore, addFriendLink)

        // Telegram admin log
        if (!tgSent && settings.telegram_bot_token && settings.telegram_admin_channel) {
          const r = await sendToTelegram(settings.telegram_bot_token, settings.telegram_admin_channel, formatted.tg)
          await logSend(db, lottery.id, 'telegram', step.type, r.success, tag, r.error)
        }

        // Send to each LINE group directly via self-bot
        for (const group of activeGroups) {
          const { primaryId, officialId } = getGroupPrimaryId(group)
          if (!primaryId) continue
          if (await alreadySent(db, lottery.id, step.type, todayStr, tag, group.id)) continue

          const { result: sendRes } = await sendViaRotation(
            primaryId,
            formatted.line,
            officialId,
            { noFallback: true },
          )

          await logSend(db, lottery.id, 'line', step.type, sendRes.success, tag, sendRes.error, group.id)
          await sleep(300 + Math.floor(Math.random() * 500))
        }
        sent.push(`${lottery.name} (⏰ ${step.minutesBefore}min)`)
      }

      // ═══ Phase 5: CLOSING (T=0) ═══
      // Direct send: self-bot sends closing text
      if (step.type === 'closing') {
        const formatted = formatClosing(lottery)

        // Telegram admin log
        if (!tgSent && settings.telegram_bot_token && settings.telegram_admin_channel) {
          const r = await sendToTelegram(settings.telegram_bot_token, settings.telegram_admin_channel, formatted.tg)
          await logSend(db, lottery.id, 'telegram', step.type, r.success, tag, r.error)
        }

        // Send to each LINE group directly
        for (const group of activeGroups) {
          const { primaryId, officialId } = getGroupPrimaryId(group)
          if (!primaryId) continue
          if (await alreadySent(db, lottery.id, step.type, todayStr, tag, group.id)) continue

          const { result: sendRes } = await sendViaRotation(
            primaryId,
            formatted.line,
            officialId,
            { noFallback: true },
          )

          await logSend(db, lottery.id, 'line', step.type, sendRes.success, tag, sendRes.error, group.id)
          await sleep(300 + Math.floor(Math.random() * 500))
        }
        sent.push(`${lottery.name} (🔒 closed)`)
      }

      // Step 8: 🎯 ผลหวย — handled by cron/scrape (Hybrid mode)
    }
  }

  return NextResponse.json({
    sent: sent.length,
    steps: sent,
    timestamp: new Date().toISOString(),
  })
}
