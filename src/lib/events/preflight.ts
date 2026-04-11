/**
 * events/preflight.ts — Gate checks before we burn a dispatch attempt
 *
 * Checks:
 *   1. Circuit breaker state (closed / half_open → pass, open → fail)
 *   2. Unofficial endpoint /health → clientReady
 *   3. Latency under a sane threshold (8s hard timeout)
 */

import { checkUnofficialHealth } from '@/lib/messaging-service'
import { getBreakerState, LOTTERY_DISPATCH_BREAKER } from './breaker'
import { PreflightStatus } from './types'

export async function runPreflight(): Promise<PreflightStatus> {
  const breaker = await getBreakerState(LOTTERY_DISPATCH_BREAKER)

  if (breaker.state === 'open') {
    return {
      ready: false,
      clientReady: false,
      breakerState: 'open',
      endpoint: null,
      reason: `breaker open (cooldown ${breaker.cooldown_seconds}s)`,
      detail: { last_error: breaker.last_error, opened_at: breaker.opened_at },
    }
  }

  const health = await checkUnofficialHealth()
  const clientReady = !!(health.ok && (health.hasAuthToken !== false))

  if (!health.ok) {
    return {
      ready: false,
      clientReady: false,
      breakerState: breaker.state,
      endpoint: null,
      latencyMs: health.latencyMs,
      reason: `health failed: ${health.error || 'unknown'}`,
      detail: { latency: health.latencyMs },
    }
  }

  if (!clientReady) {
    return {
      ready: false,
      clientReady: false,
      breakerState: breaker.state,
      endpoint: null,
      latencyMs: health.latencyMs,
      reason: 'clientReady=false (endpoint missing auth)',
      detail: { hasAuthToken: health.hasAuthToken, hasLineToken: health.hasLineToken },
    }
  }

  return {
    ready: true,
    clientReady: true,
    breakerState: breaker.state,
    endpoint: 'unofficial_line',
    latencyMs: health.latencyMs,
    detail: { hasAuthToken: health.hasAuthToken, hasLineToken: health.hasLineToken },
  }
}
