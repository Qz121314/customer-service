PRAGMA foreign_keys = ON;

CREATE TABLE agent_routing_scopes (
  site_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  scope_type TEXT NOT NULL
    CHECK (scope_type IN ('section', 'category', 'product')),
  section_id TEXT NOT NULL DEFAULT '',
  category_id TEXT NOT NULL DEFAULT '',
  product_id TEXT NOT NULL DEFAULT '',
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (
    site_id,
    agent_id,
    scope_type,
    section_id,
    category_id,
    product_id
  ),
  CHECK (
    (
      scope_type = 'section'
      AND section_id <> ''
      AND category_id = ''
      AND product_id = ''
    )
    OR (
      scope_type = 'category'
      AND section_id <> ''
      AND category_id <> ''
      AND product_id = ''
    )
    OR (
      scope_type = 'product'
      AND section_id = ''
      AND category_id = ''
      AND product_id <> ''
    )
  ),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE INDEX idx_agent_routing_scopes_lookup
  ON agent_routing_scopes(
    site_id,
    is_enabled,
    scope_type,
    section_id,
    category_id,
    product_id,
    agent_id
  );

CREATE INDEX idx_agent_routing_scopes_agent
  ON agent_routing_scopes(
    site_id,
    agent_id,
    is_enabled,
    scope_type,
    section_id,
    category_id,
    product_id
  );

-- Preserve all existing per-product assignments as explicit product scopes.
-- Admins can later replace them with section/category rules from the UI.
INSERT OR IGNORE INTO agent_routing_scopes (
  site_id,
  agent_id,
  scope_type,
  section_id,
  category_id,
  product_id,
  is_enabled,
  created_at,
  updated_at
)
SELECT
  site_id,
  agent_id,
  'product',
  '',
  '',
  product_id,
  is_enabled,
  created_at,
  updated_at
FROM agent_products;
