/**
 * GET /api/history?date=YYYY-MM-DD
 *
 * Unified history feed: merges legacy `send_logs` (countdown/stats/scheduled
 * cron jobs still write here) with the new `delivery_logs` (event pipeline
 * writes here). The two tables are normalized into a single shape so the
 * /history page can render them uniformly.
 *
 * Entry shape:
 *   {
 *     id, source: 'legacy' | 'pipeline',
 *     lottery_id, line_group_id,
 *     channel: 'telegram' | 'line',
 *     msg_type,            // 'result' | 'countdown' | 'stats' | 'trigger_send' | 'trigger_reply'
 *     status: 'sent' | 'failed' | 'sending' | 'pending' | 'skipped',
 *     sent_at, duration_ms, error_message, result_id?
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

type HistoryEntry = {
  id: string
  source: 'legacy' | 'pipeline'
  lottery_id: string | null
  line_group_id: string | null
  channel: 'telegram' | 'line'
  msg_type: string
  status: string
  sent_at: string | null
  duration_ms: number | null
  error_message: string | null
  result_id: string | null
  target_name: string | null
  provider: string | null
}

function channelFromTargetType(targetType: string): 'telegram' | 'line' {
  return targetType === 'telegram_chat' ? 'telegram' : 'line'
}

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date')
    || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  const startOfDay = `${date}T00:00:00Z`
  const endOfDay = `${date}T23:59:59Z`

  const db = getServiceClient()

  const [legacyRes, pipelineRes, lotteriesRes, groupsRes, resultsRes, jobsRes] = await Promise.all([
    db.from('send_logs')
      .select('id, lottery_id, result_id, line_group_id, channel, msg_type, status, sent_at, duration_ms, error_message, created_at')
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay)
      .order('created_at', { ascending: false }),
    db.from('delivery_logs')
      .select('id, dispatch_job_id, trigger_id, target_type, target_id, target_name, provider, attempt_no, status, latency_ms, error_message, sent_at')
      .gte('sent_at', startOfDay)
      .lte('sent_at', endOfDay)
      .order('sent_at', { ascending: false }),
    db.from('lotteries').select('*'),
    db.from('line_groups').select('*'),
    db.from('results').select('id, source_url').eq('draw_date', date),
    db.from('dispatch_jobs').select('id, lottery_id, trigger_id'),
  ])

  // Build lookup for dispatch_job → lottery_id so pipeline entries can be
  // attributed back to the lottery that triggered them.
  const jobToLottery = new Map<string, string>()
  for (const j of jobsRes.data || []) {
    if (j.id && j.lottery_id) jobToLottery.set(j.id, j.lottery_id)
  }

  // Build groups lookup by target_id (unofficial_group_id or line_group_id)
  const groupsByTarget = new Map<string, { id: string; name: string }>()
  for (const g of (groupsRes.data || []) as Array<{ id: string; name: string; line_group_id: string | null; unofficial_group_id: string | null }>) {
    if (g.unofficial_group_id) groupsByTarget.set(g.unofficial_group_id, { id: g.id, name: g.name })
    if (g.line_group_id) groupsByTarget.set(g.line_group_id, { id: g.id, name: g.name })
    if (g.line_group_id) groupsByTarget.set(g.line_group_id.toLowerCase(), { id: g.id, name: g.name })
  }

  const legacyEntries: HistoryEntry[] = (legacyRes.data || []).map(l => ({
    id: `legacy-${l.id}`,
    source: 'legacy',
    lottery_id: l.lottery_id || null,
    line_group_id: l.line_group_id || null,
    channel: (l.channel as 'telegram' | 'line') || 'telegram',
    msg_type: l.msg_type || 'result',
    status: l.status || 'pending',
    sent_at: l.sent_at || l.created_at,
    duration_ms: l.duration_ms,
    error_message: l.error_message,
    result_id: l.result_id || null,
    target_name: null,
    provider: null,
  }))

  const pipelineEntries: HistoryEntry[] = (pipelineRes.data || []).map(d => {
    const lotteryId = jobToLottery.get(d.dispatch_job_id) || null
    const grp = groupsByTarget.get(d.target_id)
    return {
      id: `pipeline-${d.id}`,
      source: 'pipeline',
      lottery_id: lotteryId,
      line_group_id: grp?.id || null,
      channel: channelFromTargetType(d.target_type),
      msg_type: d.target_type === 'telegram_chat' ? 'result' : 'result',
      status: d.status,
      sent_at: d.sent_at,
      duration_ms: d.latency_ms,
      error_message: d.error_message,
      result_id: null,
      target_name: d.target_name || grp?.name || null,
      provider: d.provider,
    }
  })

  const merged = [...legacyEntries, ...pipelineEntries].sort((a, b) => {
    const ta = a.sent_at ? Date.parse(a.sent_at) : 0
    const tb = b.sent_at ? Date.parse(b.sent_at) : 0
    return tb - ta
  })

  return NextResponse.json({
    date,
    entries: merged,
    lotteries: lotteriesRes.data || [],
    groups: groupsRes.data || [],
    results: resultsRes.data || [],
    counts: {
      total: merged.length,
      legacy: legacyEntries.length,
      pipeline: pipelineEntries.length,
      sent: merged.filter(e => e.status === 'sent').length,
      failed: merged.filter(e => e.status === 'failed').length,
    },
  })
}
