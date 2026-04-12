/**
 * hybrid/humanlike.ts
 *
 * Human-like behavior helpers for the Hybrid Reply trigger flow.
 * Goal: reduce LINE anti-spam signature by breaking fixed patterns.
 *
 * Three behaviors (inspired by Playwright anti-detection patterns):
 *
 *   1. Typing delay (instead of instant fill)
 *      → simulateTypingDelay(text) waits ~50-200ms per char
 *
 *   2. Thinking time (random 2-5s before "sending")
 *      → humanLikeThinkingTime() with bimodal distribution
 *        (80% fast 2-5s, 20% slow 5-15s) so the delay is not uniform
 *
 *   3. Non-fixed patterns (equivalent to random click position)
 *      → occasionalLongBreak() — every ~15 sends, take a 30-60s pause
 *      → hourOfDayMultiplier() — 2x delay outside business hours
 *
 * All behaviors are:
 *   - gated by bot_settings.humanlike_enabled (default on)
 *   - tunable via other bot_settings keys (fall back to safe defaults)
 *   - safe to use in-process — no external deps
 */

import { getSettings } from '@/lib/supabase'
import { sleep, nowBangkok } from '@/lib/utils'

// ─── Defaults (used when bot_settings is missing the key) ─────

const DEFAULTS = {
  enabled: true,
  typing_ms_per_char: 80,        // ~12 chars/sec — natural typing speed
  typing_min_ms: 400,             // floor even for short text
  typing_max_ms: 3500,            // cap so we don't wait forever
  typing_jitter_ratio: 0.35,      // ±35% random jitter on per-char delay

  thinking_min_ms: 2000,          // min "about to type" pause
  thinking_max_ms: 5000,          // max short thinking
  long_pause_ratio: 0.2,          // 20% of sends get a longer pause
  long_pause_min_ms: 5000,
  long_pause_max_ms: 15000,

  break_every_n: 15,              // after ~15 sends, take a longer rest
  break_min_ms: 20000,
  break_max_ms: 60000,

  night_multiplier: 1.6,          // x1.6 delay during 22:00-07:00 BKK
  night_start_hour: 22,
  night_end_hour: 7,
}

type HumanlikeConfig = typeof DEFAULTS

// ─── Per-process counters for break scheduling ──────────────

let sendCounter = 0

function parseIntSafe(v: string | undefined, fallback: number): number {
  const n = parseInt(v || '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function parseFloatSafe(v: string | undefined, fallback: number): number {
  const n = parseFloat(v || '')
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v == null) return fallback
  const lower = v.toLowerCase()
  if (lower === 'true' || lower === '1' || lower === 'on' || lower === 'yes') return true
  if (lower === 'false' || lower === '0' || lower === 'off' || lower === 'no') return false
  return fallback
}

/**
 * Load config from bot_settings (falls back to DEFAULTS)
 */
async function loadConfig(): Promise<HumanlikeConfig> {
  const s = await getSettings()
  return {
    enabled: parseBool(s.humanlike_enabled, DEFAULTS.enabled),
    typing_ms_per_char: parseIntSafe(s.humanlike_typing_ms_per_char, DEFAULTS.typing_ms_per_char),
    typing_min_ms: parseIntSafe(s.humanlike_typing_min_ms, DEFAULTS.typing_min_ms),
    typing_max_ms: parseIntSafe(s.humanlike_typing_max_ms, DEFAULTS.typing_max_ms),
    typing_jitter_ratio: parseFloatSafe(s.humanlike_typing_jitter_ratio, DEFAULTS.typing_jitter_ratio),
    thinking_min_ms: parseIntSafe(s.humanlike_thinking_min_ms, DEFAULTS.thinking_min_ms),
    thinking_max_ms: parseIntSafe(s.humanlike_thinking_max_ms, DEFAULTS.thinking_max_ms),
    long_pause_ratio: parseFloatSafe(s.humanlike_long_pause_ratio, DEFAULTS.long_pause_ratio),
    long_pause_min_ms: parseIntSafe(s.humanlike_long_pause_min_ms, DEFAULTS.long_pause_min_ms),
    long_pause_max_ms: parseIntSafe(s.humanlike_long_pause_max_ms, DEFAULTS.long_pause_max_ms),
    break_every_n: parseIntSafe(s.humanlike_break_every_n, DEFAULTS.break_every_n),
    break_min_ms: parseIntSafe(s.humanlike_break_min_ms, DEFAULTS.break_min_ms),
    break_max_ms: parseIntSafe(s.humanlike_break_max_ms, DEFAULTS.break_max_ms),
    night_multiplier: parseFloatSafe(s.humanlike_night_multiplier, DEFAULTS.night_multiplier),
    night_start_hour: parseIntSafe(s.humanlike_night_start_hour, DEFAULTS.night_start_hour),
    night_end_hour: parseIntSafe(s.humanlike_night_end_hour, DEFAULTS.night_end_hour),
  }
}

// ─── Helpers ───────────────────────────────────────────────

function randomBetween(min: number, max: number): number {
  if (max <= min) return min
  return Math.floor(Math.random() * (max - min) + min)
}

function hourOfDayMultiplier(cfg: HumanlikeConfig): number {
  const hour = nowBangkok().getHours()
  const inNight =
    cfg.night_start_hour < cfg.night_end_hour
      ? hour >= cfg.night_start_hour && hour < cfg.night_end_hour
      : hour >= cfg.night_start_hour || hour < cfg.night_end_hour
  return inNight ? cfg.night_multiplier : 1
}

