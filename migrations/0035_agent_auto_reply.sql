PRAGMA foreign_keys = ON;

ALTER TABLE agents
  ADD COLUMN auto_greeting_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (auto_greeting_enabled IN (0, 1));

ALTER TABLE agents
  ADD COLUMN auto_greeting_text TEXT;

-- Conversation automations are resolved once per conversation and automation key.
-- A resolution row is written even when the automation is disabled, so later
-- transfers, requeues, reconnects or setting changes cannot retroactively fire it.
CREATE TABLE conversation_automation_receipts (
  conversation_id TEXT NOT NULL,
  automation_key TEXT NOT NULL,
  agent_id TEXT,
  message_id TEXT,
  message_body TEXT,
  resolved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversation_id, automation_key),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
);

CREATE INDEX idx_conversation_automation_agent
  ON conversation_automation_receipts(agent_id, resolved_at DESC);

-- Existing conversations have already passed their first effective assignment.
-- Mark them resolved without generating any retroactive greeting messages.
INSERT OR IGNORE INTO conversation_automation_receipts (
  conversation_id,
  automation_key,
  agent_id,
  resolved_at
)
SELECT
  conversation_id,
  'initial_greeting',
  agent_id,
  CURRENT_TIMESTAMP
FROM agent_traffic_receipts;

-- Materialize an enabled initial greeting as a normal agent message in the same
-- transaction that resolves the one-time automation receipt. Keeping this at the
-- data boundary prevents duplicate greetings even when Workers retry.
CREATE TRIGGER trg_initial_greeting_message
AFTER INSERT ON conversation_automation_receipts
WHEN NEW.automation_key = 'initial_greeting'
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
  SET status = CASE WHEN status = 'open' THEN 'pending' ELSE status END,
      visitor_unread_count = visitor_unread_count + 1,
      last_message_at = NEW.resolved_at,
      last_message_preview = NEW.message_body,
      updated_at = NEW.resolved_at
  WHERE id = NEW.conversation_id
    AND assigned_agent = NEW.agent_id
    AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP;
END;
