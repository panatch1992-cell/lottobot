import { MessagingProvider, SendResult } from '@/lib/providers/types'

export async function withFallback(
  primary: MessagingProvider,
  secondary: MessagingProvider,
  autoFailover: boolean,
  task: (provider: MessagingProvider) => Promise<SendResult>,
): Promise<SendResult> {
  const primaryResult = await task(primary)
  if (primaryResult.success || !autoFailover || primary.name === secondary.name) {
    return primaryResult
  }

  const fallbackResult = await task(secondary)
  if (fallbackResult.success) {
    return fallbackResult
  }

  return {
    success: false,
    provider: fallbackResult.provider,
    error: `Primary failed: ${primaryResult.error || 'unknown'} | Fallback failed: ${fallbackResult.error || 'unknown'}`,
  }
}
