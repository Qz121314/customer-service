PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_conversations_agent_status
  ON conversations(assigned_agent, status)
  WHERE assigned_agent IS NOT NULL;
