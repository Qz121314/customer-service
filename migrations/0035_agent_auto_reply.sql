PRAGMA foreign_keys = ON;

ALTER TABLE agents
  ADD COLUMN auto_greeting_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (auto_greeting_enabled IN (0, 1));

ALTER TABLE agents
  ADD COLUMN auto_greeting_text TEXT;

-- Conversation automations are resolved once per conversation and automation key.
-- The receipt is written even when an automation is disabled, so later transfers,
-- requeues, reconnects or setting changes can never retroactively fire it.
CREATE TABLE conversation_automation_receipts (
  conversation_id TEXT NOT NULL,
  automation_key TEXT NOT NULL,
  agent_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('sent', 'skipped')),
  message_id TEXT,
  message_body TEXT,
  resolved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversation_id, automation_key),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
);

CREATE INDEX idx_conversation_automation_agent
  ON conversation_automation_receipts(agent_id, resolved_at DESC);

-- Every conversation that existed before this feature is intentionally resolved
-- as skipped. This prevents a historical waiting/requeued conversation from
-- receiving a new greeting simply because the feature was deployed or enabled.
INSERT OR IGNORE INTO conversation_automation_receipts (
  conversation_id,
  automation_key,
  agent_id,
  outcome,
  resolved_at
)
SELECT
  c.id,
  'initial_greeting',
  receipt.agent_id,
  'skipped',
  CURRENT_TIMESTAMP
FROM conversations c
LEFT JOIN agent_traffic_receipts receipt
  ON receipt.conversation_id = c.id;

-- A sent automation is materialized as a normal agent message. The standard
-- message table remains the only chat-history source of truth; the automation
-- receipt only records why the message exists and guarantees exactly-once work.
CREATE TRIGGER trg_initial_greeting_message
AFTER INSERT ON conversation_automation_receipts
WHEN NEW.automation_key = 'initial_greeting'
  AND NEW.outcome = 'sent'
  AND NEW.agent_id IS NOT NULL
  AND NEW.message_id IS NOT NULL
  AND NEW.message_body IS NOT NULL
  AND length(trim(NEW.message_body)) > 0
BEGIN
  INSERT INTO messages (
    id,
    conversation_id,
    sender_type,
    sender_id,
    body,
    client_message_id,
    created_at
  ) VALUES (
    NEW.message_id,
    NEW.conversation_id,
    'agent',
    NEW.agent_id,
    NEW.message_body,
    'auto-greeting:v1',
    NEW.resolved_at
  );

  UPDATE conversations
  SET visitor_unread_count = visitor_unread_count + 1,
      last_message_at = NEW.resolved_at,
      last_message_preview = NEW.message_body,
      updated_at = NEW.resolved_at
  WHERE id = NEW.conversation_id
    AND assigned_agent = NEW.agent_id
    AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP;
END;

-- The immutable traffic receipt is already the database-level definition of a
-- conversation's first effective reception. Bind the initial greeting decision
-- directly to that fact so every assignment path shares the same lifecycle.
CREATE TRIGGER trg_initial_greeting_from_traffic_receipt
AFTER INSERT ON agent_traffic_receipts
BEGIN
  -- First reception itself needs the seat's attention even when the visitor has
  -- not typed yet. MAX keeps an existing unread visitor-message count unchanged,
  -- so legacy create-with-message requests never receive a synthetic extra count.
  UPDATE conversations
  SET agent_unread_count = MAX(agent_unread_count, 1),
      updated_at = NEW.received_at
  WHERE id = NEW.conversation_id
    AND assigned_agent = NEW.agent_id;

  INSERT OR IGNORE INTO conversation_automation_receipts (
    conversation_id,
    automation_key,
    agent_id,
    outcome,
    message_id,
    message_body,
    resolved_at
  )
  SELECT
    NEW.conversation_id,
    'initial_greeting',
    NEW.agent_id,
    'sent',
    'auto-greeting:' || NEW.conversation_id,
    trim(a.auto_greeting_text),
    NEW.received_at
  FROM agents a
  WHERE a.id = NEW.agent_id
    AND a.auto_greeting_enabled = 1
    AND length(trim(COALESCE(a.auto_greeting_text, ''))) > 0;

  INSERT OR IGNORE INTO conversation_automation_receipts (
    conversation_id,
    automation_key,
    agent_id,
    outcome,
    resolved_at
  ) VALUES (
    NEW.conversation_id,
    'initial_greeting',
    NEW.agent_id,
    'skipped',
    NEW.received_at
  );
END;
