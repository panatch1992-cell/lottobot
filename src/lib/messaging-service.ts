import {
  checkLineQuota as checkOfficialLineQuota,
  flagMonthlyLimitHit,
  verifyChannelToken,
  getLineQuotaFromAPI,
} from '@/lib/line-messaging'
import { createProvider, getProviderConfig } from '@/lib/providers/provider-factory'
import { withFallback } from '@/lib/providers/provider-fallback'

async function resolveProviders() {
  const cfg = await getProviderConfig()
  const primary = createProvider(cfg.primary, cfg)
  const fallback = createProvider(cfg.fallback, cfg)
  return { cfg, primary, fallback }
}

/**
 * Send text to a group. Pass both IDs for dual-provider support.
 * officialId = Ca... (LINE Messaging API)
 * unofficialId = c... (linepy personal account)
 */
export async function sendText(to: string, text: string, unofficialTo?: string) {
  const { cfg, primary, fallback } = await resolveProviders()
  return withFallback(primary, fallback, cfg.autoFailover, p => {
    const targetId = (p.name === 'unofficial_line' && unofficialTo) ? unofficialTo : to
    return p.pushText(targetId, text)
  })
}

export async function sendImageAndText(to: string, imageUrl: string, text: string, unofficialTo?: string) {
  const { cfg, primary, fallback } = await resolveProviders()
  return withFallback(primary, fallback, cfg.autoFailover, p => {
    const targetId = (p.name === 'unofficial_line' && unofficialTo) ? unofficialTo : to
    return p.pushImageAndText(targetId, imageUrl, text)
  })
}

export async function broadcastTextMessage(text: string) {
  const { cfg, primary, fallback } = await resolveProviders()
  return withFallback(primary, fallback, cfg.autoFailover, p => p.broadcastText(text))
}

export async function broadcastImageText(imageUrl: string, text: string) {
  const { cfg, primary, fallback } = await resolveProviders()
  return withFallback(primary, fallback, cfg.autoFailover, p => p.broadcastImageAndText(imageUrl, text))
}

// Backward-compatible names to reduce route changes
export async function pushTextMessage(_channelAccessToken: string, to: string, text: string, unofficialTo?: string) {
  return sendText(to, text, unofficialTo)
}

export async function pushImageAndText(_channelAccessToken: string, to: string, imageUrl: string, text: string, unofficialTo?: string) {
  return sendImageAndText(to, imageUrl, text, unofficialTo)
}

export async function broadcastText(_channelAccessToken: string, text: string) {
  return broadcastTextMessage(text)
}

export async function broadcastImageAndText(_channelAccessToken: string, imageUrl: string, text: string) {
  return broadcastImageText(imageUrl, text)
}

export async function checkLineQuota() {
  const cfg = await getProviderConfig()

  // If unofficial is primary, do not block sends with official quota gate.
  // This keeps unofficial mode effectively unlimited from the app perspective.
  // Official quota is still relevant only when/if a fallback attempt reaches official provider.
  if (cfg.primary === 'unofficial_line') {
    return {
      canSend: true,
      used: 0,
      quota: 0,
      remaining: 0,
      dailyBudget: 9999,
      todaySent: 0,
      daysLeft: 1,
      source: 'flag' as const,
      reason: 'official LINE is not in active send path (skip official LINE quota gate)',
    }
  }

  return checkOfficialLineQuota()
}

/** Check unofficial endpoint health and return status */
export async function checkUnofficialHealth() {
  const cfg = await getProviderConfig()
  if (cfg.primary !== 'unofficial_line' && cfg.fallback !== 'unofficial_line') {
    return { ok: false, latencyMs: 0, error: 'Unofficial not configured as primary or fallback' }
  }

  const { UnofficialLineProvider } = await import('@/lib/providers/unofficial-line-provider')
  const provider = new UnofficialLineProvider(cfg.unofficialEndpoint || '', cfg.unofficialToken)
  return provider.healthCheck()
}

export { flagMonthlyLimitHit }
export { verifyChannelToken, getLineQuotaFromAPI }
