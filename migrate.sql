-- ============================================
-- LottoBot — Migration Script
-- วิธีใช้: Copy ทั้งหมดไปวางใน Supabase > SQL Editor > Run
-- ปลอดภัย: ใช้ IF NOT EXISTS / DO blocks — run ซ้ำได้ไม่ error
-- ============================================

-- 1. Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Enum types (safe create with DO block)
DO $$ BEGIN
  CREATE TYPE lottery_status AS ENUM ('active', 'inactive');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE result_format AS ENUM ('3d_2d', '3d_only', '6d', 'custom');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE send_status AS ENUM ('pending', 'sending', 'sent', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE send_channel AS ENUM ('telegram', 'line');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE message_type AS ENUM ('result', 'countdown', 'stats');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Tables
CREATE TABLE IF NOT EXISTS lotteries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  flag TEXT NOT NULL DEFAULT '🎰',
  country TEXT,
  result_time TIME NOT NULL,
  close_time TIME,
  source_url TEXT,
  result_format result_format NOT NULL DEFAULT '3d_2d',
  send_stats BOOLEAN NOT NULL DEFAULT TRUE,
  countdown_minutes INTEGER NOT NULL DEFAULT 20,
  status lottery_status NOT NULL DEFAULT 'active',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lottery_id UUID NOT NULL REFERENCES lotteries(id) ON DELETE CASCADE,
  draw_date DATE NOT NULL,
  top_number TEXT,
  bottom_number TEXT,
  full_number TEXT,
  raw_data JSONB,
  source_url TEXT,
  scraped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(lottery_id, draw_date)
);

CREATE TABLE IF NOT EXISTS line_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  line_notify_token TEXT,
  member_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS send_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  result_id UUID REFERENCES results(id) ON DELETE CASCADE,
  lottery_id UUID NOT NULL REFERENCES lotteries(id),
  line_group_id UUID REFERENCES line_groups(id),
  channel send_channel NOT NULL,
  msg_type message_type NOT NULL DEFAULT 'result',
  status send_status NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scrape_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lottery_id UUID NOT NULL REFERENCES lotteries(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT TRUE,
  selector_config JSONB,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bot_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_lotteries_status ON lotteries(status);
CREATE INDEX IF NOT EXISTS idx_lotteries_time ON lotteries(result_time);
CREATE INDEX IF NOT EXISTS idx_results_lottery ON results(lottery_id, draw_date DESC);
CREATE INDEX IF NOT EXISTS idx_results_date ON results(draw_date DESC);
CREATE INDEX IF NOT EXISTS idx_send_logs_result ON send_logs(result_id);
CREATE INDEX IF NOT EXISTS idx_send_logs_lottery ON send_logs(lottery_id);
CREATE INDEX IF NOT EXISTS idx_send_logs_status ON send_logs(status);
CREATE INDEX IF NOT EXISTS idx_send_logs_date ON send_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scrape_lottery ON scrape_sources(lottery_id);

-- 5. Seed: bot_settings
INSERT INTO bot_settings (key, value, description) VALUES
  ('telegram_bot_token', '', 'Telegram Bot Token (@BotFather)'),
  ('telegram_admin_channel', '', 'Telegram Admin Channel ID (ดู log)'),
  ('n8n_webhook_url', '', 'n8n Webhook URL (TG → LINE bridge)'),
  ('line_channel_access_token', '', 'LINE Channel Access Token (fallback)'),
  ('scrape_interval_seconds', '30', 'ดึงผลทุกกี่วินาทีก่อนเวลาออก'),
  ('stats_count', '10', 'จำนวนงวดสถิติย้อนหลัง'),
  ('bot_name', 'LottoBot', 'ชื่อ Bot'),
  ('use_flex_message', 'true', 'ใช้ Flex Message สำหรับ LINE'),
  ('fallback_enabled', 'true', 'ใช้แหล่งสำรองถ้าแหล่งหลักล่ม')
ON CONFLICT (key) DO NOTHING;

-- 6. Seed: 43 lotteries
-- Use a DO block to only insert if table is empty (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM lotteries LIMIT 1) THEN
    INSERT INTO lotteries (name, flag, country, result_time, sort_order) VALUES
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
  END IF;
END $$;

-- 7. Enable RLS
ALTER TABLE lotteries ENABLE ROW LEVEL SECURITY;
ALTER TABLE results ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE send_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_settings ENABLE ROW LEVEL SECURITY;

-- 8. RLS Policies (safe create)
DO $$ BEGIN
  CREATE POLICY "auth_all" ON lotteries FOR ALL USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "auth_all" ON results FOR ALL USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "auth_all" ON line_groups FOR ALL USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "auth_all" ON send_logs FOR ALL USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "auth_all" ON scrape_sources FOR ALL USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "auth_all" ON bot_settings FOR ALL USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 9. ตรวจสอบผลลัพธ์
-- ============================================

-- เช็ค tables ครบ 6 ตาราง
SELECT table_name,
       (SELECT COUNT(*) FROM information_schema.columns c
        WHERE c.table_name = t.table_name AND c.table_schema = 'public') AS column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name IN ('lotteries', 'results', 'line_groups', 'send_logs', 'scrape_sources', 'bot_settings')
ORDER BY table_name;
-- ✅ ต้องเห็น 6 tables

-- เช็คจำนวน lotteries
SELECT COUNT(*) AS lottery_count FROM lotteries;
-- ✅ ต้องได้ 43

-- เช็ค bot_settings
SELECT COUNT(*) AS settings_count FROM bot_settings;
-- ✅ ต้องได้ 9

-- เช็ค RLS
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('lotteries', 'results', 'line_groups', 'send_logs', 'scrape_sources', 'bot_settings');
-- ✅ ทุกแถวต้องได้ rowsecurity = true
