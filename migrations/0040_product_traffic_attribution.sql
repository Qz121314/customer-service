PRAGMA foreign_keys = ON;

-- Product attribution belongs to the immutable traffic receipt. Conversations
-- expire after 24 hours, while reporting receipts remain for roughly 400 days.
-- Keeping the product snapshot here makes monthly product distribution durable
-- without another table or another write on the assignment hot path.
ALTER TABLE agent_traffic_receipts ADD COLUMN product_id TEXT;
ALTER TABLE agent_traffic_receipts ADD COLUMN product_title TEXT;

-- Recover attribution for receipts whose short-lived conversation still exists.
-- Older receipts may no longer be recoverable and intentionally remain NULL so
-- the dashboard can report them honestly as unknown traffic.
UPDATE agent_traffic_receipts
SET product_id = (
      SELECT c.product_id
      FROM conversations c
      WHERE c.id = agent_traffic_receipts.conversation_id
      LIMIT 1
    ),
    product_title = (
      SELECT c.product_title
      FROM conversations c
      WHERE c.id = agent_traffic_receipts.conversation_id
      LIMIT 1
    )
WHERE EXISTS (
  SELECT 1
  FROM conversations c
  WHERE c.id = agent_traffic_receipts.conversation_id
);

-- Reuse idx_agent_traffic_receipts_month(site_id, business_date, agent_id).
-- The product dashboard filters one site and one month, so this existing index
-- bounds the receipt scan without paying another index write per new reception.
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
    quota_consumed,
    product_id,
    product_title
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
    ), 0) = 1 THEN 0 ELSE -1 END,
    NEW.product_id,
    NEW.product_title
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
END;
