/**
 * events/alerts.ts — Fire alerts into Telegram admin channel + alerts table
 *
 * Dedup: same alert_key inside `event_alert_rate_limit_minutes` window is
 * suppressed so we don't spam the admin during an outage.
 */

import { getServiceClient, getSettings } from '@/lib/supabase'
import { sendToTelegram } from '@/lib/telegram'

export type AlertSeverity = 'info' | 'warn' | 'error' | 'critical'

export interface AlertInput {
  alert_key: string
  severity?: AlertSeverity
  title: string
  detail?: string
  metadata?: Record<string, unknown>
}

async function recentlyFired(alertKey: string, windowMinutes: number): Promise<boolean> {
  const db = getServiceClient()
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString()
  const { data } = await db
    .from('alerts')
    .select('id')
    .eq('alert_key', alertKey)
    .gte('fired_at', since)
    .limit(1)
  return !!(data && data.length > 0)
}

function severityEmoji(sev: AlertSeverity): string {
  switch (sev) {
    case 'critical': return 'CRITICAL'
    case 'error': return 'ERROR'
    case 'warn': return 'WARN'
    default: return 'INFO'
  }
}

export async function fireAlert(input: AlertInput): Promise<{ fired: boolean; reason?: string }> {
  const severity: AlertSeverity = input.severity || 'warn'
  const db = getServiceClient()
  const settings = await getSettings()

  const rateLimitMin = parseInt(settings.event_alert_rate_limit_minutes || '10', 10)
  if (await recentlyFired(input.alert_key, rateLimitMin)) {
    return { fired: false, reason: 'rate_limited' }
  }

  // Record the alert
  await db.from('alerts').insert({
    alert_key: input.alert_key,
    severity,
    title: input.title,
    detail: input.detail || null,
    metadata: input.metadata || {},
  })

  // Forward to Telegram admin channel if configured
  if (settings.telegram_bot_token && settings.telegram_admin_channel) {
    const lines = [
      `[${severityEmoji(severity)}] <b>${input.title}</b>`,
      input.detail ? `\n${input.detail}` : '',
      `\n<code>key: ${input.alert_key}</code>`,
    ].filter(Boolean)

    await sendToTelegram(
      settings.telegram_bot_token,
      settings.telegram_admin_channel,
      lines.join('\n'),
    )
  }

  return { fired: true }
}
