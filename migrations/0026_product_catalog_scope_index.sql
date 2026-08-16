PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_product_catalog_scope_lookup
  ON product_catalog(site_id, is_enabled, section_id, category_id);
