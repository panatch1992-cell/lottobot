import { NextResponse } from 'next/server'
import { checkUnofficialHealth } from '@/lib/messaging-service'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const health = await checkUnofficialHealth()
    return NextResponse.json({
      valid: health.ok,
      latencyMs: health.latencyMs,
      error: health.ok ? undefined : (health.error || 'Endpoint ไม่ตอบ'),
    })
  } catch (err) {
    return NextResponse.json({ valid: false, error: err instanceof Error ? err.message : 'Server error' })
  }
}
