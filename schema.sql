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
  ('default_layout', 'horizontal', 'เรียงตัวเลข (horizontal/vertical)'),
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
