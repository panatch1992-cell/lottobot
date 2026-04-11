/**
 * events/breaker.ts — Circuit breaker backed by circuit_breaker_state table
 *
 * States: closed → open → half_open → closed
 *   - closed: normal operation, count failures
 *   - open: reject fast for `cooldown_seconds` after consecutive failures ≥ threshold
 *   - half_open: allow one probe; success → closed, failure → open
 */

import { getServiceClient } from '@/lib/supabase'
import { BreakerState } from './types'

export const LOTTERY_DISPATCH_BREAKER = 'lottery_dispatch'

export interface BreakerSnapshot {
  name: string
  state: BreakerState
  consecutive_failures: number
  consecutive_successes: number
  failure_threshold: number
  cooldown_seconds: number
  opened_at: string | null
  last_failure_at: string | null
  last_success_at: string | null
  last_error: string | null
}

async function loadOrSeed(name: string): Promise<BreakerSnapshot> {
  const db = getServiceClient()
  const { data } = await db
    .from('circuit_breaker_state')
    .select('*')
    .eq('breaker_name', name)
    .maybeSingle()

  if (data) return data as BreakerSnapshot

  const seed: BreakerSnapshot = {
    name,
    state: 'closed',
    consecutive_failures: 0,
    consecutive_successes: 0,
    failure_threshold: 5,
    cooldown_seconds: 120,
    opened_at: null,
    last_failure_at: null,
    last_success_at: null,
    last_error: null,
  }
  await db.from('circuit_breaker_state').insert({
    breaker_name: name,
    state: seed.state,
    consecutive_failures: 0,
    consecutive_successes: 0,
    failure_threshold: seed.failure_threshold,
    cooldown_seconds: seed.cooldown_seconds,
  })
  return seed
}

/**
 * Returns the breaker state resolving open → half_open if cooldown has elapsed.
 */
export async function getBreakerState(name = LOTTERY_DISPATCH_BREAKER): Promise<BreakerSnapshot> {
  const snap = await loadOrSeed(name)

  if (snap.state === 'open' && snap.opened_at) {
    const openedAtMs = Date.parse(snap.opened_at)
    const nowMs = Date.now()
    if (nowMs - openedAtMs >= snap.cooldown_seconds * 1000) {
      // Promote to half_open so one probe may pass
      const db = getServiceClient()
      await db
        .from('circuit_breaker_state')
        .update({ state: 'half_open', updated_at: new Date().toISOString() })
        .eq('breaker_name', name)
      snap.state = 'half_open'
    }
  }

  return snap
}

export async function recordSuccess(name = LOTTERY_DISPATCH_BREAKER) {
  const db = getServiceClient()
  const snap = await loadOrSeed(name)
  await db
    .from('circuit_breaker_state')
    .update({
      state: 'closed',
      consecutive_failures: 0,
      consecutive_successes: (snap.consecutive_successes || 0) + 1,
      last_success_at: new Date().toISOString(),
      last_error: null,
      opened_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('breaker_name', name)
}

export async function recordFailure(
  error: string,
  name = LOTTERY_DISPATCH_BREAKER,
): Promise<{ opened: boolean; state: BreakerState }> {
  const db = getServiceClient()
  const snap = await loadOrSeed(name)
  const failures = (snap.consecutive_failures || 0) + 1
  const threshold = snap.failure_threshold || 5
  const shouldOpen = failures >= threshold

  const nextState: BreakerState = shouldOpen ? 'open' : snap.state === 'half_open' ? 'open' : 'closed'
  const wasClosed = snap.state !== 'open'
  const opened = nextState === 'open' && wasClosed

  await db
    .from('circuit_breaker_state')
    .update({
      state: nextState,
      consecutive_failures: failures,
      consecutive_successes: 0,
      last_failure_at: new Date().toISOString(),
      last_error: error.slice(0, 500),
      opened_at: opened ? new Date().toISOString() : snap.opened_at,
      updated_at: new Date().toISOString(),
    })
    .eq('breaker_name', name)

  return { opened, state: nextState }
}
