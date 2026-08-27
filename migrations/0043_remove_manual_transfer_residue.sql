PRAGMA foreign_keys = ON;

-- Manual transfer has been removed. The requeue exclusion column was only
-- used by that feature and is no longer part of the runtime routing model.
DROP TRIGGER IF EXISTS trg_conversation_requeue_exclusion;
DROP TRIGGER IF EXISTS trg_conversation_assignment_attention;

ALTER TABLE conversations DROP COLUMN requeue_excluded_agent_id;

-- Receiving a conversation still needs one visible attention marker. Rebuild
-- the trigger without the removed requeue column so every final schema write is
-- valid and the existing unread behavior is preserved.
CREATE TRIGGER trg_conversation_assignment_attention
AFTER UPDATE OF assigned_agent ON conversations
WHEN NEW.assigned_agent IS NOT NULL
  AND (
    OLD.assigned_agent IS NULL
    OR OLD.assigned_agent <> NEW.assigned_agent
  )
BEGIN
  UPDATE conversations
  SET agent_unread_count = MAX(agent_unread_count, 1)
  WHERE id = NEW.id;
END;
