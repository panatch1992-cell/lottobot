-- Provider support for messaging-service abstraction
alter table if exists send_logs
  add column if not exists provider text,
  add column if not exists error_code text,
  add column if not exists attempt_no integer default 1;

create table if not exists provider_health (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  status text not null,
  error_message text,
  latency_ms integer,
  checked_at timestamptz not null default now()
);

create table if not exists dead_letter_queue (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'line',
  provider text,
  target_id text,
  payload jsonb not null,
  error_message text,
  created_at timestamptz not null default now(),
  retried_at timestamptz
);
