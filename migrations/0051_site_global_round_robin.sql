PRAGMA foreign_keys = ON;

-- Routing scope decides eligibility only. Fairness is site-wide, so every normal
-- new conversation in one site must advance the same circular cursor regardless
-- of product, section, or category.
DROP TRIGGER IF EXISTS trg_product_round_robin_cursor;
DROP TRIGGER IF EXISTS trg_global_round_robin_cursor;

CREATE TABLE routing_round_robin_cursors_global (
  site_id TEXT NOT NULL PRIMARY KEY,
  last_agent_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Preserve deployment continuity by taking the most recently advanced product
-- cursor for each site. The old product cursors were themselves advanced only by
-- successful assignments, so the newest one is the site's latest known receiver.
INSERT INTO routing_round_robin_cursors_global (
  site_id,
  last_agent_id,
  updated_at
)
SELECT site_id, last_agent_id, updated_at
FROM (
  SELECT
    site_id,
    last_agent_id,
    updated_at,
    ROW_NUMBER() OVER (
      PARTITION BY site_id
      ORDER BY datetime(updated_at) DESC, updated_at DESC, last_agent_id DESC
    ) AS row_number
  FROM routing_round_robin_cursors
)
WHERE row_number = 1;

DROP TABLE routing_round_robin_cursors;
ALTER TABLE routing_round_robin_cursors_global
  RENAME TO routing_round_robin_cursors;

CREATE TRIGGER trg_global_round_robin_cursor
AFTER UPDATE OF assigned_agent ON conversations
WHEN NEW.assigned_agent IS NOT NULL
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
