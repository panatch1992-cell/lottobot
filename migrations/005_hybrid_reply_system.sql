-- ============================================
-- LottoBot — Hybrid Reply System (005)
-- ============================================
-- เพิ่มตารางและ settings สำหรับสถาปัตยกรรม Hybrid:
--   Vercel Cron → Dispatcher → pending_replies
--        → Self-bot ส่ง trigger message
--        → LINE webhook → Reply API (ฟรี ไม่จำกัด)
--
-- เป้าหมาย:
--   1. ลดภาระ self-bot (ส่งแค่ trigger text สั้น ๆ)
--   2. ใช้ LINE Reply API (ฟรี unlimited) แทน Push API
--   3. เก็บรูปเลขเด็ดใน Supabase Storage แทน runtime scrape
--   4. Rotation pool ของ LINE user accounts เพื่อกระจาย risk
-- ============================================

-- ─── 1. pending_replies ───────────────────────────────
-- Queue ของ reply ที่รอ replyToken จาก webhook
-- Dispatcher เขียนแถวนี้แล้วเรียก self-bot ส่ง trigger
-- Webhook อ่านแถวนี้แล้วเรียก Reply API
create table if not exists pending_replies (
  id uuid primary key default gen_random_uuid(),
  line_group_id uuid not null references line_groups(id) on delete cascade,
  lottery_id uuid references lotteries(id) on delete set null,
  -- intent: กลุ่มประเภท reply ที่จะส่ง
  --   announce       → Phase 1 (รายการต่อไป + สถิติ + รูปเลขเด็ด)
  --   result         → Phase 6 (ผลหวย บน/ล่าง/เต็ม)
  --   countdown_20   → Phase 2 (20 นาทีสุดท้าย — ส่งตรงไม่ต้อง reply)
  --   countdown_10   → Phase 3
  --   countdown_5    → Phase 4
  --   closing        → Phase 5 (ปิดรับ — ส่งตรง ไม่ต้อง reply)
  intent_type text not null,
  -- payload: ข้อมูลทั้งหมดที่ reply-composer ต้องการ (pre-computed)
  --   { text?: string, image_url?: string, image_caption?: string, ... }
  payload jsonb not null default '{}'::jsonb,
  -- trigger message ที่ self-bot ส่งเพื่อขอ replyToken
  trigger_text text not null,
  -- trigger phrase ที่ใช้ (สำหรับ avoid-repeat logic)
  trigger_phrase_used text,
  -- สถานะชีวิตของ row นี้
  status text not null default 'pending',
    -- pending       → รอ self-bot ส่ง trigger
    -- trigger_sent  → self-bot ส่งแล้ว รอ webhook
    -- replied       → webhook เรียก Reply API สำเร็จ
    -- expired       → หมดอายุโดยไม่มี reply
    -- failed        → trigger ส่งไม่สำเร็จ หรือ reply fail
  retry_count integer not null default 0,
  max_retries integer not null default 2,
  -- เวลา
  expires_at timestamptz not null,            -- default now() + 5 min (runtime)
  trigger_sent_at timestamptz,
  replied_at timestamptz,
  -- tracking
  webhook_event_id text,                      -- idempotency ต่อ webhook event
  reply_token_used text,                      -- replyToken ที่ใช้จริง
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

-- ─── 2. lucky_images ──────────────────────────────────
-- คลังรูปเลขเด็ดที่เก็บใน Supabase Storage (bucket: lucky-images)
-- หลีกเลี่ยง runtime scrape → ลดความเสี่ยงพังจาก huaypnk.com
create table if not exists lucky_images (
  id uuid primary key default gen_random_uuid(),
  -- ที่เก็บไฟล์ใน Supabase Storage
  storage_path text not null,                 -- เช่น 'lucky-images/laos/uuid.jpg'
  public_url text not null,                   -- Supabase public URL สำหรับ LINE fetch ตรง
  -- metadata
  category text not null default 'general',
    -- general | laos | stock | vietnam | hanoi | thai | korea | ...
  caption text,                                -- optional caption ใต้รูป
  source_url text,                             -- ถ้า sync จาก huaypnk มา → เก็บต้นทาง
  source_hash text unique,                     -- hash ของ content → กันซ้ำตอน sync
  -- usage tracking
  use_count integer not null default 0,
  last_used_at timestamptz,
  -- admin
  uploaded_by text,
  uploaded_at timestamptz not null default now(),
  is_active boolean not null default true
);

create index if not exists idx_lucky_images_active_category
  on lucky_images(is_active, category);
create index if not exists idx_lucky_images_rotation
  on lucky_images(is_active, last_used_at nulls first, use_count);

-- ─── 3. bot_accounts ──────────────────────────────────
-- Rotation pool ของ LINE user accounts ที่ใช้เป็น self-bot
-- Dispatcher จะ round-robin ตาม last_used_at + health status
create table if not exists bot_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,                          -- friendly name (เช่น 'bot-1', 'bot-2')
  -- การเชื่อมต่อ self-bot endpoint
  endpoint_url text,                           -- URL ของ self-bot instance (แต่ละ account แยก instance ได้)
  endpoint_token text,                         -- auth token สำหรับ endpoint
  -- LINE account identifiers (optional, informational)
  line_mid text,                               -- LINE member id (ถ้ารู้)
  line_display_name text,
  -- สถานะและสุขภาพ
  is_active boolean not null default true,
  health_status text not null default 'unknown',
    -- unknown | healthy | degraded | banned | cooldown
  consecutive_failures integer not null default 0,
  consecutive_successes integer not null default 0,
  -- rate limit counters (reset ทุกวัน/ชั่วโมง ใน code)
  daily_send_count integer not null default 0,
  daily_reset_at timestamptz,
  hourly_send_count integer not null default 0,
  hourly_reset_at timestamptz,
  -- scheduling
  last_used_at timestamptz,
  cooldown_until timestamptz,                  -- ถ้าเจอ ban signal → cool down จนถึงเวลานี้
  priority integer not null default 100,       -- ต่ำ = ใช้ก่อน (ให้ admin จัดลำดับได้)
  -- audit
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_bot_accounts_rotation
  on bot_accounts(is_active, cooldown_until nulls first, priority, last_used_at nulls first)
  where is_active = true;

-- ─── 4. trigger_phrase_history ────────────────────────
-- เก็บ trigger phrases ที่ใช้ไปแล้วต่อกลุ่ม เพื่อ avoid-repeat
-- (ไม่ต้องใส่ใน line_groups เพื่อให้ clean + query แยกได้)
create table if not exists trigger_phrase_history (
  id uuid primary key default gen_random_uuid(),
  line_group_id uuid not null references line_groups(id) on delete cascade,
  phrase text not null,
  category text not null default 'general',
  used_at timestamptz not null default now()
);

create index if not exists idx_trigger_phrase_history_group
  on trigger_phrase_history(line_group_id, used_at desc);

-- ─── 5. bot_settings: new keys ────────────────────────
insert into bot_settings (key, value, description) values
  -- Hybrid mode toggles
  ('hybrid_reply_enabled', 'false',
    'เปิด Hybrid Reply System (Phase 3) — replaces direct push'),
  ('pending_reply_expiry_min', '5',
    'อายุของ pending_reply (นาที) ก่อนหมดสิทธิ์'),
  ('pending_reply_max_retries', '2',
    'Retry เรียก trigger ได้กี่ครั้งก่อน mark failed'),

  -- Trigger phrase pool (JSON arrays stored as strings)
  ('trigger_phrase_pool_general',
    '["อัพเดทครับ","มาแล้วครับ","📢","🔔","เช็กผล","งวดใหม่","🎯","ดูผลกัน"]',
    'Pool ของ trigger phrase หมวด general'),
  ('trigger_phrase_pool_result',
    '["📢 ผลออกแล้ว","ผลมาครับ","🎉 ออกแล้ว","🎯 ผลมา","เช็กเลขกัน","ออกแล้วครับ"]',
    'Pool ของ trigger phrase หมวด result (ประกาศผลหวย)'),
  ('trigger_phrase_pool_announce',
    '["📢 รายการต่อไป","ต่อไป","➡️ รอบหน้า","รอบถัดไป","🕐 ถัดไป"]',
    'Pool ของ trigger phrase หมวด announce (ประกาศหวยที่จะเปิด)'),
  ('trigger_phrase_pool_stats',
    '["📋 สถิติ","🔍 ย้อนหลัง","ดูสถิติกัน","📊 ข้อมูล","ย้อนไปดู"]',
    'Pool ของ trigger phrase หมวด stats (สถิติย้อนหลัง)'),
  ('trigger_phrase_recent_window', '5',
    'กัน repeat ของ phrase ล่าสุดกี่ตัว (ต่อกลุ่ม)'),

  -- Opportunistic user webhook piggyback
  ('opportunistic_reply_enabled', 'true',
    'ถ้า real user พิมพ์ในกลุ่ม → ใช้ replyToken ของ user flush pending_replies ที่ค้าง'),

  -- Bot account rotation
  ('bot_account_rotation_enabled', 'false',
    'เปิด rotation pool ของหลาย LINE user accounts'),
  ('bot_account_auto_pause_on_error', 'true',
    'Auto-pause account ที่เจอ 401/429 spike (cooldown 30 min)'),
  ('bot_account_cooldown_min', '30',
    'ระยะเวลา cooldown (นาที) เมื่อ auto-pause'),

  -- Lucky image sync
  ('lucky_image_auto_sync_enabled', 'false',
    'Cron scrape huaypnk.com อัตโนมัติทุกสัปดาห์'),
  ('lucky_image_sync_interval_hours', '168',
    'ช่วงห่าง auto-sync lucky images (ชั่วโมง) — default 168 = สัปดาห์ละครั้ง'),
  ('lucky_image_fallback_live_scrape', 'true',
    'ถ้า lucky_images ว่าง → fallback live scrape huaypnk (10s timeout)'),

  -- Reply warm ping
  ('reply_warmup_ping_enabled', 'true',
    'Cron ping /api/events/health ทุก 3 นาที เพื่อ keep webhook warm')
on conflict (key) do nothing;

-- ─── 6. schema version ─────────────────────────────────
-- ถ้าจำเป็นจะใช้ในอนาคต — ตอนนี้เป็น informational
comment on table pending_replies is 'Hybrid Reply queue — written by dispatcher, flushed by LINE webhook';
comment on table lucky_images is 'Lucky image library in Supabase Storage — DB 100% (no runtime scrape)';
comment on table bot_accounts is 'Rotation pool of LINE user accounts used as self-bot trigger senders';
comment on table trigger_phrase_history is 'Recent trigger phrases per group (avoid-repeat window)';
