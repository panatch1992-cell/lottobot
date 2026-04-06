import { MessagingProvider, SendResult } from '@/lib/providers/types'

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

export async function withFallback(
  primary: MessagingProvider,
  secondary: MessagingProvider,
  autoFailover: boolean,
  task: (provider: MessagingProvider) => Promise<SendResult>,
): Promise<SendResult> {
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
