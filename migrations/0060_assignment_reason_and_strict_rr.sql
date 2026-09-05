PRAGMA foreign_keys = ON;

-- P0 routing explainability: persist why a seat received traffic while keeping
-- normal traffic fairness independent from the CTA affinity override.
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

-- Record the reason after a fresh assignment without coupling the routing query
-- itself to this reporting column. The CTA affinity fields are the authoritative
-- source because they already drive candidate priority in routing.ts.
DROP TRIGGER IF EXISTS trg_conversation_assignment_reason;
CREATE TRIGGER trg_conversation_assignment_reason
AFTER UPDATE OF assigned_agent ON conversations
WHEN NEW.assigned_agent IS NOT NULL
  AND (
    OLD.assigned_agent IS NULL
    OR OLD.assigned_agent <> NEW.assigned_agent
  )
BEGIN
  UPDATE conversations
  SET assignment_reason = CASE
    WHEN NEW.cta_affinity_agent_id IS NOT NULL
      AND NEW.assigned_agent = NEW.cta_affinity_agent_id
      AND datetime(NEW.cta_affinity_expires_at) > CURRENT_TIMESTAMP
    THEN 'affinity'
    ELSE 'round_robin'
  END
  WHERE id = NEW.id;
END;

-- CTA affinity is an override, not a normal round-robin turn. Only a normal
-- assignment advances the site cursor, so a returning CTA never consumes or
-- changes the next normal traffic turn.
DROP TRIGGER IF EXISTS trg_global_round_robin_cursor;
CREATE TRIGGER trg_global_round_robin_cursor
AFTER UPDATE OF assigned_agent ON conversations
WHEN NEW.assigned_agent IS NOT NULL
  AND NOT (
    NEW.cta_affinity_agent_id IS NOT NULL
    AND NEW.assigned_agent = NEW.cta_affinity_agent_id
    AND datetime(NEW.cta_affinity_expires_at) > CURRENT_TIMESTAMP
  )
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
-- assignment reason together with the first immutable receiving agent. Derive
-- the reason directly here as well so trigger execution order is irrelevant.
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
      assignment_reason = COALESCE((
        SELECT CASE
          WHEN c.cta_affinity_agent_id IS NOT NULL
            AND c.assigned_agent = c.cta_affinity_agent_id
            AND datetime(c.cta_affinity_expires_at) > datetime(c.assigned_at)
          THEN 'affinity'
          ELSE 'round_robin'
        END
        FROM conversations c
        WHERE c.id = NEW.conversation_id AND c.site_id = NEW.site_id
        LIMIT 1
      ), 'round_robin')
  WHERE conversation_id = NEW.conversation_id
    AND agent_id IS NULL;
END;
