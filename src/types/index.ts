// LottoBot — Types

export type LotteryStatus = 'active' | 'inactive'
export type ResultFormat = '3d_2d' | '3d_only' | '6d' | 'custom'
export type SendStatus = 'pending' | 'sending' | 'sent' | 'failed'
export type SendChannel = 'telegram' | 'line'
export type MessageType = 'result' | 'countdown' | 'stats'

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
