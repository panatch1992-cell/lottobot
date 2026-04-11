/**
 * GET /api/events/health — Mode-aware health for the event pipeline
 *
 * Returns:
 *   - triggerOk:    config sane enough to accept triggers?
 *   - senderReady:  preflight passes (unofficial endpoint + breaker)?
 *   - deliveryOk:   recent delivery_logs show success?
 *   - breaker:      current circuit state
 *
 * Important: the `deliveryOk` field is scoped to the event pipeline only —
 * it does NOT look at the legacy send_logs table. That keeps the dashboard
 * from flashing red because of an unrelated `official_line` config failure.
 */

import { NextResponse } from 'next/server'
import { getServiceClient, getSettings } from '@/lib/supabase'
import { runPreflight } from '@/lib/events/preflight'
import { getBreakerState } from '@/lib/events/breaker'

export const dynamic = 'force-dynamic'

export async function GET() {
  const db = getServiceClient()
  const settings = await getSettings()

  const pipelineEnabled = String(settings.event_pipeline_enabled || 'true').toLowerCase() === 'true'

  const preflight = await runPreflight()
  const breaker = await getBreakerState()

  // Recent delivery window (last 15 minutes)
  const since = new Date(Date.now() - 15 * 60_000).toISOString()
  const { data: recentDeliveries } = await db
    .from('delivery_logs')
    .select('status')
    .gte('sent_at', since)

  const recent = recentDeliveries || []
  const sent = recent.filter(r => r.status === 'sent').length
  const failed = recent.filter(r => r.status === 'failed').length
  const deliveryOk = recent.length === 0 ? null : sent > failed

  // Queue state
  const { data: queued } = await db
    .from('dispatch_jobs')
    .select('id')
    .in('status', ['queued', 'preflight', 'dispatching'])
  const pendingJobs = queued?.length || 0

  const triggerOk = pipelineEnabled && preflight.clientReady !== false

  return NextResponse.json({
    triggerOk,
    senderReady: preflight.ready,
    deliveryOk,
    pipelineEnabled,
    breaker: {
      state: breaker.state,
      consecutive_failures: breaker.consecutive_failures,
      opened_at: breaker.opened_at,
      last_error: breaker.last_error,
    },
    preflight,
    window: '15m',
    recent: {
      total: recent.length,
      sent,
      failed,
    },
    pendingJobs,
    timestamp: new Date().toISOString(),
  })
}
