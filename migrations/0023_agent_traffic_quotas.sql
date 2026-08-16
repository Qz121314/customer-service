PRAGMA foreign_keys = ON;

ALTER TABLE agents ADD COLUMN traffic_quota_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (traffic_quota_enabled IN (0, 1));
ALTER TABLE agents ADD COLUMN traffic_quota_total INTEGER NOT NULL DEFAULT 0
  CHECK (traffic_quota_total >= 0);
ALTER TABLE agents ADD COLUMN traffic_quota_used INTEGER NOT NULL DEFAULT 0
  CHECK (traffic_quota_used >= 0);

-- -1: this receipt was created while quota control was disabled
--  0: quota increment is pending in the current assignment transaction
--  1: the seat quota was incremented for this receipt
ALTER TABLE agent_traffic_receipts ADD COLUMN quota_consumed INTEGER NOT NULL DEFAULT -1
  CHECK (quota_consumed IN (-1, 0, 1));

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
    source_handoff_id,
    quota_consumed
  ) VALUES (
    NEW.id,
    NEW.site_id,
    NEW.assigned_agent,
    NEW.assigned_business_date,
    COALESCE(NEW.assigned_at, CURRENT_TIMESTAMP),
    NEW.source_handoff_id,
    CASE WHEN COALESCE((
      SELECT traffic_quota_enabled
      FROM agents
      WHERE id = NEW.assigned_agent AND site_id = NEW.site_id
      LIMIT 1
    ), 0) = 1 THEN 0 ELSE -1 END
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

  UPDATE agents
  SET traffic_quota_used = traffic_quota_used + 1,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.assigned_agent
    AND site_id = NEW.site_id
    AND traffic_quota_enabled = 1
    AND EXISTS (
      SELECT 1
      FROM agent_traffic_receipts receipt
      WHERE receipt.conversation_id = NEW.id
        AND receipt.agent_id = NEW.assigned_agent
        AND receipt.quota_consumed = 0
    );

  UPDATE agent_traffic_receipts
  SET quota_consumed = 1
  WHERE conversation_id = NEW.id
    AND agent_id = NEW.assigned_agent
    AND quota_consumed = 0;

  DELETE FROM agent_daily_stats
  WHERE business_date < date(NEW.assigned_business_date, '-399 days');

  DELETE FROM agent_traffic_receipts
  WHERE business_date < date(NEW.assigned_business_date, '-399 days');
END;
