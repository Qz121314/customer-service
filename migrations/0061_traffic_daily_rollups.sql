PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS traffic_daily_rollups (
  site_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('summary', 'agent', 'product')),
  item_id TEXT NOT NULL,
  item_name TEXT,
  count INTEGER NOT NULL CHECK (count >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, business_date, dimension, item_id)
);

CREATE INDEX IF NOT EXISTS idx_traffic_daily_rollups_site_date
  ON traffic_daily_rollups (site_id, business_date);

INSERT INTO traffic_daily_rollups (
  site_id,
  business_date,
  dimension,
  item_id,
  item_name,
  count,
  updated_at
)
SELECT
  site_id,
  business_date,
  'summary',
  'total',
  NULL,
  COUNT(*),
  CURRENT_TIMESTAMP
FROM conversation_traffic_receipts
GROUP BY site_id, business_date;

INSERT INTO traffic_daily_rollups (
  site_id,
  business_date,
  dimension,
  item_id,
  item_name,
  count,
  updated_at
)
SELECT
  site_id,
  business_date,
  'agent',
  COALESCE(agent_id, '__pending__'),
  MAX(NULLIF(TRIM(agent_name), '')),
  COUNT(*),
  CURRENT_TIMESTAMP
FROM conversation_traffic_receipts
GROUP BY site_id, business_date, agent_id;

INSERT INTO traffic_daily_rollups (
  site_id,
  business_date,
  dimension,
  item_id,
  item_name,
  count,
  updated_at
)
SELECT
  site_id,
  business_date,
  'product',
  COALESCE(product_id, '__unknown__'),
  MAX(NULLIF(TRIM(product_title), '')),
  COUNT(*),
  CURRENT_TIMESTAMP
FROM conversation_traffic_receipts
GROUP BY site_id, business_date, product_id;
