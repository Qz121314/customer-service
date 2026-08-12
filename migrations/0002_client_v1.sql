PRAGMA foreign_keys = ON;

ALTER TABLE visitors ADD COLUMN external_id TEXT;
ALTER TABLE visitors ADD COLUMN expires_at TEXT;

UPDATE visitors
SET external_id = id
WHERE external_id IS NULL;

UPDATE visitors
SET expires_at = datetime(created_at, '+1 day')
WHERE expires_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_visitors_site_external
  ON visitors(site_id, external_id);
CREATE INDEX IF NOT EXISTS idx_visitors_expires
  ON visitors(expires_at);

ALTER TABLE conversations ADD COLUMN group_id TEXT;
ALTER TABLE conversations ADD COLUMN product_id TEXT;
ALTER TABLE conversations ADD COLUMN section_id TEXT;
ALTER TABLE conversations ADD COLUMN product_title TEXT;
ALTER TABLE conversations ADD COLUMN product_cover_url TEXT;
ALTER TABLE conversations ADD COLUMN product_href TEXT;
ALTER TABLE conversations ADD COLUMN expires_at TEXT;
ALTER TABLE conversations ADD COLUMN visitor_unread_count INTEGER NOT NULL DEFAULT 0;

UPDATE conversations
SET expires_at = datetime(created_at, '+1 day')
WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_visitor_expiry
  ON conversations(site_id, visitor_id, expires_at, last_message_at DESC);

ALTER TABLE messages ADD COLUMN client_message_id TEXT;
ALTER TABLE messages ADD COLUMN read_by_visitor_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conversation_client_message
  ON messages(conversation_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS support_groups (
  site_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, id),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_support_groups_site_enabled
  ON support_groups(site_id, is_enabled, name);

INSERT OR IGNORE INTO support_groups (site_id, id, name, is_enabled)
VALUES ('default', 'general', '默认客服组', 1);
