-- ============================================
-- LottoBot — Row Level Security (RLS) Policies
-- วิธีใช้: Run ใน Supabase SQL Editor เมื่อพร้อม production
-- ============================================

-- Enable RLS ทุกตาราง
ALTER TABLE lotteries ENABLE ROW LEVEL SECURITY;
ALTER TABLE results ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE send_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_settings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies (safe)
DROP POLICY IF EXISTS "auth_all" ON lotteries;
DROP POLICY IF EXISTS "auth_all" ON results;
DROP POLICY IF EXISTS "auth_all" ON line_groups;
DROP POLICY IF EXISTS "auth_all" ON send_logs;
DROP POLICY IF EXISTS "auth_all" ON scrape_sources;
DROP POLICY IF EXISTS "auth_all" ON bot_settings;

DROP POLICY IF EXISTS "auth_read" ON lotteries;
DROP POLICY IF EXISTS "auth_write" ON lotteries;

-- ============================================
-- Lotteries — Admin อ่าน/เขียนได้ทั้งหมด
-- ============================================
CREATE POLICY "auth_select" ON lotteries FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_insert" ON lotteries FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "auth_update" ON lotteries FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "auth_delete" ON lotteries FOR DELETE USING (auth.role() = 'authenticated');

-- ============================================
-- Results — Admin อ่าน/เขียนได้
-- ============================================
CREATE POLICY "auth_select" ON results FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_insert" ON results FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "auth_update" ON results FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "auth_delete" ON results FOR DELETE USING (auth.role() = 'authenticated');

-- ============================================
-- LINE Groups — Admin จัดการได้
-- ============================================
CREATE POLICY "auth_select" ON line_groups FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_insert" ON line_groups FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "auth_update" ON line_groups FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "auth_delete" ON line_groups FOR DELETE USING (auth.role() = 'authenticated');

-- ============================================
-- Send Logs — Admin อ่านได้ / ระบบเขียนได้
-- ============================================
CREATE POLICY "auth_select" ON send_logs FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_insert" ON send_logs FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ============================================
-- Scrape Sources — Admin จัดการได้
-- ============================================
CREATE POLICY "auth_select" ON scrape_sources FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_insert" ON scrape_sources FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "auth_update" ON scrape_sources FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "auth_delete" ON scrape_sources FOR DELETE USING (auth.role() = 'authenticated');

-- ============================================
-- Bot Settings — Admin อ่าน/แก้ไขได้ (ห้ามลบ/เพิ่ม)
-- ============================================
CREATE POLICY "auth_select" ON bot_settings FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_update" ON bot_settings FOR UPDATE USING (auth.role() = 'authenticated');

-- ============================================
-- ตรวจสอบ
-- ============================================
SELECT tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd;
