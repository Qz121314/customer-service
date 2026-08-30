PRAGMA foreign_keys = ON;

-- Fairness belongs to each product, not to the whole site. A seat can cover
-- several products without traffic on one product changing another product's
-- next receiver.
DROP TRIGGER IF EXISTS trg_agent_round_robin_cursor;
DROP INDEX IF EXISTS idx_agents_round_robin_seq;

CREATE TABLE routing_round_robin_cursors (
  site_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  last_agent_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, product_id)
);

-- Keep deployment continuity by seeding each product from its most recent active
-- assignment. If no recent assignment survives the 24-hour chat retention, the
-- product simply starts from the first eligible agent ID.
INSERT INTO routing_round_robin_cursors (
  site_id,
  product_id,
  last_agent_id,
  updated_at
)
SELECT site_id, product_id, assigned_agent, assigned_at
FROM (
  SELECT
    c.site_id,
    COALESCE(c.product_id, '') AS product_id,
    c.assigned_agent,
    COALESCE(
      c.assigned_at,
      c.updated_at,
      c.created_at,
      CURRENT_TIMESTAMP
    ) AS assigned_at,
    ROW_NUMBER() OVER (
      PARTITION BY c.site_id, COALESCE(c.product_id, '')
      ORDER BY
        COALESCE(
          c.assigned_at,
          c.updated_at,
          c.created_at,
          CURRENT_TIMESTAMP
        ) DESC,
        c.id DESC
    ) AS row_number
  FROM conversations c
  WHERE c.assigned_agent IS NOT NULL
)
WHERE row_number = 1;

CREATE TRIGGER trg_product_round_robin_cursor
AFTER UPDATE OF assigned_agent ON conversations
WHEN NEW.assigned_agent IS NOT NULL
  AND (
    OLD.assigned_agent IS NULL
    OR OLD.assigned_agent <> NEW.assigned_agent
  )
BEGIN
  INSERT INTO routing_round_robin_cursors (
    site_id,
    product_id,
    last_agent_id,
    updated_at
  ) VALUES (
    NEW.site_id,
    COALESCE(NEW.product_id, ''),
    NEW.assigned_agent,
    COALESCE(NEW.assigned_at, CURRENT_TIMESTAMP)
  )
  ON CONFLICT(site_id, product_id) DO UPDATE SET
    last_agent_id = excluded.last_agent_id,
    updated_at = excluded.updated_at;
END;

-- The old per-agent site-wide cursor would reintroduce cross-product coupling if
-- it were accidentally reused later, so remove it from the final schema.
ALTER TABLE agents DROP COLUMN round_robin_seq;
