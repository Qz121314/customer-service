PRAGMA foreign_keys = ON;

-- Read receipts are stored once per conversation. The legacy per-message
-- columns remain in place so existing rows and API payloads stay compatible.
ALTER TABLE conversations ADD COLUMN agent_read_through_at TEXT;
ALTER TABLE conversations ADD COLUMN agent_read_through_id TEXT;
ALTER TABLE conversations ADD COLUMN agent_read_at TEXT;
ALTER TABLE conversations ADD COLUMN visitor_read_through_at TEXT;
ALTER TABLE conversations ADD COLUMN visitor_read_through_id TEXT;
ALTER TABLE conversations ADD COLUMN visitor_read_at TEXT;

-- These indexes no longer serve a production query. Every message updates
-- last_message_at, so retaining them multiplies D1 writes on the hottest path.
DROP INDEX IF EXISTS idx_conversations_status_last_message;
DROP INDEX IF EXISTS idx_conversations_site_last_message;
DROP INDEX IF EXISTS idx_conversations_group_assignment;
DROP INDEX IF EXISTS idx_conversations_agent_business_date;
DROP INDEX IF EXISTS idx_conversations_business_date;
