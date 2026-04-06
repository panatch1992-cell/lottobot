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

export async function sendText(to: string, text: string) {
  const { cfg, primary, fallback } = await resolveProviders()
  return withFallback(primary, fallback, cfg.autoFailover, p => p.pushText(to, text))
}

export async function sendImageAndText(to: string, imageUrl: string, text: string) {
  const { cfg, primary, fallback } = await resolveProviders()
  return withFallback(primary, fallback, cfg.autoFailover, p => p.pushImageAndText(to, imageUrl, text))
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
export async function pushTextMessage(_channelAccessToken: string, to: string, text: string) {
  return sendText(to, text)
}

export async function pushImageAndText(_channelAccessToken: string, to: string, imageUrl: string, text: string) {
  return sendImageAndText(to, imageUrl, text)
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
      reason: 'primary provider is unofficial_line (skip official LINE quota gate)',
    }
  }

  return checkOfficialLineQuota()
}

export { flagMonthlyLimitHit }
export { verifyChannelToken, getLineQuotaFromAPI }
