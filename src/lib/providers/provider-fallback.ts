import { MessagingProvider, SendResult } from '@/lib/providers/types'
import { UnofficialLineProvider } from '@/lib/providers/unofficial-line-provider'

async function executeSafely(
  provider: MessagingProvider,
  task: (provider: MessagingProvider) => Promise<SendResult>,
): Promise<SendResult> {
  try {
    return await task(provider)
  } catch (err) {
    return {
      success: false,
      provider: provider.name,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

/**
 * If the primary is unofficial_line, check /health first.
 * If health check fails → skip primary entirely and go straight to fallback.
 * This avoids wasting time on a dead endpoint.
 */
export async function withFallback(
  primary: MessagingProvider,
  secondary: MessagingProvider,
  autoFailover: boolean,
  task: (provider: MessagingProvider) => Promise<SendResult>,
): Promise<SendResult> {
  // Pre-flight health check for unofficial endpoint
  if (primary.name === 'unofficial_line' && autoFailover && primary instanceof UnofficialLineProvider) {
    const health = await primary.healthCheck(5000)
    if (!health.ok) {
      // Unofficial is down → skip to fallback immediately
      console.warn(`[fallback] Unofficial endpoint down (${health.error}, ${health.latencyMs}ms) → using ${secondary.name}`)
      const fallbackResult = await executeSafely(secondary, task)
      return {
        ...fallbackResult,
        error: fallbackResult.success
          ? undefined
          : `Primary skipped (health: ${health.error}) | Fallback: ${fallbackResult.error || 'unknown'}`,
      }
    }
  }

  const primaryResult = await executeSafely(primary, task)
  if (primaryResult.success || !autoFailover || primary.name === secondary.name) {
    return primaryResult
  }

  const fallbackResult = await executeSafely(secondary, task)
  if (fallbackResult.success) {
    return fallbackResult
  }

  return {
    success: false,
    provider: fallbackResult.provider,
    error: `Primary failed: ${primaryResult.error || 'unknown'} | Fallback failed: ${fallbackResult.error || 'unknown'}`,
  }
}
