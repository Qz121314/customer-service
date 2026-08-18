PRAGMA foreign_keys = ON;

-- Auto replies are seat-owned server configuration. The type column keeps the
-- storage extensible without turning the first release into a rules engine.
CREATE TABLE IF NOT EXISTS agent_auto_replies (
  agent_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  reply_type TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 0 CHECK (is_enabled IN (0, 1)),
  message_text TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (agent_id, reply_type),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  CHECK (length(reply_type) BETWEEN 1 AND 64),
  CHECK (message_text IS NULL OR length(message_text) <= 2000)
);

CREATE INDEX IF NOT EXISTS idx_agent_auto_replies_site_agent
  ON agent_auto_replies(site_id, agent_id);

-- Server-generated messages have their own idempotency namespace. Do not reuse
-- client_message_id: that field belongs to browser retries, while automation_key
-- describes a durable server-side lifecycle event.
ALTER TABLE messages ADD COLUMN automation_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conversation_automation_key
  ON messages(conversation_id, automation_key)
  WHERE automation_key IS NOT NULL;

-- A traffic receipt can only be inserted on the conversation's first effective
-- assignment. Tying the initial greeting to that immutable event gives the same
-- once-only semantics as consultation quota accounting: transfers, requeues,
-- reconnects and retries can never create another greeting.
CREATE TRIGGER IF NOT EXISTS trg_agent_traffic_receipt_initial_greeting
AFTER INSERT ON agent_traffic_receipts
WHEN EXISTS (
  SELECT 1
  FROM agent_auto_replies reply
  WHERE reply.agent_id = NEW.agent_id
    AND reply.site_id = NEW.site_id
    AND reply.reply_type = 'initial_greeting'
    AND reply.is_enabled = 1
    AND length(trim(COALESCE(reply.message_text, ''))) > 0
)
BEGIN
  INSERT OR IGNORE INTO messages (
    id,
    conversation_id,
    sender_type,
    sender_id,
    body,
    client_message_id,
    automation_key,
    created_at
  )
  SELECT
    'auto:greeting:' || NEW.conversation_id,
    NEW.conversation_id,
    'agent',
    NEW.agent_id,
    trim(reply.message_text),
    NULL,
    'initial_greeting',
    CURRENT_TIMESTAMP
  FROM agent_auto_replies reply
  WHERE reply.agent_id = NEW.agent_id
    AND reply.site_id = NEW.site_id
    AND reply.reply_type = 'initial_greeting'
    AND reply.is_enabled = 1
    AND length(trim(COALESCE(reply.message_text, ''))) > 0
  LIMIT 1;

  UPDATE conversations
  SET visitor_unread_count = visitor_unread_count + 1,
      last_message_at = (
        SELECT created_at
        FROM messages
        WHERE conversation_id = NEW.conversation_id
          AND automation_key = 'initial_greeting'
        LIMIT 1
      ),
      last_message_preview = (
        SELECT body
        FROM messages
        WHERE conversation_id = NEW.conversation_id
          AND automation_key = 'initial_greeting'
        LIMIT 1
      ),
      updated_at = (
        SELECT created_at
        FROM messages
        WHERE conversation_id = NEW.conversation_id
          AND automation_key = 'initial_greeting'
        LIMIT 1
      )
  WHERE id = NEW.conversation_id
    AND EXISTS (
      SELECT 1
      FROM messages
      WHERE conversation_id = NEW.conversation_id
        AND automation_key = 'initial_greeting'
    );
END;
