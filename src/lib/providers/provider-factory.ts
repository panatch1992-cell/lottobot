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
  if (value === 'official_line' || value === 'unofficial_line') {
    return value
  }

  return 'official_line'
}

export async function getProviderConfig(): Promise<ProviderConfig> {
  const settings = await getSettings()

  const primary = normalizeProviderName(settings.messaging_primary_provider)
  const fallback = normalizeProviderName(settings.messaging_fallback_provider)
  const autoFailover = (settings.messaging_auto_failover_enabled || 'true') === 'true'

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
