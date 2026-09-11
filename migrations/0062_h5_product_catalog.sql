PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS h5_product_catalog (
  site_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (id LIKE 'h5:product:%'),
  title TEXT NOT NULL,
  href TEXT,
  cover_url TEXT,
  section_id TEXT NOT NULL CHECK (section_id LIKE 'h5:section:%'),
  section_name TEXT NOT NULL,
  category_id TEXT
    CHECK (category_id IS NULL OR category_id LIKE 'h5:category:%'),
  category_name TEXT,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (category_id IS NULL AND category_name IS NULL)
    OR (category_id IS NOT NULL AND category_name IS NOT NULL)
  ),
  PRIMARY KEY (site_id, id),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_h5_product_catalog_admin
  ON h5_product_catalog(
    site_id, is_enabled, section_name, category_name, title, id
  );

CREATE INDEX IF NOT EXISTS idx_h5_product_catalog_scope_lookup
  ON h5_product_catalog(site_id, is_enabled, section_id, category_id);
