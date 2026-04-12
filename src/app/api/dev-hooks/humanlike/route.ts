/**
 * GET /api/dev-hooks/humanlike?text=...
 *
 * Test-only route exposing calculateHumanLikeDelays for E2E assertions.
 * Disabled in production so the endpoint cannot be used to introspect
 * internals outside of CI.
 *
 * Uses skipLoad=true so the handler never touches Supabase — this keeps
 * it fast and reliable even in CI / test environments with fake creds.
 */

import { NextRequest, NextResponse } from 'next/server'
import { calculateHumanLikeDelays } from '@/lib/hybrid/humanlike'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  const text = req.nextUrl.searchParams.get('text') || 'test'
  const result = await calculateHumanLikeDelays(
    text,
    {
      // Force deterministic-ish path during tests
      break_every_n: 999999,
      long_pause_ratio: 0,
    },
    { skipLoad: true },
  )
  return NextResponse.json(result)
}
