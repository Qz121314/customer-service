PRAGMA foreign_keys = ON;

-- Contact cards are now first-class channel actions instead of generic
-- phone/link attachments. Preserve every existing preset/message snapshot while
-- migrating the historical names once: phone -> sms, link -> website.
DROP TRIGGER IF EXISTS trg_initial_greeting_message;
DROP TRIGGER IF EXISTS trg_initial_greeting_from_traffic_receipt;

ALTER TABLE agent_auto_greeting_attachments
  RENAME TO agent_auto_greeting_attachments_legacy;
ALTER TABLE agent_attachment_presets
  RENAME TO agent_attachment_presets_legacy;
ALTER TABLE message_attachments
  RENAME TO message_attachments_legacy;

DROP INDEX IF EXISTS idx_agent_attachment_presets_agent;
DROP INDEX IF EXISTS idx_agent_auto_greeting_attachments_order;
DROP INDEX IF EXISTS idx_message_attachments_message;

CREATE TABLE agent_attachment_presets (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN ('sms', 'whatsapp', 'telegram', 'website', 'image')
  ),
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 80),
  value TEXT,
  preset_message TEXT CHECK (
    preset_message IS NULL OR length(preset_message) BETWEEN 1 AND 2000
  ),
  icon_ref TEXT,
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
    (
      kind IN ('sms', 'whatsapp', 'telegram', 'website')
      AND value IS NOT NULL
      AND object_key IS NULL
      AND mime_type IS NULL
      AND byte_size IS NULL
      AND width IS NULL
      AND height IS NULL
      AND original_name IS NULL
      AND (kind <> 'website' OR preset_message IS NULL)
    )
    OR
    (
      kind = 'image'
      AND value IS NULL
      AND preset_message IS NULL
      AND icon_ref IS NULL
      AND object_key IS NOT NULL
      AND mime_type IS NOT NULL
      AND byte_size IS NOT NULL
      AND byte_size > 0
    )
  )
);

CREATE TABLE agent_auto_greeting_attachments (
  agent_id TEXT NOT NULL,
  preset_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, preset_id),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (preset_id) REFERENCES agent_attachment_presets(id) ON DELETE CASCADE
);

CREATE TABLE message_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN ('sms', 'whatsapp', 'telegram', 'website', 'image')
  ),
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 80),
  value TEXT,
  preset_message TEXT CHECK (
    preset_message IS NULL OR length(preset_message) BETWEEN 1 AND 2000
  ),
  icon_ref TEXT,
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
    (
      kind IN ('sms', 'whatsapp', 'telegram', 'website')
      AND value IS NOT NULL
      AND object_key IS NULL
      AND mime_type IS NULL
      AND byte_size IS NULL
      AND width IS NULL
      AND height IS NULL
      AND original_name IS NULL
      AND (kind <> 'website' OR preset_message IS NULL)
    )
    OR
    (
      kind = 'image'
      AND value IS NULL
      AND preset_message IS NULL
      AND icon_ref IS NULL
      AND object_key IS NOT NULL
      AND mime_type IS NOT NULL
      AND byte_size IS NOT NULL
      AND byte_size > 0
    )
  )
);

INSERT INTO agent_attachment_presets (
  id, agent_id, kind, label, value, preset_message, icon_ref,
  object_key, mime_type, byte_size, width, height, original_name,
  sort_order, created_at, updated_at
)
SELECT
  id,
  agent_id,
  CASE kind WHEN 'phone' THEN 'sms' WHEN 'link' THEN 'website' ELSE kind END,
  label,
  value,
  NULL,
  CASE
    WHEN kind IN ('phone', 'link')
      AND original_name LIKE 'contact-card-icon:v1:%'
      THEN original_name
    ELSE NULL
  END,
  object_key,
  mime_type,
  byte_size,
  width,
  height,
  CASE WHEN kind = 'image' THEN original_name ELSE NULL END,
  sort_order,
  created_at,
  updated_at
FROM agent_attachment_presets_legacy;

INSERT INTO agent_auto_greeting_attachments (agent_id, preset_id, sort_order)
SELECT agent_id, preset_id, sort_order
FROM agent_auto_greeting_attachments_legacy;

INSERT INTO message_attachments (
  id, message_id, kind, label, value, preset_message, icon_ref,
  object_key, mime_type, byte_size, width, height, original_name,
  sort_order, created_at
)
SELECT
  id,
  message_id,
  CASE kind WHEN 'phone' THEN 'sms' WHEN 'link' THEN 'website' ELSE kind END,
  label,
  value,
  NULL,
  CASE
    WHEN kind IN ('phone', 'link')
      AND original_name LIKE 'contact-card-icon:v1:%'
      THEN original_name
    ELSE NULL
  END,
  object_key,
  mime_type,
  byte_size,
  width,
  height,
  CASE WHEN kind = 'image' THEN original_name ELSE NULL END,
  sort_order,
  created_at
FROM message_attachments_legacy;

DROP TABLE agent_auto_greeting_attachments_legacy;
DROP TABLE message_attachments_legacy;
DROP TABLE agent_attachment_presets_legacy;

CREATE INDEX idx_agent_attachment_presets_agent
  ON agent_attachment_presets(agent_id, kind, sort_order, created_at);
CREATE INDEX idx_agent_auto_greeting_attachments_order
  ON agent_auto_greeting_attachments(agent_id, sort_order, preset_id);
CREATE INDEX idx_message_attachments_message
  ON message_attachments(message_id, sort_order, id);

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
    preset_message,
    icon_ref,
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
    preset.preset_message,
    preset.icon_ref,
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
