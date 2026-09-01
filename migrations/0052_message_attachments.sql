PRAGMA foreign_keys = ON;

-- Reusable agent-owned attachment presets. Phone and link presets are intended
-- for one-click sending; image presets are reusable assets for automated greetings.
CREATE TABLE agent_attachment_presets (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('phone', 'link', 'image')),
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 80),
  value TEXT,
  object_key TEXT,
  mime_type TEXT,
  byte_size INTEGER,
  width INTEGER,
  height INTEGER,
  original_name TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  CHECK (
    (kind IN ('phone', 'link') AND value IS NOT NULL AND object_key IS NULL)
    OR
    (kind = 'image' AND value IS NULL AND object_key IS NOT NULL
      AND mime_type IS NOT NULL AND byte_size IS NOT NULL AND byte_size > 0)
  )
);

CREATE INDEX idx_agent_attachment_presets_agent
  ON agent_attachment_presets(agent_id, kind, sort_order, created_at);

-- A greeting references reusable presets, but the sent message never points at
-- this table directly. The materialization trigger below copies a snapshot into
-- message_attachments so later edits/deletes cannot rewrite chat history.
CREATE TABLE agent_auto_greeting_attachments (
  agent_id TEXT NOT NULL,
  preset_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, preset_id),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (preset_id) REFERENCES agent_attachment_presets(id) ON DELETE CASCADE
);

CREATE INDEX idx_agent_auto_greeting_attachments_order
  ON agent_auto_greeting_attachments(agent_id, sort_order, preset_id);

-- Immutable attachment snapshots owned by a concrete chat message.
CREATE TABLE message_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('phone', 'link', 'image')),
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 80),
  value TEXT,
  object_key TEXT,
  mime_type TEXT,
  byte_size INTEGER,
  width INTEGER,
  height INTEGER,
  original_name TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  CHECK (
    (kind IN ('phone', 'link') AND value IS NOT NULL AND object_key IS NULL)
    OR
    (kind = 'image' AND value IS NULL AND object_key IS NOT NULL
      AND mime_type IS NOT NULL AND byte_size IS NOT NULL AND byte_size > 0)
  )
);

CREATE INDEX idx_message_attachments_message
  ON message_attachments(message_id, sort_order, id);

-- Upgrade the exactly-once greeting automation from text-only to
-- "body + attachments" while preserving the existing receipt ownership model.
DROP TRIGGER IF EXISTS trg_initial_greeting_message;
DROP TRIGGER IF EXISTS trg_initial_greeting_from_traffic_receipt;

CREATE TRIGGER trg_initial_greeting_message
AFTER INSERT ON conversation_automation_receipts
WHEN NEW.automation_key = 'initial_greeting'
  AND NEW.outcome = 'sent'
  AND NEW.agent_id IS NOT NULL
  AND NEW.message_id IS NOT NULL
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
    COALESCE(NEW.message_body, ''),
    'auto-greeting:v2',
    NEW.resolved_at
  );

  INSERT INTO message_attachments (
    id,
    message_id,
    kind,
    label,
    value,
    object_key,
    mime_type,
    byte_size,
    width,
    height,
    original_name,
    sort_order,
    created_at
  )
  SELECT
    'auto-greeting-attachment:' || NEW.conversation_id || ':' || preset.id,
    NEW.message_id,
    preset.kind,
    preset.label,
    preset.value,
    preset.object_key,
    preset.mime_type,
    preset.byte_size,
    preset.width,
    preset.height,
    preset.original_name,
    relation.sort_order,
    NEW.resolved_at
  FROM agent_auto_greeting_attachments relation
  JOIN agent_attachment_presets preset ON preset.id = relation.preset_id
  WHERE relation.agent_id = NEW.agent_id
  ORDER BY relation.sort_order ASC, preset.id ASC;

  UPDATE conversations
  SET visitor_unread_count = visitor_unread_count + 1,
      last_message_at = NEW.resolved_at,
      last_message_preview = CASE
        WHEN length(trim(COALESCE(NEW.message_body, ''))) > 0
          THEN trim(NEW.message_body)
        ELSE COALESCE(
          (
            SELECT label
            FROM message_attachments
            WHERE message_id = NEW.message_id
            ORDER BY sort_order ASC, id ASC
            LIMIT 1
          ),
          'Attachment'
        )
      END,
      updated_at = NEW.resolved_at
  WHERE id = NEW.conversation_id
    AND assigned_agent = NEW.agent_id
    AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP;
END;

CREATE TRIGGER trg_initial_greeting_from_traffic_receipt
AFTER INSERT ON agent_traffic_receipts
BEGIN
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
    trim(COALESCE(a.auto_greeting_text, '')),
    NEW.received_at
  FROM agents a
  WHERE a.id = NEW.agent_id
    AND a.auto_greeting_enabled = 1
    AND (
      length(trim(COALESCE(a.auto_greeting_text, ''))) > 0
      OR EXISTS (
        SELECT 1
        FROM agent_auto_greeting_attachments relation
        JOIN agent_attachment_presets preset ON preset.id = relation.preset_id
        WHERE relation.agent_id = a.id
      )
    );

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
