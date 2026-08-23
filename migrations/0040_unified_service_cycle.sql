PRAGMA foreign_keys = ON;

-- The conversation expiry is now the only service-cycle clock. The separate
-- CTA affinity deadline from the former two-hour rule is obsolete.
DROP INDEX IF EXISTS idx_conversations_cta_affinity;
ALTER TABLE conversations DROP COLUMN cta_affinity_expires_at;

CREATE INDEX idx_conversations_cta_affinity
  ON conversations(site_id, cta_affinity_agent_id)
  WHERE cta_affinity_agent_id IS NOT NULL;

-- Cron cleanup is intentionally bounded and can lag expiry by a few minutes.
-- Release a stale CTA start claim synchronously before a new cycle inserts the
-- same site + visitor + product key, so an expired but not-yet-purged row never
-- blocks the next 24-hour service cycle.
CREATE TRIGGER trg_conversation_expired_start_key_release
BEFORE INSERT ON conversations
WHEN NEW.start_reuse_key IS NOT NULL
BEGIN
  UPDATE conversations
  SET start_reuse_key = NULL
  WHERE site_id = NEW.site_id
    AND start_reuse_key = NEW.start_reuse_key
    AND expires_at <= CURRENT_TIMESTAMP;
END;

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
