PRAGMA foreign_keys = ON;

-- The conversation expiry is now the only service-cycle clock. The separate
-- CTA affinity deadline from the former two-hour rule is obsolete.
DROP INDEX IF EXISTS idx_conversations_cta_affinity;
ALTER TABLE conversations DROP COLUMN cta_affinity_expires_at;

CREATE INDEX idx_conversations_cta_affinity
  ON conversations(site_id, cta_affinity_agent_id)
  WHERE cta_affinity_agent_id IS NOT NULL;

-- A seat explicitly returning its own conversation to automatic routing is a
-- manual override of the service-cycle binding. Clear the affinity together
-- with ownership so the requeue can actually select another eligible seat.
DROP TRIGGER IF EXISTS trg_conversation_requeue_exclusion;
CREATE TRIGGER trg_conversation_requeue_exclusion
AFTER UPDATE OF assigned_agent ON conversations
WHEN OLD.assigned_agent IS NOT NULL
  AND NEW.assigned_agent IS NULL
  AND EXISTS (
    SELECT 1
    FROM agents agent
    WHERE agent.id = OLD.assigned_agent
      AND agent.site_id = NEW.site_id
      AND agent.is_enabled = 1
  )
BEGIN
  UPDATE conversations
  SET requeue_excluded_agent_id = OLD.assigned_agent,
      cta_affinity_agent_id = NULL
  WHERE id = NEW.id;
END;

-- An explicit ownership transfer becomes the new service-cycle owner. Future
-- closed/restarted threads within the same 24-hour cycle therefore stay with
-- the seat a human intentionally selected instead of snapping back to the
-- original automatic assignment.
CREATE TRIGGER trg_conversation_transfer_affinity
AFTER UPDATE OF assigned_agent ON conversations
WHEN OLD.assigned_agent IS NOT NULL
  AND NEW.assigned_agent IS NOT NULL
  AND OLD.assigned_agent <> NEW.assigned_agent
BEGIN
  UPDATE conversations
  SET cta_affinity_agent_id = NEW.assigned_agent
  WHERE id = NEW.id;
END;
