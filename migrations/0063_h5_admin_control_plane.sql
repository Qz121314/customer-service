PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS h5_settings (
  site_id TEXT NOT NULL,
  public_origin TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS h5_conversion_pools (
  site_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (id LIKE 'h5:pool:%'),
  name TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  action_type TEXT NOT NULL CHECK (action_type IN ('chat', 'external')),
  cta_label TEXT NOT NULL CHECK (length(trim(cta_label)) > 0),
  external_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (action_type = 'chat' AND external_url IS NULL)
    OR (action_type = 'external' AND external_url IS NOT NULL)
  ),
  PRIMARY KEY (site_id, id),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_h5_conversion_pools_admin
  ON h5_conversion_pools(site_id, is_enabled, name, id);

CREATE TABLE h5_product_catalog_next (
  site_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (id LIKE 'h5:product:%'),
  title TEXT NOT NULL,
  href TEXT,
  cover_url TEXT,
  section_id TEXT NOT NULL CHECK (section_id = 'h5:section:pages'),
  section_name TEXT NOT NULL CHECK (section_name = 'H5 页面'),
  category_id TEXT CHECK (category_id IS NULL OR category_id LIKE 'h5:category:%'),
  category_name TEXT,
  slug TEXT NOT NULL CHECK (
    length(slug) BETWEEN 1 AND 80
    AND slug NOT GLOB '*[^a-z0-9-]*'
    AND slug NOT GLOB '-*'
    AND slug NOT GLOB '*-'
  ),
  conversion_pool_id TEXT,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (category_id IS NULL AND category_name IS NULL)
    OR (category_id IS NOT NULL AND category_name IS NOT NULL)
  ),
  PRIMARY KEY (site_id, id),
  UNIQUE (site_id, slug),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY (site_id, conversion_pool_id)
    REFERENCES h5_conversion_pools(site_id, id)
    ON DELETE RESTRICT
);

INSERT INTO h5_product_catalog_next (
  site_id, id, title, href, cover_url, section_id, section_name,
  category_id, category_name, slug, is_enabled, created_at, updated_at
)
SELECT
  site_id, id, title, href, cover_url, section_id, section_name,
  category_id, category_name,
  lower(substr(id, length('h5:product:') + 1)),
  is_enabled, created_at, updated_at
FROM h5_product_catalog;

DROP TABLE h5_product_catalog;
ALTER TABLE h5_product_catalog_next RENAME TO h5_product_catalog;

CREATE INDEX IF NOT EXISTS idx_h5_product_catalog_admin
  ON h5_product_catalog(
    site_id, is_enabled, section_name, category_name, title, id
  );

CREATE INDEX IF NOT EXISTS idx_h5_product_catalog_scope_lookup
  ON h5_product_catalog(site_id, is_enabled, section_id, category_id);

CREATE INDEX IF NOT EXISTS idx_h5_product_catalog_pool
  ON h5_product_catalog(site_id, conversion_pool_id, is_enabled);
