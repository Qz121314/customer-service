PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agent_quick_replies (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_quick_replies_agent
  ON agent_quick_replies(agent_id, updated_at DESC, id);

-- Count every seat that accepts a conversation, including a direct transfer.
-- Keeping this in the same statement as the assignment prevents concurrent
-- transfers from bypassing the receiving seat's daily quota.
DROP TRIGGER IF EXISTS trg_conversation_assignment_daily_stats;
CREATE TRIGGER trg_conversation_assignment_daily_stats
AFTER UPDATE OF assigned_agent ON conversations
WHEN NEW.assigned_agent IS NOT NULL
  AND (
    OLD.assigned_agent IS NULL
    OR OLD.assigned_agent <> NEW.assigned_agent
  )
  AND NEW.assigned_business_date IS NOT NULL
  AND NEW.assigned_business_date <> ''
BEGIN
  INSERT INTO agent_daily_stats (
    site_id,
    agent_id,
    business_date,
    conversation_count,
    updated_at
  ) VALUES (
    NEW.site_id,
    NEW.assigned_agent,
    NEW.assigned_business_date,
    1,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT(site_id, agent_id, business_date) DO UPDATE SET
    conversation_count = conversation_count + 1,
    updated_at = CURRENT_TIMESTAMP;

  DELETE FROM agent_daily_stats
  WHERE business_date < date(NEW.assigned_business_date, '-44 days');
END;
