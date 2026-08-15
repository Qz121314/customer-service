ALTER TABLE agents ADD COLUMN daily_conversation_limit INTEGER NOT NULL DEFAULT 0;

ALTER TABLE conversations ADD COLUMN assigned_at TEXT;
ALTER TABLE conversations ADD COLUMN assigned_business_date TEXT;

UPDATE conversations
SET assigned_at = COALESCE(assigned_at, created_at),
    assigned_business_date = COALESCE(assigned_business_date, substr(created_at, 1, 10))
WHERE assigned_agent IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_agent_business_date
ON conversations(site_id, assigned_agent, assigned_business_date);

CREATE INDEX IF NOT EXISTS idx_conversations_business_date
ON conversations(site_id, assigned_business_date);
