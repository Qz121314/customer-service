PRAGMA foreign_keys = ON;

CREATE TABLE product_catalog (
  site_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  href TEXT,
  cover_url TEXT,
  section_id TEXT,
  section_name TEXT,
  category_id TEXT,
  category_name TEXT,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, id),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE INDEX idx_product_catalog_admin
  ON product_catalog(site_id, is_enabled, section_name, category_name, title, id);

CREATE TABLE agent_products (
  site_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, agent_id, product_id),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (site_id, product_id)
    REFERENCES product_catalog(site_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_agent_products_product
  ON agent_products(site_id, product_id, is_enabled, agent_id);

CREATE INDEX idx_agent_products_agent
  ON agent_products(site_id, agent_id, is_enabled, product_id);

-- Keep products already seen in active/recent conversations visible until Site
-- performs the first full catalog sync after this migration.
INSERT OR IGNORE INTO product_catalog (
  site_id, id, title, href, cover_url,
  section_id, section_name, category_id, category_name, is_enabled, updated_at
)
SELECT
  site_id,
  product_id,
  COALESCE(MAX(product_title), product_id),
  MAX(product_href),
  MAX(product_cover_url),
  MAX(section_id),
  MAX(section_name),
  MAX(category_id),
  MAX(category_name),
  1,
  CURRENT_TIMESTAMP
FROM conversations
WHERE product_id IS NOT NULL AND product_id <> ''
GROUP BY site_id, product_id;
