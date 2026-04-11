-- ============================================
-- LottoBot — Lottery Event System (004)
-- ============================================
-- Adds 3-layer logging (trigger_events, dispatch_jobs, delivery_logs)
-- plus idempotency_keys and circuit_breaker_state for the unified
-- LOTTERY_RESULT_READY pipeline (Web Scrape / Telegram / Manual).
-- ============================================

-- ─── 1. trigger_events ─────────────────────────────────
-- The top layer: every inbound trigger becomes one row here
-- Sources: scrape, telegram, manual, webhook (Pipedream/Make)
create table if not exists trigger_events (
  id uuid primary key default gen_random_uuid(),
  trigger_id text unique not null,              -- idempotency key from source
  event_type text not null default 'LOTTERY_RESULT_READY',
  source text not null,                         -- 'scrape' | 'telegram' | 'manual' | 'webhook'
  lottery_id uuid references lotteries(id) on delete set null,
  draw_date date not null,
  round text,                                   -- optional: งวดที่ xxx
  result_text text not null,                    -- raw text / JSON string
  result_hash text not null,                    -- sha256(lottery_id+draw_date+round+result_text)
  payload jsonb not null,                       -- full normalized payload
  status text not null default 'received',      -- received | validated | deduped | queued | dispatched | failed
  validation_errors jsonb,                      -- array of {field, message}
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_trigger_events_hash on trigger_events(result_hash);
create index if not exists idx_trigger_events_source on trigger_events(source);
create index if not exists idx_trigger_events_status on trigger_events(status);
create index if not exists idx_trigger_events_received on trigger_events(received_at desc);
create index if not exists idx_trigger_events_lottery_date on trigger_events(lottery_id, draw_date);

-- ─── 2. dispatch_jobs ──────────────────────────────────
-- The middle layer: a trigger → one dispatch job (or more if fan-out)
-- A job is the thing we actually send through the messaging pipeline
create table if not exists dispatch_jobs (
  id uuid primary key default gen_random_uuid(),
  trigger_event_id uuid not null references trigger_events(id) on delete cascade,
  trigger_id text not null,                     -- denormalized for quick lookup
  lottery_id uuid references lotteries(id) on delete set null,
  status text not null default 'queued',        -- queued | preflight | dispatching | succeeded | failed | dead_letter | skipped
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
create index if not exists idx_dispatch_jobs_next_attempt on dispatch_jobs(next_attempt_at)
  where status in ('queued', 'failed');

-- ─── 3. delivery_logs ──────────────────────────────────
-- The bottom layer: one row per target per attempt
-- Separate from send_logs so the old bot keeps working unchanged
create table if not exists delivery_logs (
  id uuid primary key default gen_random_uuid(),
  dispatch_job_id uuid not null references dispatch_jobs(id) on delete cascade,
  trigger_id text not null,
  target_type text not null,                    -- 'line_group' | 'telegram_chat' | 'broadcast'
  target_id text not null,
  target_name text,
  provider text,                                -- 'unofficial_line' | 'official_line' | 'telegram'
  attempt_no integer not null default 1,
  status text not null,                         -- 'sent' | 'failed' | 'skipped' | 'retry'
  http_status integer,
  latency_ms integer,
  error_message text,
  error_code text,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_delivery_logs_job on delivery_logs(dispatch_job_id);
create index if not exists idx_delivery_logs_status on delivery_logs(status);
create index if not exists idx_delivery_logs_trigger on delivery_logs(trigger_id);
create index if not exists idx_delivery_logs_sent on delivery_logs(sent_at desc);

-- ─── 4. idempotency_keys ───────────────────────────────
-- Dedupe store: key = source + draw_date + round + result_hash
-- 48h TTL window (longer than any cron cycle)
create table if not exists idempotency_keys (
  key text primary key,
  trigger_id text not null,
  first_seen_at timestamptz not null default now(),
  seen_count integer not null default 1,
  last_seen_at timestamptz not null default now()
);

create index if not exists idx_idempotency_first_seen on idempotency_keys(first_seen_at desc);

-- ─── 5. circuit_breaker_state ──────────────────────────
-- Single-row per breaker_name, tracks consecutive failures + state
create table if not exists circuit_breaker_state (
  breaker_name text primary key,                -- e.g. 'lottery_dispatch' | 'unofficial_line'
  state text not null default 'closed',         -- closed | open | half_open
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

-- ─── 6. alerts ────────────────────────────────────────
-- Record of alert conditions we've fired (dedupe: once per key per hour)
create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  alert_key text not null,                      -- e.g. 'breaker_open:lottery_dispatch'
  severity text not null default 'warn',        -- info | warn | error | critical
  title text not null,
  detail text,
  metadata jsonb,
  fired_at timestamptz not null default now()
);

create index if not exists idx_alerts_key_fired on alerts(alert_key, fired_at desc);

-- ─── 7. bot_settings: new keys ─────────────────────────
-- Values are strings so they fit existing bot_settings shape
insert into bot_settings (key, value, description) values
  ('event_pipeline_enabled', 'true', 'เปิด/ปิด LOTTERY_RESULT_READY pipeline'),
  ('event_canary_enabled', 'false', 'Canary mode: ส่งเฉพาะกลุ่มทดสอบก่อน'),
  ('event_canary_group', '', 'ชื่อกลุ่ม canary (ตรวจก่อนขยาย)'),
  ('event_batch_size', '5', 'ขนาด batch ต่อรอบของ dispatcher'),
  ('event_batch_delay_ms', '500', 'Delay ระหว่างข้อความ (ms) — กันโดน rate limit'),
  ('event_batch_jitter_ms', '500', 'Jitter เพิ่มแบบสุ่ม (ms)'),
  ('event_max_concurrency', '1', 'Concurrency ของ dispatcher (ต่ำไว้กันโดนแบน)'),
  ('event_max_attempts', '3', 'Retry กี่ครั้งก่อนเข้า dead-letter'),
  ('event_retry_base_ms', '2000', 'Base delay สำหรับ exponential backoff'),
  ('event_breaker_threshold', '5', 'Fail ต่อเนื่องกี่ครั้งก่อน open breaker'),
  ('event_breaker_cooldown_sec', '120', 'Cooldown ก่อนให้ลอง half-open'),
  ('event_alert_rate_limit_minutes', '10', 'Suppress alert ซ้ำในกี่นาที')
on conflict (key) do nothing;