// ─── Public API ────────────────────────────────────────────

export interface HumanlikeTraceEntry {
  label: string
  ms: number
}

/**
 * Compute a "typing duration" based on the message length.
 * - Roughly cfg.typing_ms_per_char × length, with per-char jitter
 * - Clamped by typing_min_ms / typing_max_ms
 */
export function computeTypingDuration(text: string, cfg: HumanlikeConfig = DEFAULTS): number {
  const len = text.length
  const jitter = cfg.typing_jitter_ratio
  // average per-char with jitter around 1.0 ± jitter
  const perCharFactor = 1 + (Math.random() * 2 - 1) * jitter
  const raw = len * cfg.typing_ms_per_char * perCharFactor
  const bounded = Math.max(cfg.typing_min_ms, Math.min(cfg.typing_max_ms, raw))
  return Math.floor(bounded)
}

/**
 * Sample a thinking-time delay using a bimodal distribution:
 *   - (1 - long_pause_ratio) chance of SHORT pause (2-5s)
 *   - long_pause_ratio chance of LONG pause (5-15s)
 *
 * Multiplied by night/weekend multiplier.
 */
export function sampleThinkingTime(cfg: HumanlikeConfig = DEFAULTS): number {
  const useLong = Math.random() < cfg.long_pause_ratio
  const base = useLong
    ? randomBetween(cfg.long_pause_min_ms, cfg.long_pause_max_ms)
    : randomBetween(cfg.thinking_min_ms, cfg.thinking_max_ms)
  return Math.floor(base * hourOfDayMultiplier(cfg))
}

/**
 * Sample an "occasional break" — returns 0 most of the time, but
 * every `break_every_n` sends returns a large number.
 * Counter is per process (resets on cold start, which is fine).
 */
export function sampleBreakIfDue(cfg: HumanlikeConfig = DEFAULTS): number {
  sendCounter += 1
  // Randomize the threshold so it's not a fixed pattern
  const threshold = cfg.break_every_n + randomBetween(-3, 3)
  if (sendCounter >= threshold) {
    sendCounter = 0
    return randomBetween(cfg.break_min_ms, cfg.break_max_ms)
  }
  return 0
}

/**
 * Full "before send" pre-amble for a single trigger send.
 *
 * Sequence:
 *   1. occasional long break (only every ~15 sends)
 *   2. thinking time (bimodal 2-5s or 5-15s)
 *   3. typing duration (based on phrase length)
 *
 * Total delay is the SUM of all applicable components.
 * Returns a trace so callers can log it for observability.
 */
export async function humanLikePreSend(
  text: string,
  overrideCfg?: Partial<HumanlikeConfig>,
): Promise<{ totalMs: number; trace: HumanlikeTraceEntry[] }> {
  const base = await loadConfig()
  const cfg: HumanlikeConfig = { ...base, ...overrideCfg }

  if (!cfg.enabled) {
    return { totalMs: 0, trace: [{ label: 'disabled', ms: 0 }] }
  }

  const trace: HumanlikeTraceEntry[] = []
  let totalMs = 0

  // 1. Occasional break (long idle — every ~15 sends)
  const breakMs = sampleBreakIfDue(cfg)
  if (breakMs > 0) {
    trace.push({ label: 'break', ms: breakMs })
    totalMs += breakMs
    await sleep(breakMs)
  }

  // 2. Thinking time
  const thinkingMs = sampleThinkingTime(cfg)
  trace.push({ label: 'thinking', ms: thinkingMs })
  totalMs += thinkingMs
  await sleep(thinkingMs)

  // 3. Typing duration
  const typingMs = computeTypingDuration(text, cfg)
  trace.push({ label: 'typing', ms: typingMs })
  totalMs += typingMs
  await sleep(typingMs)

  return { totalMs, trace }
}

/**
 * Non-sleeping version (for tests or when caller wants to compose)
 * Returns the calculated delays without actually sleeping.
 *
 * If `skipLoad=true`, skips the Supabase getSettings() call and uses
 * DEFAULTS merged with overrideCfg. Useful in test environments where
 * Supabase is unreachable.
 */
export async function calculateHumanLikeDelays(
  text: string,
  overrideCfg?: Partial<HumanlikeConfig>,
  options: { skipLoad?: boolean } = {},
): Promise<{ totalMs: number; trace: HumanlikeTraceEntry[] }> {
  const base = options.skipLoad ? DEFAULTS : await loadConfig()
  const cfg: HumanlikeConfig = { ...base, ...overrideCfg }

  if (!cfg.enabled) return { totalMs: 0, trace: [{ label: 'disabled', ms: 0 }] }

  const trace: HumanlikeTraceEntry[] = []
  let totalMs = 0

  const breakMs = sampleBreakIfDue(cfg)
  if (breakMs > 0) {
    trace.push({ label: 'break', ms: breakMs })
    totalMs += breakMs
  }

  const thinkingMs = sampleThinkingTime(cfg)
  trace.push({ label: 'thinking', ms: thinkingMs })
  totalMs += thinkingMs

  const typingMs = computeTypingDuration(text, cfg)
  trace.push({ label: 'typing', ms: typingMs })
  totalMs += typingMs

  return { totalMs, trace }
}

// ─── Test hooks (for unit tests / resets) ────────────────
export function __resetHumanlikeCounter() {
  sendCounter = 0
}

export const __defaults = DEFAULTS
