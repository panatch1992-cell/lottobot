/**
 * GET /api/events/status — Dashboard data source
 *
 * Returns a snapshot of the event pipeline's 3-layer log state for the
 * dashboard "mode-aware" tiles (Trigger OK / Sender Ready / Delivery OK).
 *
 * Query params:
 *   ?window=15m|1h|24h   (default 1h)
 *   ?limit=50            (default 20) for recent events
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function windowToMs(w: string): number {
  switch (w) {
    case '15m': return 15 * 60_000
    case '1h': return 60 * 60_000
    case '6h': return 6 * 60 * 60_000
    case '24h': return 24 * 60 * 60_000
    default: return 60 * 60_000
  }
}

export async function GET(req: NextRequest) {
  const db = getServiceClient()
  const windowStr = req.nextUrl.searchParams.get('window') || '1h'
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '20', 10)
  const since = new Date(Date.now() - windowToMs(windowStr)).toISOString()

  const [triggersRes, jobsRes, deliveriesRes, breakerRes, dlqRes] = await Promise.all([
    db.from('trigger_events')
      .select('id, trigger_id, source, lottery_id, draw_date, status, received_at')
      .gte('received_at', since)
      .order('received_at', { ascending: false })
      .limit(limit),
    db.from('dispatch_jobs')
      .select('id, trigger_id, lottery_id, status, attempt_no, total_targets, succeeded_targets, failed_targets, canary, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(limit),
    db.from('delivery_logs')
      .select('id, dispatch_job_id, target_name, status, error_message, sent_at')
      .gte('sent_at', since)
      .order('sent_at', { ascending: false })
      .limit(limit),
    db.from('circuit_breaker_state')
      .select('*')
      .eq('breaker_name', 'lottery_dispatch')
      .maybeSingle(),
    db.from('dispatch_jobs')
      .select('id, trigger_id, lottery_id, last_error, completed_at')
      .eq('status', 'dead_letter')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(limit),
  ])

  const triggers = triggersRes.data || []
  const jobs = jobsRes.data || []
  const deliveries = deliveriesRes.data || []

  // Counts for mode-aware tiles
  const triggerCounts = triggers.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const jobCounts = jobs.reduce((acc, j) => {
    acc[j.status] = (acc[j.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const deliveryCounts = deliveries.reduce((acc, d) => {
    acc[d.status] = (acc[d.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return NextResponse.json({
    window: windowStr,
    since,
    triggerCounts,
    jobCounts,
    deliveryCounts,
    breaker: breakerRes.data || null,
    recent: {
      triggers,
      jobs,
      deliveries,
    },
    deadLetters: dlqRes.data || [],
    timestamp: new Date().toISOString(),
  })
}
