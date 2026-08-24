PRAGMA foreign_keys = ON;

-- Traffic reporting starts when the frontend successfully creates a new
-- conversation. It is independent of the 24-hour conversation lifecycle so
-- total starts, first-receiving agent and product distribution can reconcile
-- for the complete 90-day reporting window.
ALTER TABLE conversations
  ADD COLUMN started_business_date TEXT;

CREATE TABLE conversation_traffic_receipts (
  conversation_id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  product_id TEXT,
  product_title TEXT,
  agent_id TEXT,
  agent_name TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_conversation_traffic_receipts_date
  ON conversation_traffic_receipts(site_id, business_date);

-- Preserve all existing durable receptions. Agent and product snapshots remain
-- useful even after their short-lived conversation has already expired.
INSERT OR IGNORE INTO conversation_traffic_receipts (
  conversation_id,
  site_id,
  business_date,
  product_id,
  product_title,
  agent_id,
  agent_name,
  started_at
)
SELECT
  receipt.conversation_id,
  receipt.site_id,
  receipt.business_date,
  receipt.product_id,
  receipt.product_title,
  receipt.agent_id,
  agent.name,
  receipt.received_at
FROM agent_traffic_receipts receipt
LEFT JOIN agents agent
  ON agent.id = receipt.agent_id
 AND agent.site_id = receipt.site_id;

-- Conversations still inside the 24-hour window can also recover starts which
-- are currently waiting and therefore have no agent traffic receipt yet.
UPDATE conversations
SET started_business_date = COALESCE(
  assigned_business_date,
  date(created_at, '-8 hours')
)
WHERE started_business_date IS NULL;

INSERT OR IGNORE INTO conversation_traffic_receipts (
  conversation_id,
  site_id,
  business_date,
  product_id,
  product_title,
  agent_id,
  agent_name,
  started_at
)
SELECT
  conversation.id,
  conversation.site_id,
  conversation.started_business_date,
  conversation.product_id,
  conversation.product_title,
  conversation.assigned_agent,
  agent.name,
  conversation.created_at
FROM conversations conversation
LEFT JOIN agents agent
  ON agent.id = conversation.assigned_agent
 AND agent.site_id = conversation.site_id
WHERE conversation.started_business_date IS NOT NULL;

CREATE TRIGGER trg_conversation_start_traffic_receipt
AFTER INSERT ON conversations
WHEN NEW.started_business_date IS NOT NULL
  AND NEW.started_business_date <> ''
BEGIN
  INSERT OR IGNORE INTO conversation_traffic_receipts (
    conversation_id,
    site_id,
    business_date,
    product_id,
    product_title,
    started_at
  ) VALUES (
    NEW.id,
    NEW.site_id,
    NEW.started_business_date,
    NEW.product_id,
    NEW.product_title,
    NEW.created_at
  );
END;

-- The first immutable reception fills the agent dimension. Transfers and
-- requeues never replace it, so every started conversation belongs to at most
-- one receiving agent and the distribution remains reconcilable.
CREATE TRIGGER trg_conversation_traffic_first_agent
AFTER INSERT ON agent_traffic_receipts
BEGIN
  UPDATE conversation_traffic_receipts
  SET agent_id = NEW.agent_id,
      agent_name = (
        SELECT name
        FROM agents
        WHERE id = NEW.agent_id AND site_id = NEW.site_id
        LIMIT 1
      )
  WHERE conversation_id = NEW.conversation_id
    AND agent_id IS NULL;
END;
