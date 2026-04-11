/**
 * POST /api/events/manual — Manual trigger fallback (admin-only)
 *
 * Spec §15: "คง Manual Trigger เป็น Fallback — เก็บ . ไว้ใช้ฉุกเฉิน
 *            แต่ให้ auto-trigger เป็นเส้นหลัก"
 *
 * This is intentionally an admin-only route that builds a trigger_id from
 * `manual-<user>-<timestamp>` so you can always push one through the pipeline
 * even while automated sources are stuck.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { ingestEvent } from '@/lib/events/orchestrator'
import { RawTriggerInput } from '@/lib/events/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function unauthorized(msg = 'Unauthorized') {
  return NextResponse.json({ ok: false, error: msg }, { status: 401 })
}

function checkAuth(req: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'production') return true

  const token = req.headers.get('authorization')?.replace('Bearer ', '') || ''
  const adminSecret = process.env.ADMIN_SECRET || ''
  const cronSecret = process.env.CRON_SECRET || ''
  if (adminSecret && token === adminSecret) return true
  if (cronSecret && token === cronSecret) return true
  return false
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized()

  let body: RawTriggerInput & { actor?: string }
  try {
    body = (await req.json()) as RawTriggerInput & { actor?: string }
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.lottery_id) {
    return NextResponse.json({ ok: false, error: 'lottery_id required' }, { status: 400 })
  }

  // If caller passed only lottery_id + draw_date, pull the latest result row
  // from `results` so the admin can say "re-fire what's already in DB".
  const db = getServiceClient()
  if (!body.numbers || (!body.numbers.top_number && !body.numbers.bottom_number && !body.numbers.full_number)) {
    const drawDate = body.draw_date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
    const { data: row } = await db
      .from('results')
      .select('top_number, bottom_number, full_number, draw_date')
      .eq('lottery_id', body.lottery_id)
      .eq('draw_date', drawDate)
      .maybeSingle()

    if (row) {
      body = {
        ...body,
        draw_date: row.draw_date,
        numbers: {
          top_number: row.top_number,
          bottom_number: row.bottom_number,
          full_number: row.full_number,
        },
      }
    }
  }

  const actor = body.actor || 'admin'
  const trigger_id = body.trigger_id || `manual-${actor}-${Date.now()}`

  const result = await ingestEvent({
    ...body,
    source: 'manual',
    trigger_id,
    metadata: { ...(body.metadata || {}), actor, fallback: true },
  })

  const httpStatus =
    result.ok ? 200 :
    result.reason === 'validation_failed' ? 400 :
    result.reason?.startsWith('preflight_failed') ? 503 :
    500

  return NextResponse.json(result, { status: httpStatus })
}
