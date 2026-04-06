import { NextRequest, NextResponse } from 'next/server'
import { getSettings } from '@/lib/supabase'
import { sendToTelegram } from '@/lib/telegram'
import { checkUnofficialHealth } from '@/lib/messaging-service'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  const testMode = req.nextUrl.searchParams.get('test') === '1'
  if (!testMode && secret !== process.env.CRON_SECRET && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const settings = await getSettings()
  const health = await checkUnofficialHealth()

  // Only send TG alert when endpoint is DOWN
  if (!health.ok && settings.telegram_bot_token && settings.telegram_admin_channel) {
    const alertMsg = [
      '🔴 <b>Unofficial Endpoint DOWN</b>',
      '',
      `❌ Error: <code>${health.error || 'unknown'}</code>`,
      `⏱ Latency: ${health.latencyMs}ms`,
      '',
      '🔄 Auto Failover → Official LINE API',
      `🕐 ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`,
    ].join('\n')

    await sendToTelegram(settings.telegram_bot_token, settings.telegram_admin_channel, alertMsg)
  }

  return NextResponse.json({
    unofficial: health,
    timestamp: new Date().toISOString(),
  })
}
