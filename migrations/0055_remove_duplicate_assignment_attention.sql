PRAGMA foreign_keys = ON;

-- Assignment attention is owned by trg_conversation_assignment_attention.
-- The assignment UPDATE already persists updated_at = assigned_at, which is
-- the same timestamp copied into agent_traffic_receipts.received_at. Rebuild
-- the greeting receipt trigger without a second conversation row UPDATE.
DROP TRIGGER IF EXISTS trg_initial_greeting_from_traffic_receipt;

CREATE TRIGGER trg_initial_greeting_from_traffic_receipt
AFTER INSERT ON agent_traffic_receipts
BEGIN
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
