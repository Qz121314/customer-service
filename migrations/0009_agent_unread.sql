PRAGMA foreign_keys = ON;

ALTER TABLE conversations
ADD COLUMN agent_unread_count INTEGER NOT NULL DEFAULT 0
CHECK (agent_unread_count >= 0);
