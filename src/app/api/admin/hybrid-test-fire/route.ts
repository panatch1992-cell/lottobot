/**
 * POST /api/admin/hybrid-test-fire
 *
 * Fire a test Hybrid dispatch WITHOUT touching the orchestrator dedup,
 * canary filtering, or humanlike delay. Used for end-to-end smoke
 * tests so admins can verify self-bot → webhook → Reply API path
 * without waiting for an actual lottery draw.
 *
 * Body (all optional):
 *   {
 *     lottery_id?: string       — defaults to the lottery with the most
 *                                 recent result row for today; if none,
 *                                 picks any active lottery
 *     draw_date?: string        — defaults to today (Bangkok)
 *     group_names?: string[]    — defaults to ALL active groups
 *     skip_humanlike?: boolean  — defaults true (fire fast)
 *     fake_result?: {
 *       top_number?: string
 *       bottom_number?: string
 *       full_number?: string
 *     }                          — if no real result exists, synthesize one
 *   }
 *
 * Response:
 *   {
 *     ok, fired_at,
 *     lottery: { id, name, flag },
 *     result: { top, bottom, full },
 *     targets: [
 *       { group_id, group_name, trigger_phrase, pending_reply_id,
 *         trigger_sent, latency_ms, error? }
 *     ]
 *   }
 *
 * Guards:
 *   - Cookie OR CRON_SECRET/ADMIN_SECRET bearer
 *   - Only non-production by default (NODE_ENV guard can be disabled
 *     via ?allow_prod=1 — kept for initial rollout testing, remove later)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, getSettings } from '@/lib/supabase'
import { sendViaRotation } from '@/lib/hybrid/bot-account-rotation'
import {
  createPendingReply,
  markTriggerSent,
  markTriggerFailed,
} from '@/lib/hybrid/pending-replies'
import { pickTriggerPhrase, recordPhraseUsed } from '@/lib/hybrid/trigger-phrases'
import { pickLuckyImage } from '@/lib/hybrid/lucky-image-picker'
import { humanLikePreSend } from '@/lib/hybrid/humanlike'
import { formatResult } from '@/lib/formatter'
import type { Lottery, LineGroup, Result } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function hasAuthCookie(req: NextRequest): boolean {
  const allCookies = req.cookies.getAll()
  return allCookies.some(c =>
    (c.name.startsWith('sb-') && c.name.endsWith('-auth-token')) ||
    c.name === 'sb-access-token'
  )
}

function requireAuth(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '') || ''
  if (token && (token === process.env.CRON_SECRET || token === process.env.ADMIN_SECRET)) return null
  if (!hasAuthCookie(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

function todayBangkok(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
}

function buildResultCardUrl(lottery: Lottery, result: Result, opts: {
  theme: string
  fontStyle: string
  digitSize: string
  layout: string
}): string {
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://lottobot-chi.vercel.app')
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

interface TargetReport {
  group_id: string
  group_name: string
  target_id: string
  trigger_phrase: string
  pending_reply_id: string | null
  trigger_sent: boolean
  latency_ms: number
  error?: string
}

export async function POST(req: NextRequest) {
  const authErr = requireAuth(req)
  if (authErr) return authErr

  const body = await req.json().catch(() => ({}))
  const skipHumanlike = body.skip_humanlike !== false // default true
  const drawDate = typeof body.draw_date === 'string' && body.draw_date
    ? body.draw_date
    : todayBangkok()

  const db = getServiceClient()
  const settings = await getSettings()

  // ─── 1. Pick lottery ──
  let lottery: Lottery | null = null
  if (typeof body.lottery_id === 'string' && body.lottery_id) {
    const { data } = await db.from('lotteries').select('*').eq('id', body.lottery_id).maybeSingle()
    lottery = (data || null) as Lottery | null
  } else {
    // Default: pick the lottery with the most recent result
    const { data: recentResult } = await db
      .from('results')
      .select('lottery_id')
      .order('scraped_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (recentResult?.lottery_id) {
      const { data } = await db.from('lotteries').select('*').eq('id', recentResult.lottery_id).maybeSingle()
      lottery = (data || null) as Lottery | null
    }
    if (!lottery) {
      // Fall back to any active lottery
      const { data } = await db
        .from('lotteries')
        .select('*')
        .eq('status', 'active')
        .order('sort_order')
        .limit(1)
        .maybeSingle()
      lottery = (data || null) as Lottery | null
    }
  }

  if (!lottery) {
    return NextResponse.json({ error: 'no lottery found' }, { status: 404 })
  }

  // ─── 2. Resolve result row (fake or real) ──
  let result: Result | null = null
  const fake = body.fake_result as { top_number?: string; bottom_number?: string; full_number?: string } | undefined

  if (!fake) {
    const { data: real } = await db
      .from('results')
      .select('*')
      .eq('lottery_id', lottery.id)
      .eq('draw_date', drawDate)
      .maybeSingle()
    result = (real || null) as Result | null
  }

  if (!result) {
    // Synthesize a result row (in-memory only — do NOT insert)
    result = {
      id: 'test-synthetic',
      lottery_id: lottery.id,
      draw_date: drawDate,
      top_number: fake?.top_number || '999',
      bottom_number: fake?.bottom_number || '88',
      full_number: fake?.full_number || null,
      raw_data: { synthetic: true, test: true },
      source_url: 'test-fire',
      scraped_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }
  }

  // ─── 3. Pick target groups ──
  let groups: LineGroup[]
  if (Array.isArray(body.group_names) && body.group_names.length > 0) {
    const { data } = await db
      .from('line_groups')
      .select('*')
      .in('name', body.group_names as string[])
    groups = (data || []) as LineGroup[]
  } else {
    const { data } = await db.from('line_groups').select('*').eq('is_active', true)
    groups = (data || []) as LineGroup[]
  }

  if (groups.length === 0) {
    return NextResponse.json({ error: 'no target groups' }, { status: 404 })
  }

  // ─── 4. Build content ──
  const formatted = formatResult(lottery, result)
  const theme = settings.default_theme || 'shopee'
  const fontStyle = settings.default_font_style || 'rounded'
  const digitSize = settings.default_digit_size || 'm'
  const layout = settings.default_layout || 'horizontal'
  const resultImageUrl = buildResultCardUrl(lottery, result, { theme, fontStyle, digitSize, layout })

  // ─── 5. Fire to each group ──
  const targets: TargetReport[] = []

  for (const group of groups) {
    const g = group as LineGroup & { custom_link?: string; custom_message?: string }
    const unofficialId = g.unofficial_group_id || (g.line_group_id || '').toLowerCase()
    const officialId = g.line_group_id || ''
    const primaryId = unofficialId || officialId

    if (!primaryId) {
      targets.push({
        group_id: g.id,
        group_name: g.name,
        target_id: '',
        trigger_phrase: '',
        pending_reply_id: null,
        trigger_sent: false,
        latency_ms: 0,
        error: 'no unofficial_group_id or line_group_id',
      })
      continue
    }

    // Build personalized line_msg with optional custom fields
    let lineMsg = formatted.line
    if (g.custom_message) lineMsg += `\n${g.custom_message}`
    if (g.custom_link) lineMsg += `\n🔗 ${g.custom_link}`
    lineMsg += '\n\n🧪 [TEST FIRE — ไม่ใช่หวยจริง]'

    // Pick a fresh lucky image per group
    const luckyPick = await pickLuckyImage({
      category: 'general',
      lotteryName: lottery.name,
    })

    // Pick trigger phrase
    let phrase: string
    try {
      const picked = await pickTriggerPhrase({ lineGroupId: g.id, category: 'result' })
      phrase = picked.phrase
    } catch {
      phrase = `🧪 TEST ${lottery.flag} ${lottery.name}`
    }

    // Create pending_reply row
    const pending = await createPendingReply({
      lineGroupId: g.id,
      lotteryId: lottery.id,
      intent: 'result',
      payload: {
        text: lineMsg,
        image_url: resultImageUrl,
        lucky_image_url: luckyPick?.url || null,
        lottery_name: lottery.name,
        result_text: lineMsg,
      },
      triggerText: phrase,
      triggerPhraseUsed: phrase,
    })

    if (!pending) {
      targets.push({
        group_id: g.id,
        group_name: g.name,
        target_id: primaryId,
        trigger_phrase: phrase,
        pending_reply_id: null,
        trigger_sent: false,
        latency_ms: 0,
        error: 'pending_reply insert failed',
      })
      continue
    }

    // Optional humanlike pre-send (off by default for fast testing)
    if (!skipHumanlike) {
      await humanLikePreSend(phrase).catch(() => {})
    }

    // Send trigger via self-bot
    const t0 = Date.now()
    const { result: sendRes } = await sendViaRotation(primaryId, phrase, officialId)
    const latencyMs = Date.now() - t0

    if (sendRes.success) {
      await markTriggerSent(pending.id)
      await recordPhraseUsed({ lineGroupId: g.id, phrase, category: 'result' })
    } else {
      await markTriggerFailed(pending.id, sendRes.error || 'unknown')
    }

    targets.push({
      group_id: g.id,
      group_name: g.name,
      target_id: primaryId,
      trigger_phrase: phrase,
      pending_reply_id: pending.id,
      trigger_sent: sendRes.success,
      latency_ms: latencyMs,
      error: sendRes.error,
    })
  }

  return NextResponse.json({
    ok: targets.some(t => t.trigger_sent),
    fired_at: new Date().toISOString(),
    lottery: { id: lottery.id, name: lottery.name, flag: lottery.flag },
    result: {
      top: result.top_number,
      bottom: result.bottom_number,
      full: result.full_number,
      synthetic: result.id === 'test-synthetic',
    },
    skip_humanlike: skipHumanlike,
    targets,
  })
}
