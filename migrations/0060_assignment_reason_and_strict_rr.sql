PRAGMA foreign_keys = ON;

-- Distinguish normal site-wide round-robin traffic from the two-hour CTA
-- affinity override. Historical rows remain NULL because their original reason
-- cannot be reconstructed reliably after the fact.
ALTER TABLE conversations
  ADD COLUMN assignment_reason TEXT
  CHECK (
    assignment_reason IS NULL
    OR assignment_reason IN ('round_robin', 'affinity')
  );

ALTER TABLE conversation_traffic_receipts
  ADD COLUMN assignment_reason TEXT
  CHECK (
    assignment_reason IS NULL
    OR assignment_reason IN ('round_robin', 'affinity')
  );

-- CTA affinity is an override, not a normal round-robin turn. Only normal
-- assignments advance the site cursor. COALESCE preserves safe rolling-deploy
-- behavior for an older Worker that does not yet populate assignment_reason.
DROP TRIGGER IF EXISTS trg_global_round_robin_cursor;
CREATE TRIGGER trg_global_round_robin_cursor
AFTER UPDATE OF assigned_agent ON conversations
WHEN NEW.assigned_agent IS NOT NULL
  AND COALESCE(NEW.assignment_reason, 'round_robin') = 'round_robin'
  AND (
    OLD.assigned_agent IS NULL
    OR OLD.assigned_agent <> NEW.assigned_agent
  )
BEGIN
  INSERT INTO routing_round_robin_cursors (
    site_id,
    last_agent_id,
    updated_at
  ) VALUES (
    NEW.site_id,
    NEW.assigned_agent,
    COALESCE(NEW.assigned_at, CURRENT_TIMESTAMP)
  )
  ON CONFLICT(site_id) DO UPDATE SET
    last_agent_id = excluded.last_agent_id,
    updated_at = excluded.updated_at;
END;

-- Reporting outlives the short conversation retention window, so snapshot the
-- assignment reason together with the first immutable receiving agent.
DROP TRIGGER IF EXISTS trg_conversation_traffic_first_agent;
CREATE TRIGGER trg_conversation_traffic_first_agent
AFTER INSERT ON agent_traffic_receipts
BEGIN
  UPDATE conversation_traffic_receipts
  SET agent_id = NEW.agent_id,
      agent_name = (
        SELECT name
        FROM agents
        WHERE id = NEW.agent_id AND site_id = NEW.site_id
        LIMIT 1
      ),
      assignment_reason = (
        SELECT assignment_reason
        FROM conversations
        WHERE id = NEW.conversation_id AND site_id = NEW.site_id
        LIMIT 1
      )
  WHERE conversation_id = NEW.conversation_id
    AND agent_id IS NULL;
END;
