PRAGMA foreign_keys = ON;

-- Automatic traffic delivery is presence- and active-load-agnostic. Daily
-- reception limits are enforced by the canonical Worker routing query, while
-- this migration removes the obsolete concurrent-capacity reopen guard.
DROP TRIGGER IF EXISTS trg_conversation_reopen_capacity;

-- A monotonic per-site cursor makes round robin strict even when several
-- assignments happen inside the same millisecond. Existing last_assigned_at
-- values are used only to seed the initial order; new routing decisions use the
-- integer cursor below.
ALTER TABLE agents ADD COLUMN round_robin_seq INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT
    id,
    site_id,
    ROW_NUMBER() OVER (
      PARTITION BY site_id
      ORDER BY last_assigned_at ASC, id ASC
    ) AS seq
  FROM agents
  WHERE last_assigned_at IS NOT NULL
)
UPDATE agents
SET round_robin_seq = COALESCE(
  (
    SELECT ranked.seq
    FROM ranked
    WHERE ranked.id = agents.id
      AND ranked.site_id = agents.site_id
  ),
  0
);

CREATE INDEX IF NOT EXISTS idx_agents_round_robin_seq
ON agents(site_id, is_enabled, round_robin_seq, id);

-- One fresh conversation can consume at most one paid traffic unit. The
-- immutable receipt remains the billing source of truth, so recovery/requeue of
-- the same receipted conversation never consumes another unit.
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
-- conversation ownership. SQLite serializes the write, so the MAX()+1 sequence
-- is strictly increasing without an extra Worker-side D1 request. Keep
-- last_assigned_at for reporting/backward compatibility, but do not use it as
-- the fairness cursor.
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
  SET round_robin_seq = (
        SELECT COALESCE(MAX(peer.round_robin_seq), 0) + 1
        FROM agents peer
        WHERE peer.site_id = NEW.site_id
      ),
      last_assigned_at = COALESCE(NEW.assigned_at, CURRENT_TIMESTAMP),
      updated_at = COALESCE(NEW.assigned_at, CURRENT_TIMESTAMP)
  WHERE id = NEW.assigned_agent
    AND site_id = NEW.site_id;
END;
