import { getSettings } from '@/lib/supabase'
import { OfficialLineProvider } from '@/lib/providers/official-line-provider'
import { UnofficialLineProvider } from '@/lib/providers/unofficial-line-provider'
import { MessagingProvider, ProviderName } from '@/lib/providers/types'

type ProviderConfig = {
  primary: ProviderName
  fallback: ProviderName
  autoFailover: boolean
  officialToken?: string
  unofficialEndpoint?: string
  unofficialToken?: string
}

function normalizeProviderName(value: unknown): ProviderName {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'official_line' || normalized === 'unofficial_line') {
    return normalized
  }

  return 'official_line'
}

function parseBooleanSetting(value: unknown, defaultValue = true): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0

  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return defaultValue

  if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  if (['false', '0', 'no', 'off'].includes(normalized)) return false
  return defaultValue
}

export async function getProviderConfig(): Promise<ProviderConfig> {
  const settings = await getSettings()

  const primary = normalizeProviderName(settings.messaging_primary_provider || settings.line_provider_primary)
  const fallback = normalizeProviderName(settings.messaging_fallback_provider || settings.line_provider_fallback)
  const autoFailover = parseBooleanSetting(
    settings.messaging_auto_failover_enabled ?? settings.fallback_enabled,
    true,
  )

  return {
    primary,
    fallback,
    autoFailover,
    officialToken: settings.line_channel_access_token,
    unofficialEndpoint: settings.unofficial_line_endpoint || process.env.UNOFFICIAL_LINE_ENDPOINT,
    unofficialToken: settings.unofficial_line_token || process.env.UNOFFICIAL_LINE_TOKEN,
  }
}

export function createProvider(name: ProviderName, cfg: ProviderConfig): MessagingProvider {
  if (name === 'unofficial_line') {
    return new UnofficialLineProvider(cfg.unofficialEndpoint || '', cfg.unofficialToken)
  }

  return new OfficialLineProvider(cfg.officialToken || '')
}
