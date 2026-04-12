-- ============================================
-- LottoBot — ระบบส่งผลหวยอัตโนมัติ
-- MF-2026011 | Supabase PostgreSQL
-- Flow: Web Scraping → Telegram → n8n → LINE
-- ============================================

create extension if not exists "uuid-ossp";

-- 1. Enum types
create type lottery_status as enum ('active', 'inactive');
create type result_format as enum ('3d_2d', '3d_only', '6d', 'custom');
create type send_status as enum ('pending', 'sending', 'sent', 'failed');
create type send_channel as enum ('telegram', 'line');
create type message_type as enum ('result', 'countdown', 'stats');

-- ============================================
-- 2. Lotteries (43 รายการหวย)
-- ============================================
create table lotteries (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  flag text not null default '🎰',
  country text,
  result_time time not null,
  close_time time,
  source_url text,
  result_format result_format not null default '3d_2d',
  send_stats boolean not null default true,
  countdown_minutes integer not null default 20,
  status lottery_status not null default 'active',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- 3. Results (ผลหวยแต่ละงวด)
-- ============================================
create table results (
  id uuid primary key default uuid_generate_v4(),
  lottery_id uuid not null references lotteries(id) on delete cascade,
  draw_date date not null,
  top_number text,
  bottom_number text,
  full_number text,
  raw_data jsonb,
  source_url text,
  scraped_at timestamptz,
  created_at timestamptz not null default now(),
  unique(lottery_id, draw_date)
);

-- ============================================
-- 4. LINE Groups (กลุ่ม LINE ปลายทาง)
-- ============================================
create table line_groups (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  line_notify_token text,
  line_group_id text,
  member_count integer not null default 0,
  is_active boolean not null default true,
  custom_link text,
  custom_message text,
  send_all_lotteries boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- 4.5 Group-Lottery Mapping (กลุ่มไหนรับหวยไหน)
-- ============================================
create table group_lotteries (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references line_groups(id) on delete cascade,
  lottery_id uuid not null references lotteries(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(group_id, lottery_id)
);

-- ============================================
-- 5. Send Logs (ประวัติการส่ง — ทั้ง TG + LINE)
-- ============================================
create table send_logs (
  id uuid primary key default uuid_generate_v4(),
  result_id uuid references results(id) on delete cascade,
  lottery_id uuid not null references lotteries(id),
  line_group_id uuid references line_groups(id),
  channel send_channel not null,
  msg_type message_type not null default 'result',
  status send_status not null default 'pending',
  sent_at timestamptz,
  duration_ms integer,
  error_message text,
  created_at timestamptz not null default now()
);

-- ============================================
-- 6. Scrape Sources (แหล่งดึงผล หลัก/สำรอง)
-- ============================================
create table scrape_sources (
  id uuid primary key default uuid_generate_v4(),
  lottery_id uuid not null references lotteries(id) on delete cascade,
  url text not null,
  is_primary boolean not null default true,
  selector_config jsonb,
  is_active boolean not null default true,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

-- ============================================
-- 7. Bot Settings
-- ============================================
create table bot_settings (
  id uuid primary key default uuid_generate_v4(),
  key text unique not null,
  value text not null,
  description text,
  updated_at timestamptz not null default now()
);

insert into bot_settings (key, value, description) values
  ('telegram_bot_token', '', 'Telegram Bot Token (@BotFather)'),
  ('telegram_admin_channel', '', 'Telegram Admin Channel ID (ดู log)'),
  ('n8n_webhook_url', '', 'n8n Webhook URL (TG → LINE bridge)'),
  ('line_channel_access_token', '', 'LINE Channel Access Token (fallback)'),
  ('scrape_interval_seconds', '30', 'ดึงผลทุกกี่วินาทีก่อนเวลาออก'),
  ('stats_count', '10', 'จำนวนงวดสถิติย้อนหลัง'),
  ('bot_name', 'LottoBot', 'ชื่อ Bot'),
  ('use_flex_message', 'true', 'ใช้ Flex Message สำหรับ LINE'),
  ('fallback_enabled', 'true', 'ใช้แหล่งสำรองถ้าแหล่งหลักล่ม'),
  ('scrape_window_minutes', '30', 'หน้าต่างเวลาดึงผลหลังเวลาออก (นาที)'),
  ('scrape_max_retries', '3', 'จำนวนครั้งที่ retry ดึงผล'),
  ('scrape_retry_delay_ms', '10000', 'หน่วงเวลาระหว่าง retry (ms)'),
  ('default_theme', 'shopee', 'ธีมรูปตัวเลข (macaroon/candy/ocean/gold/dark/shopee)'),
  ('default_font_style', 'rounded', 'สไตล์ตัวเลข (rounded/sharp/outline)'),
  ('default_digit_size', 'm', 'ขนาดตัวเลข (s/m/l)'),
  ('default_layout', 'inline', 'เรียงตัวเลข (inline/horizontal/vertical)'),
  ('countdown_intervals', '5', 'แจ้งเตือนก่อนปิดรับ (นาที คั่นด้วยคอมมา) — ใช้ 5 ประหยัด LINE limit');

-- ============================================
-- 8. Seed: 43 รายการหวย (จากลูกค้า)
-- ============================================
insert into lotteries (name, flag, country, result_time, sort_order) values
  ('นิเคอิเช้า VIP', '🇯🇵', 'ญี่ปุ่น', '10:30', 1),
  ('นิเคอิเช้า ปกติ', '🇯🇵', 'ญี่ปุ่น', '10:30', 2),
  ('จีนเช้า VIP', '🇨🇳', 'จีน', '11:00', 3),
  ('ลาว TV', '🇱🇦', 'ลาว', '11:30', 4),
  ('จีนเช้าปกติ', '🇨🇳', 'จีน', '11:00', 5),
  ('ฮั่งเส็งเช้าปกติ', '🇭🇰', 'ฮ่องกง', '12:00', 6),
  ('ฮานอย HD', '🇻🇳', 'เวียดนาม', '12:00', 7),
  ('ไต้หวัน VIP', '🇹🇼', 'ไต้หวัน', '12:30', 8),
  ('ไต้หวันปกติ', '🇹🇼', 'ไต้หวัน', '12:30', 9),
  ('ฮานอยสตาร์', '🇻🇳', 'เวียดนาม', '12:30', 10),
  ('เกาหลี VIP', '🇰🇷', 'เกาหลี', '13:00', 11),
  ('เกาหลีปกติ', '🇰🇷', 'เกาหลี', '13:00', 12),
  ('นิเคอิบ่ายปกติ', '🇯🇵', 'ญี่ปุ่น', '13:25', 13),
  ('ลาว HD', '🇱🇦', 'ลาว', '13:30', 14),
  ('จีนบ่ายปกติ', '🇨🇳', 'จีน', '14:00', 15),
  ('ฮานอย TV', '🇻🇳', 'เวียดนาม', '14:15', 16),
  ('จีนบ่าย VIP', '🇨🇳', 'จีน', '14:20', 17),
  ('ลาวสตาร์', '🇱🇦', 'ลาว', '14:30', 18),
  ('ฮั่งเส็งบ่าย', '🇭🇰', 'ฮ่องกง', '15:00', 19),
  ('ฮั่งเส็งบ่าย VIP', '🇭🇰', 'ฮ่องกง', '15:00', 20),
  ('ลาวสตาร์', '🇱🇦', 'ลาว', '15:30', 21),
  ('สิงคโปร์', '🇸🇬', 'สิงคโปร์', '16:00', 22),
  ('หุ้นไทยเย็น', '🇹🇭', 'ไทย', '16:30', 23),
  ('ฮานอยกาชาด', '🇻🇳', 'เวียดนาม', '17:00', 24),
  ('ฮานอยพิเศษ', '🇻🇳', 'เวียดนาม', '18:10', 25),
  ('ฮานอยสามัคคี', '🇻🇳', 'เวียดนาม', '18:20', 26),
  ('หุ้นอินเดีย', '🇮🇳', 'อินเดีย', '18:30', 27),
  ('ฮานอยปกติ', '🇻🇳', 'เวียดนาม', '18:30', 28),
  ('ฮานอย VIP', '🇻🇳', 'เวียดนาม', '18:30', 29),
  ('ฮานอยพัฒนา', '🇻🇳', 'เวียดนาม', '18:45', 30),
  ('ลาวสามัคคี', '🇱🇦', 'ลาว', '19:00', 31),
  ('ลาวพัฒนา', '🇱🇦', 'ลาว', '20:00', 32),
  ('ลาว VIP', '🇱🇦', 'ลาว', '20:30', 33),
  ('ลาวสามัคคี', '🇱🇦', 'ลาว', '20:30', 34),
  ('ลาวสตาร์ VIP', '🇱🇦', 'ลาว', '21:00', 35),
  ('รัสเซีย', '🇷🇺', 'รัสเซีย', '21:30', 36),
  ('ฮานอย Extra', '🇻🇳', 'เวียดนาม', '22:00', 37),
  ('อังกฤษ', '🇬🇧', 'อังกฤษ', '22:00', 38),
  ('เยอรมัน', '🇩🇪', 'เยอรมัน', '22:00', 39),
  ('ลาวกาชาด', '🇱🇦', 'ลาว', '22:30', 40),
  ('ดาวโจนส์ VIP', '🇺🇸', 'อเมริกา', '23:00', 41),
  ('ดาวโจนส์ปกติ', '🇺🇸', 'อเมริกา', '23:00', 42),
  ('ดาวโจนส์ Star', '🇺🇸', 'อเมริกา', '23:30', 43);

-- ============================================
-- 8.5 Scheduled Messages (ตั้งเวลาส่งข้อความ)
-- ============================================
create table scheduled_messages (
  id uuid primary key default uuid_generate_v4(),
  message text not null,
  send_time time not null,
  repeat_days text not null default 'daily',
  target text not null default 'both',
  is_active boolean not null default true,
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table scheduled_messages enable row level security;
create policy "auth_all" on scheduled_messages for all using (auth.role() = 'authenticated');

-- ============================================
-- 9. Indexes
-- ============================================
create index idx_lotteries_status on lotteries(status);
create index idx_lotteries_time on lotteries(result_time);
create index idx_results_lottery on results(lottery_id, draw_date desc);
create index idx_results_date on results(draw_date desc);
create index idx_send_logs_result on send_logs(result_id);
create index idx_send_logs_lottery on send_logs(lottery_id);
create index idx_send_logs_status on send_logs(status);
create index idx_send_logs_date on send_logs(created_at desc);
create index idx_scrape_lottery on scrape_sources(lottery_id);

-- ============================================
-- 10. RLS (Bot ใช้ service_role, Dashboard ใช้ auth)
-- ============================================
alter table lotteries enable row level security;
alter table results enable row level security;
alter table line_groups enable row level security;
alter table send_logs enable row level security;
alter table scrape_sources enable row level security;
alter table bot_settings enable row level security;

create policy "auth_all" on lotteries for all using (auth.role() = 'authenticated');
create policy "auth_all" on results for all using (auth.role() = 'authenticated');
create policy "auth_all" on line_groups for all using (auth.role() = 'authenticated');
create policy "auth_all" on send_logs for all using (auth.role() = 'authenticated');
create policy "auth_all" on scrape_sources for all using (auth.role() = 'authenticated');
create policy "auth_all" on bot_settings for all using (auth.role() = 'authenticated');

-- ============================================
-- 11. Lottery Event System (LOTTERY_RESULT_READY pipeline)
--     See migrations/004_lottery_event_system.sql for the migration version
-- ============================================
create table if not exists trigger_events (
  id uuid primary key default uuid_generate_v4(),
  trigger_id text unique not null,
  event_type text not null default 'LOTTERY_RESULT_READY',
  source text not null,
  lottery_id uuid references lotteries(id) on delete set null,
  draw_date date not null,
  round text,
  result_text text not null,
  result_hash text not null,
  payload jsonb not null,
  status text not null default 'received',
  validation_errors jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_trigger_events_hash on trigger_events(result_hash);
create index if not exists idx_trigger_events_source on trigger_events(source);
create index if not exists idx_trigger_events_status on trigger_events(status);
create index if not exists idx_trigger_events_received on trigger_events(received_at desc);

create table if not exists dispatch_jobs (
  id uuid primary key default uuid_generate_v4(),
  trigger_event_id uuid not null references trigger_events(id) on delete cascade,
  trigger_id text not null,
  lottery_id uuid references lotteries(id) on delete set null,
  status text not null default 'queued',
  attempt_no integer not null default 0,
  max_attempts integer not null default 3,
  next_attempt_at timestamptz,
  last_error text,
  last_error_code text,
  preflight_passed boolean,
  preflight_detail jsonb,
  dispatched_at timestamptz,
  completed_at timestamptz,
  total_targets integer,
  succeeded_targets integer not null default 0,
  failed_targets integer not null default 0,
  canary boolean not null default false,
  canary_group text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_dispatch_jobs_status on dispatch_jobs(status);
create index if not exists idx_dispatch_jobs_trigger on dispatch_jobs(trigger_event_id);

create table if not exists delivery_logs (
  id uuid primary key default uuid_generate_v4(),
  dispatch_job_id uuid not null references dispatch_jobs(id) on delete cascade,
  trigger_id text not null,
  target_type text not null,
  target_id text not null,
  target_name text,
  provider text,
  attempt_no integer not null default 1,
  status text not null,
  http_status integer,
  latency_ms integer,
  error_message text,
  error_code text,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_delivery_logs_job on delivery_logs(dispatch_job_id);
create index if not exists idx_delivery_logs_status on delivery_logs(status);
create index if not exists idx_delivery_logs_sent on delivery_logs(sent_at desc);

create table if not exists idempotency_keys (
  key text primary key,
  trigger_id text not null,
  first_seen_at timestamptz not null default now(),
  seen_count integer not null default 1,
  last_seen_at timestamptz not null default now()
);

create table if not exists circuit_breaker_state (
  breaker_name text primary key,
  state text not null default 'closed',
  consecutive_failures integer not null default 0,
  consecutive_successes integer not null default 0,
  failure_threshold integer not null default 5,
  cooldown_seconds integer not null default 120,
  opened_at timestamptz,
  last_failure_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

insert into circuit_breaker_state (breaker_name, state, failure_threshold, cooldown_seconds)
values ('lottery_dispatch', 'closed', 5, 120)
on conflict (breaker_name) do nothing;

create table if not exists alerts (
  id uuid primary key default uuid_generate_v4(),
  alert_key text not null,
  severity text not null default 'warn',
  title text not null,
  detail text,
  metadata jsonb,
  fired_at timestamptz not null default now()
);

create index if not exists idx_alerts_key_fired on alerts(alert_key, fired_at desc);

insert into bot_settings (key, value, description) values
  ('event_pipeline_enabled', 'true', 'เปิด/ปิด LOTTERY_RESULT_READY pipeline'),
  ('event_canary_enabled', 'false', 'Canary mode: ส่งเฉพาะกลุ่มทดสอบก่อน'),
  ('event_canary_group', '', 'ชื่อกลุ่ม canary (ตรวจก่อนขยาย)'),
  ('event_batch_size', '5', 'ขนาด batch ต่อรอบของ dispatcher'),
  ('event_batch_delay_ms', '500', 'Delay ระหว่างข้อความ (ms)'),
  ('event_batch_jitter_ms', '500', 'Jitter เพิ่มแบบสุ่ม (ms)'),
  ('event_max_concurrency', '1', 'Concurrency ของ dispatcher'),
  ('event_max_attempts', '3', 'Retry กี่ครั้งก่อนเข้า dead-letter'),
  ('event_retry_base_ms', '2000', 'Base delay สำหรับ exponential backoff'),
  ('event_breaker_threshold', '5', 'Fail ต่อเนื่องกี่ครั้งก่อน open breaker'),
  ('event_breaker_cooldown_sec', '120', 'Cooldown ก่อนให้ลอง half-open'),
  ('event_alert_rate_limit_minutes', '10', 'Suppress alert ซ้ำในกี่นาที')
on conflict (key) do nothing;

-- ─── Hybrid Reply System (migration 005) ────────────
create table if not exists pending_replies (
  id uuid primary key default uuid_generate_v4(),
  line_group_id uuid not null references line_groups(id) on delete cascade,
  lottery_id uuid references lotteries(id) on delete set null,
  intent_type text not null,
  payload jsonb not null default '{}'::jsonb,
  trigger_text text not null,
  trigger_phrase_used text,
  status text not null default 'pending',
  retry_count integer not null default 0,
  max_retries integer not null default 2,
  expires_at timestamptz not null,
  trigger_sent_at timestamptz,
  replied_at timestamptz,
  webhook_event_id text,
  reply_token_used text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_pending_replies_lookup
  on pending_replies(line_group_id, status, created_at);
create index if not exists idx_pending_replies_expires
  on pending_replies(expires_at) where status in ('pending', 'trigger_sent');
create index if not exists idx_pending_replies_lottery
  on pending_replies(lottery_id, intent_type, created_at desc);

create table if not exists lucky_images (
  id uuid primary key default uuid_generate_v4(),
  storage_path text not null,
  public_url text not null,
  category text not null default 'general',
  caption text,
  source_url text,
  source_hash text unique,
  use_count integer not null default 0,
  last_used_at timestamptz,
  uploaded_by text,
  uploaded_at timestamptz not null default now(),
  is_active boolean not null default true
);
create index if not exists idx_lucky_images_active_category
  on lucky_images(is_active, category);
create index if not exists idx_lucky_images_rotation
  on lucky_images(is_active, last_used_at nulls first, use_count);

create table if not exists bot_accounts (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  endpoint_url text,
  endpoint_token text,
  line_mid text,
  line_display_name text,
  is_active boolean not null default true,
  health_status text not null default 'unknown',
  consecutive_failures integer not null default 0,
  consecutive_successes integer not null default 0,
  daily_send_count integer not null default 0,
  daily_reset_at timestamptz,
  hourly_send_count integer not null default 0,
  hourly_reset_at timestamptz,
  last_used_at timestamptz,
  cooldown_until timestamptz,
  priority integer not null default 100,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_bot_accounts_rotation
  on bot_accounts(is_active, cooldown_until nulls first, priority, last_used_at nulls first)
  where is_active = true;

create table if not exists trigger_phrase_history (
  id uuid primary key default uuid_generate_v4(),
  line_group_id uuid not null references line_groups(id) on delete cascade,
  phrase text not null,
  category text not null default 'general',
  used_at timestamptz not null default now()
);
create index if not exists idx_trigger_phrase_history_group
  on trigger_phrase_history(line_group_id, used_at desc);

insert into bot_settings (key, value, description) values
  ('hybrid_reply_enabled', 'false', 'เปิด Hybrid Reply System (Phase 3)'),
  ('pending_reply_expiry_min', '5', 'อายุของ pending_reply (นาที)'),
  ('pending_reply_max_retries', '2', 'Retry trigger ได้กี่ครั้ง'),
  ('trigger_phrase_pool_general',
    '["อัพเดทครับ","มาแล้วครับ","📢","🔔","เช็กผล","งวดใหม่","🎯","ดูผลกัน"]',
    'Pool trigger phrase general'),
  ('trigger_phrase_pool_result',
    '["📢 ผลออกแล้ว","ผลมาครับ","🎉 ออกแล้ว","🎯 ผลมา","เช็กเลขกัน","ออกแล้วครับ"]',
    'Pool trigger phrase result'),
  ('trigger_phrase_pool_announce',
    '["📢 รายการต่อไป","ต่อไป","➡️ รอบหน้า","รอบถัดไป","🕐 ถัดไป"]',
    'Pool trigger phrase announce'),
  ('trigger_phrase_pool_stats',
    '["📋 สถิติ","🔍 ย้อนหลัง","ดูสถิติกัน","📊 ข้อมูล","ย้อนไปดู"]',
    'Pool trigger phrase stats'),
  ('trigger_phrase_recent_window', '5', 'กัน repeat ของ phrase ล่าสุด'),
  ('opportunistic_reply_enabled', 'true',
    'Real user พิมพ์ → ใช้ replyToken flush pending_replies'),
  ('bot_account_rotation_enabled', 'false',
    'Rotation pool ของหลาย LINE user accounts'),
  ('bot_account_auto_pause_on_error', 'true',
    'Auto-pause ที่เจอ 401/429 spike'),
  ('bot_account_cooldown_min', '30', 'Cooldown (นาที) เมื่อ auto-pause'),
  ('lucky_image_auto_sync_enabled', 'false',
    'Cron scrape huaypnk อัตโนมัติ'),
  ('lucky_image_sync_interval_hours', '168',
    'ช่วงห่าง auto-sync lucky images'),
  ('lucky_image_fallback_live_scrape', 'true',
    'Fallback live scrape ถ้า library ว่าง'),
  ('reply_warmup_ping_enabled', 'true',
    'Cron ping webhook ทุก 3 นาที เพื่อ warm'),

  -- Humanlike behavior (migration 006)
  ('humanlike_enabled', 'true', 'Enable humanlike trigger-send delays'),
  ('humanlike_typing_ms_per_char', '80', 'Typing speed (ms per char)'),
  ('humanlike_typing_min_ms', '400', 'Min typing duration'),
  ('humanlike_typing_max_ms', '3500', 'Max typing duration'),
  ('humanlike_typing_jitter_ratio', '0.35', 'Per-char jitter ratio'),
  ('humanlike_thinking_min_ms', '2000', 'Min short thinking time'),
  ('humanlike_thinking_max_ms', '5000', 'Max short thinking time'),
  ('humanlike_long_pause_ratio', '0.2', 'Ratio of sends that get a longer pause'),
  ('humanlike_long_pause_min_ms', '5000', 'Min long pause duration'),
  ('humanlike_long_pause_max_ms', '15000', 'Max long pause duration'),
  ('humanlike_break_every_n', '15', 'Long break every N sends'),
  ('humanlike_break_min_ms', '20000', 'Min break duration'),
  ('humanlike_break_max_ms', '60000', 'Max break duration'),
  ('humanlike_night_multiplier', '1.6', 'Delay multiplier at night'),
  ('humanlike_night_start_hour', '22', 'Night start hour (BKK)'),
  ('humanlike_night_end_hour', '7', 'Night end hour (BKK)')
on conflict (key) do nothing;
