import { NextResponse } from 'next/server'
import { checkUnofficialHealth } from '@/lib/messaging-service'

export const dynamic = 'force-dynamic'

export async function GET() {
  const health = await checkUnofficialHealth()

  return NextResponse.json({
    endpoint_ok: health.ok,
    latency_ms: health.latencyMs,
    has_auth_token: health.hasAuthToken,
    has_line_token: health.hasLineToken,
    error: health.error,
    hint: 'ใช้ /api/system-check สำหรับตรวจสอบระบบทั้งหมด',
  })
}
