PRAGMA foreign_keys = ON;

ALTER TABLE conversations ADD COLUMN source_handoff_id TEXT;
ALTER TABLE agent_traffic_receipts ADD COLUMN source_handoff_id TEXT;

CREATE UNIQUE INDEX idx_conversations_source_handoff
  ON conversations(source_handoff_id)
  WHERE source_handoff_id IS NOT NULL;

CREATE UNIQUE INDEX idx_agent_traffic_receipts_source_handoff
  ON agent_traffic_receipts(source_handoff_id)
  WHERE source_handoff_id IS NOT NULL;

UPDATE agent_traffic_receipts
SET source_handoff_id = (
  SELECT c.source_handoff_id
  FROM conversations c
  WHERE c.id = agent_traffic_receipts.conversation_id
)
WHERE source_handoff_id IS NULL;

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
    received_at,
    source_handoff_id
  ) VALUES (
    NEW.id,
    NEW.site_id,
    NEW.assigned_agent,
    NEW.assigned_business_date,
    COALESCE(NEW.assigned_at, CURRENT_TIMESTAMP),
    NEW.source_handoff_id
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

  DELETE FROM agent_daily_stats
  WHERE business_date < date(NEW.assigned_business_date, '-399 days');

  DELETE FROM agent_traffic_receipts
  WHERE business_date < date(NEW.assigned_business_date, '-399 days');
END;
