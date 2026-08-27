PRAGMA foreign_keys = ON;

-- Strict round robin now owns fairness through round_robin_seq. The old
-- concurrency field and timestamp-based fairness cursor are no longer read by
-- runtime routing, admin configuration, agent inboxes, or reporting.
DROP TRIGGER IF EXISTS trg_agent_round_robin_cursor;
DROP INDEX IF EXISTS idx_agents_site_availability;

ALTER TABLE agents DROP COLUMN max_active_conversations;
ALTER TABLE agents DROP COLUMN last_assigned_at;

-- Preserve the single-write round-robin cursor update without carrying the
-- retired timestamp field forward.
CREATE TRIGGER trg_agent_round_robin_cursor
AFTER UPDATE OF assigned_agent ON conversations
WHEN NEW.assigned_agent IS NOT NULL
  AND (
    OLD.assigned_agent IS NULL
    OR OLD.assigned_agent <> NEW.assigned_agent
  )
BEGIN
  UPDATE agents
  SET round_robin_seq = (
        SELECT COALESCE(MAX(peer.round_robin_seq), 0) + 1
        FROM agents peer
        WHERE peer.site_id = NEW.site_id
      ),
      updated_at = COALESCE(NEW.assigned_at, CURRENT_TIMESTAMP)
  WHERE id = NEW.assigned_agent
    AND site_id = NEW.site_id;
END;
