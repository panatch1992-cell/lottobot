-- ============================================
-- LottoBot — Human-like Behavior Settings (006)
-- ============================================
-- Add tuning knobs for the Hybrid trigger-send humanization helpers
-- (src/lib/hybrid/humanlike.ts).
--
-- Goal: reduce LINE anti-spam signature by breaking fixed patterns
-- when the self-bot sends trigger phrases.
--
-- All values are strings for consistency with existing bot_settings.
-- ============================================

insert into bot_settings (key, value, description) values
  -- Master switch
  ('humanlike_enabled', 'true',
    'Enable humanlike behavior for trigger sends (Hybrid mode)'),

  -- Typing delay (based on message length)
  ('humanlike_typing_ms_per_char', '80',
    'Typing speed (ms per char) — ~80 = 12 chars/sec natural speed'),
  ('humanlike_typing_min_ms', '400',
    'Minimum typing duration (floor)'),
  ('humanlike_typing_max_ms', '3500',
    'Maximum typing duration (cap)'),
  ('humanlike_typing_jitter_ratio', '0.35',
    'Per-char jitter ratio (0-1) — 0.35 means ±35%'),

  -- Thinking time (before typing)
  ('humanlike_thinking_min_ms', '2000',
    'Min short thinking time (ms) — user about to type'),
  ('humanlike_thinking_max_ms', '5000',
    'Max short thinking time (ms)'),

  -- Bimodal: occasional long pause (simulates distraction)
  ('humanlike_long_pause_ratio', '0.2',
    'Ratio (0-1) of sends that get a longer pause instead of short'),
  ('humanlike_long_pause_min_ms', '5000',
    'Min long pause duration (ms)'),
  ('humanlike_long_pause_max_ms', '15000',
    'Max long pause duration (ms)'),

  -- Periodic break (simulates user walking away)
  ('humanlike_break_every_n', '15',
    'Take a long break every ~N sends (per process)'),
  ('humanlike_break_min_ms', '20000',
    'Min break duration (ms)'),
  ('humanlike_break_max_ms', '60000',
    'Max break duration (ms)'),

  -- Time-of-day awareness
  ('humanlike_night_multiplier', '1.6',
    'Delay multiplier during night hours'),
  ('humanlike_night_start_hour', '22',
    'Night start hour (Bangkok, 0-23) — 22 = 10pm'),
  ('humanlike_night_end_hour', '7',
    'Night end hour (Bangkok, 0-23) — 7 = 7am')
on conflict (key) do nothing;
