PRAGMA foreign_keys = ON;

ALTER TABLE conversations ADD COLUMN last_message_preview TEXT;

UPDATE conversations
SET last_message_preview = (
  SELECT m.body
  FROM messages m
  WHERE m.conversation_id = conversations.id
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT 1
);
