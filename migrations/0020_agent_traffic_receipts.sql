PRAGMA foreign_keys = ON;

-- One immutable receipt is the billing source of truth for one visitor
-- conversation. Transfers and requeues can change conversations.assigned_agent,
-- but they can never create a second receipt for the same conversation.
CREATE TABLE IF NOT EXISTS agent_traffic_receipts (
  conversation_id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_traffic_receipts_month
  ON agent_traffic_receipts(site_id, business_date, agent_id);

-- Existing aggregate rows are intentionally preserved because old transfers
-- cannot be reconstructed accurately. Mark currently assigned conversations as
-- already received so that a later requeue cannot count them again.
INSERT OR IGNORE INTO agent_traffic_receipts (
  conversation_id,
  site_id,
  agent_id,
  business_date,
  received_at
)
SELECT
  id,
  site_id,
  assigned_agent,
  assigned_business_date,
  COALESCE(assigned_at, updated_at, created_at, CURRENT_TIMESTAMP)
FROM conversations
WHERE assigned_agent IS NOT NULL
  AND assigned_business_date IS NOT NULL
  AND assigned_business_date <> '';

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
  INSERT OR IGNORE INTO agent_traffic_receipts (
    conversation_id,
    site_id,
    agent_id,
    business_date,
    received_at
  ) VALUES (
    NEW.id,
    NEW.site_id,
    NEW.assigned_agent,
    NEW.assigned_business_date,
    COALESCE(NEW.assigned_at, CURRENT_TIMESTAMP)
  );

  INSERT INTO agent_daily_stats (
    site_id,
    agent_id,
    business_date,
    conversation_count,
    updated_at
  )
  SELECT
    NEW.site_id,
    NEW.assigned_agent,
    NEW.assigned_business_date,
    1,
    CURRENT_TIMESTAMP
  WHERE changes() = 1
  ON CONFLICT(site_id, agent_id, business_date) DO UPDATE SET
    conversation_count = conversation_count + 1,
    updated_at = CURRENT_TIMESTAMP;

  -- Aggregates are tiny and valuable for reconciliation, so retain 400 days.
  DELETE FROM agent_daily_stats
  WHERE business_date < date(NEW.assigned_business_date, '-399 days');

  DELETE FROM agent_traffic_receipts
  WHERE business_date < date(NEW.assigned_business_date, '-399 days');
END;
