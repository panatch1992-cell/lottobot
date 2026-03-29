-- Migration: LINE Notify → LINE Messaging API
-- LINE Notify ปิดบริการ มี.ค. 2025 → เปลี่ยนเป็น Messaging API

-- Add line_group_id column for Messaging API group targeting
ALTER TABLE line_groups ADD COLUMN IF NOT EXISTS line_group_id text;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_line_groups_group_id ON line_groups(line_group_id);
