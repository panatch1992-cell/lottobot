-- Add unofficial_group_id column to line_groups
-- Official LINE API uses group IDs starting with 'Ca...'
-- Unofficial (linepy) uses group IDs starting with 'c...'
-- Both are needed for dual-provider fallback support

ALTER TABLE line_groups ADD COLUMN IF NOT EXISTS unofficial_group_id TEXT;

COMMENT ON COLUMN line_groups.unofficial_group_id IS 'Group ID for unofficial LINE bot (linepy, starts with c...)';
