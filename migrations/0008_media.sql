PRAGMA foreign_keys = ON;

ALTER TABLE messages
ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'
CHECK (kind IN ('text', 'image'));

CREATE TABLE IF NOT EXISTS media_items (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT,
  reserved_message_id TEXT NOT NULL UNIQUE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('visitor', 'agent')),
  sender_id TEXT,
  object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  width INTEGER,
  height INTEGER,
  original_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'failed')),
  reserved_created_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_media_items_conversation
  ON media_items(conversation_id, status, reserved_created_at ASC);
CREATE INDEX IF NOT EXISTS idx_media_items_message
  ON media_items(message_id);
