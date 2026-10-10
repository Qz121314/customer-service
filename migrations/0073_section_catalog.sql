PRAGMA foreign_keys = ON;

CREATE TABLE section_catalog (
  site_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  href TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, id),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE INDEX idx_section_catalog_admin
  ON section_catalog(site_id, is_enabled, name, id);
