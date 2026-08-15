CREATE TABLE IF NOT EXISTS agent_daily_stats (
  site_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  conversation_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, agent_id, business_date)
);

INSERT INTO agent_daily_stats (
  site_id,
  agent_id,
  business_date,
  conversation_count,
  updated_at
)
SELECT
  site_id,
  assigned_agent,
  assigned_business_date,
  COUNT(*),
  CURRENT_TIMESTAMP
FROM conversations
WHERE assigned_agent IS NOT NULL
  AND assigned_business_date IS NOT NULL
  AND assigned_business_date <> ''
GROUP BY site_id, assigned_agent, assigned_business_date
ON CONFLICT(site_id, agent_id, business_date) DO UPDATE SET
  conversation_count = excluded.conversation_count,
  updated_at = CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_agent_daily_stats_business_date
ON agent_daily_stats(site_id, business_date, agent_id);

DROP TRIGGER IF EXISTS trg_conversation_assignment_daily_stats;
CREATE TRIGGER trg_conversation_assignment_daily_stats
AFTER UPDATE OF assigned_agent ON conversations
WHEN OLD.assigned_agent IS NULL
  AND NEW.assigned_agent IS NOT NULL
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
