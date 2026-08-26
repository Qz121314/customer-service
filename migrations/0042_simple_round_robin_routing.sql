PRAGMA foreign_keys = ON;

-- Automatic traffic delivery is presence-agnostic. Active-conversation and
-- daily reception limits remain operational/reporting settings, but they do not
-- block automatic delivery of purchased traffic.
DROP TRIGGER IF EXISTS trg_conversation_reopen_capacity;

-- One fresh conversation can consume at most one paid traffic unit. The
-- immutable receipt remains the billing source of truth, so transfers and
-- requeues never require or consume another unit.
DROP TRIGGER IF EXISTS trg_conversation_new_traffic_limit_guard;
CREATE TRIGGER trg_conversation_new_traffic_limit_guard
BEFORE UPDATE OF assigned_agent ON conversations
WHEN NEW.assigned_agent IS NOT NULL
  AND (
    OLD.assigned_agent IS NULL
    OR OLD.assigned_agent <> NEW.assigned_agent
  )
  AND NOT EXISTS (
    SELECT 1
    FROM agent_traffic_receipts receipt
    WHERE receipt.conversation_id = NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'AGENT_NEW_TRAFFIC_LIMIT_EXHAUSTED')
  WHERE EXISTS (
    SELECT 1
    FROM agents target
    WHERE target.id = NEW.assigned_agent
      AND target.site_id = NEW.site_id
      AND target.traffic_quota_enabled = 1
      AND target.traffic_quota_used >= target.traffic_quota_total
  );
END;

-- Advance the round-robin cursor inside the same SQLite statement that changes
-- conversation ownership. This avoids an extra Worker-side D1 write and makes
-- concurrent assignment statements observe the latest seat order.
DROP TRIGGER IF EXISTS trg_agent_round_robin_cursor;
CREATE TRIGGER trg_agent_round_robin_cursor
AFTER UPDATE OF assigned_agent ON conversations
WHEN NEW.assigned_agent IS NOT NULL
  AND (
    OLD.assigned_agent IS NULL
    OR OLD.assigned_agent <> NEW.assigned_agent
  )
BEGIN
  UPDATE agents
  SET last_assigned_at = COALESCE(NEW.assigned_at, CURRENT_TIMESTAMP),
      updated_at = COALESCE(NEW.assigned_at, CURRENT_TIMESTAMP)
  WHERE id = NEW.assigned_agent
    AND site_id = NEW.site_id;
END;
