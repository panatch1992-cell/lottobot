import { getSettings } from '@/lib/supabase'
import { OfficialLineProvider } from '@/lib/providers/official-line-provider'
import { UnofficialLineProvider } from '@/lib/providers/unofficial-line-provider'
import { MessagingProvider, ProviderName } from '@/lib/providers/types'

export type ProviderConfig = {
  primary: ProviderName
  fallback: ProviderName
  autoFailover: boolean
  officialToken?: string
  unofficialEndpoint?: string
  unofficialToken?: string
  effectiveReason?: string
}

function isTruthy(value?: string) {
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function normalizeProviderName(value: string | undefined, fallback: ProviderName): ProviderName {
  return value === 'official_line' || value === 'unofficial_line' ? value : fallback
}

function isProviderConfigured(name: ProviderName, cfg: Pick<ProviderConfig, 'officialToken' | 'unofficialEndpoint'>) {
  if (name === 'official_line') return !!cfg.officialToken
  return !!cfg.unofficialEndpoint
}

function makeEffectiveConfig(base: ProviderConfig): ProviderConfig {
  const forceOfficial = isTruthy(process.env.FORCE_OFFICIAL_LINE)
  const unofficialCanaryEnabled = isTruthy(process.env.UNOFFICIAL_CANARY_ENABLED)
  if (forceOfficial) {
    return {
      ...base,
      primary: 'official_line',
      fallback: 'official_line',
      autoFailover: true,
      effectiveReason: 'FORCE_OFFICIAL_LINE enabled',
    }
  }

  const officialConfigured = isProviderConfigured('official_line', base)
  const unofficialConfigured = isProviderConfigured('unofficial_line', base)

  let primary = base.primary
  let fallback = base.fallback
  let reason = ''

  if (!unofficialCanaryEnabled && base.primary === 'unofficial_line' && officialConfigured) {
    primary = 'official_line'
    fallback = 'official_line'
    reason = 'UNOFFICIAL_CANARY_ENABLED is disabled; forced official_line for production readiness'
  }

  if (!isProviderConfigured(primary, base)) {
    if (primary === 'unofficial_line' && officialConfigured) {
      primary = 'official_line'
      fallback = 'official_line'
      reason = 'unofficial provider not configured; switched to official_line for immediate delivery'
    } else if (primary === 'official_line' && unofficialConfigured) {
      primary = 'unofficial_line'
      reason = 'official token missing; switched primary to unofficial_line'
    }
  }

  if (!isProviderConfigured(fallback, base)) {
    fallback = officialConfigured ? 'official_line' : primary
  }

  return {
    ...base,
    primary,
    fallback,
    autoFailover: base.autoFailover || primary !== fallback,
    effectiveReason: reason || base.effectiveReason,
  }
}

export async function getProviderConfig(): Promise<ProviderConfig> {
  const settings = await getSettings()

  const primary = normalizeProviderName(settings.messaging_primary_provider, 'official_line')
  const fallback = normalizeProviderName(settings.messaging_fallback_provider, 'official_line')
  const autoFailover = isTruthy(settings.messaging_auto_failover_enabled || 'true')

  const baseConfig: ProviderConfig = {
    primary,
    fallback,
    autoFailover,
    officialToken: settings.line_channel_access_token,
    unofficialEndpoint: settings.unofficial_line_endpoint || process.env.UNOFFICIAL_LINE_ENDPOINT,
    unofficialToken: settings.unofficial_line_token || process.env.UNOFFICIAL_LINE_TOKEN,
  }

  return makeEffectiveConfig(baseConfig)
}

export function createProvider(name: ProviderName, cfg: ProviderConfig): MessagingProvider {
  if (name === 'unofficial_line') {
    return new UnofficialLineProvider(cfg.unofficialEndpoint || '', cfg.unofficialToken)
  }

  return new OfficialLineProvider(cfg.officialToken || '')
}
