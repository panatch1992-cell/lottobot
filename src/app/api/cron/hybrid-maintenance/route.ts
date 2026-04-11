/**
 * GET /api/cron/hybrid-maintenance
 *
 * Periodic maintenance for the Hybrid Reply system.
 *
 * Jobs:
 *   1. Expire stale pending_replies (expires_at < now + status in pending/trigger_sent)
 *   2. Trim old trigger_phrase_history rows (>30 days)
 *   3. Reset bot_accounts hourly counters (once per hour)
 *   4. Reset bot_accounts daily counters (once per day, Bangkok-midnight aware)
 *
 * Schedule in vercel.json or external cron → run every 15 minutes
 */

import { NextRequest, NextResponse } from 'next/server'
import { expireStale } from '@/lib/hybrid/pending-replies'
import { trimPhraseHistory } from '@/lib/hybrid/trigger-phrases'
import {
  resetHourlyCounters,
  resetDailyCounters,
} from '@/lib/hybrid/bot-account-rotation'
import { nowBangkok } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  const testMode = req.nextUrl.searchParams.get('test') === '1'
  if (!testMode && secret !== process.env.CRON_SECRET && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = nowBangkok()
  const minute = now.getMinutes()
  const hour = now.getHours()

  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    bangkok_time: `${hour}:${String(minute).padStart(2, '0')}`,
  }

  // 1. Expire stale pending_replies (every run)
  try {
    results.expired_pending = await expireStale()
  } catch (err) {
    results.expire_error = err instanceof Error ? err.message : String(err)
  }

  // 2. Hourly: reset bot_accounts hourly counter (ที่นาทีแรกของชั่วโมง)
  if (minute < 15) {
    try {
      results.reset_hourly = await resetHourlyCounters()
    } catch (err) {
      results.reset_hourly_error = err instanceof Error ? err.message : String(err)
    }
  }

  // 3. Daily: reset bot_accounts daily counter (ที่ 00:00-00:14 Bangkok)
  if (hour === 0 && minute < 15) {
    try {
      results.reset_daily = await resetDailyCounters()
    } catch (err) {
      results.reset_daily_error = err instanceof Error ? err.message : String(err)
    }
  }

  // 4. Daily: trim trigger_phrase_history (once per day at 03:xx)
  if (hour === 3 && minute < 15) {
    try {
      results.trimmed_phrases = await trimPhraseHistory()
    } catch (err) {
      results.trim_error = err instanceof Error ? err.message : String(err)
    }
  }

  return NextResponse.json(results)
}
