// LottoBot — Types

export type LotteryStatus = 'active' | 'inactive'
export type ResultFormat = '3d_2d' | '3d_only' | '6d' | 'custom'
export type SendStatus = 'pending' | 'sending' | 'sent' | 'failed'
export type SendChannel = 'telegram' | 'line'
export type MessageType = 'result' | 'countdown' | 'stats' | 'trigger_send' | 'trigger_reply'

export interface Lottery {
  id: string
  name: string
  flag: string
  country: string | null
  result_time: string
  close_time: string | null
  source_url: string | null
  result_format: ResultFormat
  send_stats: boolean
  countdown_minutes: number
  status: LotteryStatus
  sort_order: number
  created_at: string
  updated_at: string
}

export interface Result {
  id: string
  lottery_id: string
  draw_date: string
  top_number: string | null
  bottom_number: string | null
  full_number: string | null
  raw_data: Record<string, unknown> | null
  source_url: string | null
  scraped_at: string | null
  created_at: string
}

export interface LineGroup {
  id: string
  name: string
  line_notify_token: string | null
  line_group_id: string | null
  unofficial_group_id: string | null
  member_count: number
  is_active: boolean
  custom_link: string | null
  custom_message: string | null
  send_all_lotteries: boolean
  created_at: string
  updated_at: string
}

export interface SendLog {
  id: string
  result_id: string | null
  lottery_id: string
  line_group_id: string | null
  channel: SendChannel
  msg_type: MessageType
  status: SendStatus
  sent_at: string | null
  duration_ms: number | null
  error_message: string | null
  created_at: string
  // joined
  lottery?: Lottery
  line_group?: LineGroup
}

export interface ScrapeSource {
  id: string
  lottery_id: string
  url: string
  is_primary: boolean
  selector_config: SelectorConfig | null
  is_active: boolean
  last_success_at: string | null
  last_error: string | null
  created_at: string
}

export interface SelectorConfig {
  top_selector?: string
  bottom_selector?: string
  full_selector?: string
  date_selector?: string
  [key: string]: string | undefined
}

export interface BotSetting {
  id: string
  key: string
  value: string
  description: string | null
  updated_at: string
}

// Dashboard stat types
export interface DashboardStats {
  totalLotteries: number
  activeLotteries: number
  totalLineGroups: number
  activeLineGroups: number
  todaySent: number
  todayFailed: number
}

export interface TodayLotteryStatus {
  lottery: Lottery
  result: Result | null
  tgStatus: SendStatus | null
  lineStatus: SendStatus | null
  lineGroupCount: number
}

// ─── Hybrid Reply System (migration 005) ───────────────

export type PendingReplyIntent =
  | 'announce'       // Phase 1: รายการต่อไป + สถิติ + รูปเลขเด็ด
  | 'result'         // Phase 6: ผลหวย บน/ล่าง/เต็ม
  | 'countdown_20'   // Phase 2 (direct — no reply needed)
  | 'countdown_10'   // Phase 3
  | 'countdown_5'    // Phase 4
  | 'closing'        // Phase 5 (direct)

export type PendingReplyStatus =
  | 'pending'
  | 'trigger_sent'
  | 'replied'
  | 'expired'
  | 'failed'

export interface PendingReply {
  id: string
  line_group_id: string
  lottery_id: string | null
  intent_type: PendingReplyIntent
  payload: PendingReplyPayload
  trigger_text: string
  trigger_phrase_used: string | null
  status: PendingReplyStatus
  retry_count: number
  max_retries: number
  expires_at: string
  trigger_sent_at: string | null
  replied_at: string | null
  webhook_event_id: string | null
  reply_token_used: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export interface PendingReplyPayload {
  text?: string
  image_url?: string
  lucky_image_url?: string | null
  image_caption?: string
  stats_text?: string
  result_text?: string
  lottery_name?: string
  custom_link?: string
  // free-form extras the composer can read
  [key: string]: unknown
}

export type LuckyImageCategory =
  | 'general'
  | 'laos'
  | 'stock'
  | 'vietnam'
  | 'hanoi'
  | 'thai'
  | 'korea'
  | 'china'
  | 'japan'
  | 'other'

export interface LuckyImage {
  id: string
  storage_path: string
  public_url: string
  category: LuckyImageCategory | string
  caption: string | null
  source_url: string | null
  source_hash: string | null
  use_count: number
  last_used_at: string | null
  uploaded_by: string | null
  uploaded_at: string
  is_active: boolean
}

export type BotAccountHealth =
  | 'unknown'
  | 'healthy'
  | 'degraded'
  | 'banned'
  | 'cooldown'

export interface BotAccount {
  id: string
  name: string
  endpoint_url: string | null
  endpoint_token: string | null
  line_mid: string | null
  line_display_name: string | null
  is_active: boolean
  health_status: BotAccountHealth
  consecutive_failures: number
  consecutive_successes: number
  daily_send_count: number
  daily_reset_at: string | null
  hourly_send_count: number
  hourly_reset_at: string | null
  last_used_at: string | null
  cooldown_until: string | null
  priority: number
  last_error: string | null
  last_error_at: string | null
  created_at: string
  updated_at: string
}

export type TriggerPhraseCategory =
  | 'general'
  | 'result'
  | 'announce'
  | 'stats'

export interface TriggerPhraseHistoryRow {
  id: string
  line_group_id: string
  phrase: string
  category: TriggerPhraseCategory | string
  used_at: string
}
