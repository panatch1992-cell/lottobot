/**
 * POST /api/events/ingest — LOTTERY_RESULT_READY webhook entrypoint
 *
 * This is the endpoint that Pipedream/Make (or internal callers) hits with
 * a normalized trigger payload. All sources converge here so dedupe,
 * preflight, breaker, and 3-layer logging all run in one place.
 *
 * Auth: Bearer token (EVENT_INGEST_SECRET env), or CRON_SECRET as fallback.
 *
 * Body:
 *   {
 *     trigger_id?: string,         // optional, server will mint one if missing
 *     source: 'scrape'|'telegram'|'manual'|'webhook',
 *     lottery_id: uuid,
 *     draw_date: 'YYYY-MM-DD',
 *     round?: string|null,
 *     result_text?: string,        // optional, built from numbers if missing
 *     numbers: { top_number?, bottom_number?, full_number? },
 *     metadata?: object,
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { ingestEvent } from '@/lib/events/orchestrator'
import type { RawTriggerInput } from '@/lib/events/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function unauthorized(msg = 'Unauthorized') {
  return NextResponse.json({ ok: false, error: msg }, { status: 401 })
}

function checkAuth(req: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'production') return true

  const token = req.headers.get('authorization')?.replace('Bearer ', '') || ''
  const ingestSecret = process.env.EVENT_INGEST_SECRET || ''
  const cronSecret = process.env.CRON_SECRET || ''

  if (ingestSecret && token === ingestSecret) return true
  if (cronSecret && token === cronSecret) return true
  return false
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized()

  let body: RawTriggerInput
  try {
    body = (await req.json()) as RawTriggerInput
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const result = await ingestEvent(body)

  const httpStatus =
    result.ok ? 200 :
    result.reason === 'validation_failed' ? 400 :
    result.reason?.startsWith('preflight_failed') ? 503 :
    result.reason === 'pipeline disabled' ? 503 :
    500

  return NextResponse.json(result, { status: httpStatus })
}

export async function GET() {
  return NextResponse.json({
    endpoint: '/api/events/ingest',
    method: 'POST',
    event_type: 'LOTTERY_RESULT_READY',
    required_fields: ['source', 'lottery_id', 'draw_date', 'numbers'],
    optional_fields: ['trigger_id', 'round', 'result_text', 'metadata'],
  })
}
