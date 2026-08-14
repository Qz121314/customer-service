PRAGMA foreign_keys = ON;

ALTER TABLE messages ADD COLUMN read_by_agent_at TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_read_state
  ON messages(conversation_id, sender_type, created_at, id);
