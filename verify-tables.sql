-- ============================================
-- LottoBot — Verify Tables Script
-- วิธีใช้: Copy ไปวางใน Supabase > SQL Editor > Run
-- ============================================

-- 1. เช็คว่ามีครบ 6 ตาราง
SELECT '📊 Tables' AS check_type;
SELECT table_name,
       (SELECT COUNT(*) FROM information_schema.columns c
        WHERE c.table_name = t.table_name AND c.table_schema = 'public') AS columns
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name IN ('lotteries', 'results', 'line_groups', 'send_logs', 'scrape_sources', 'bot_settings')
ORDER BY table_name;

-- 2. เช็คข้อมูล seed
SELECT '📊 Seed Data' AS check_type;
SELECT 'lotteries' AS tbl, COUNT(*) AS rows FROM lotteries
UNION ALL SELECT 'bot_settings', COUNT(*) FROM bot_settings
UNION ALL SELECT 'line_groups', COUNT(*) FROM line_groups
UNION ALL SELECT 'results', COUNT(*) FROM results
UNION ALL SELECT 'send_logs', COUNT(*) FROM send_logs
UNION ALL SELECT 'scrape_sources', COUNT(*) FROM scrape_sources;

-- 3. เช็ค RLS
SELECT '🔒 RLS Status' AS check_type;
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('lotteries', 'results', 'line_groups', 'send_logs', 'scrape_sources', 'bot_settings')
ORDER BY tablename;

-- 4. เช็ค Indexes
SELECT '📑 Indexes' AS check_type;
SELECT indexname, tablename FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('lotteries', 'results', 'line_groups', 'send_logs', 'scrape_sources', 'bot_settings')
ORDER BY tablename, indexname;
