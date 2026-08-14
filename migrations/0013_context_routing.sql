PRAGMA foreign_keys = ON;

ALTER TABLE conversations ADD COLUMN section_name TEXT;
ALTER TABLE conversations ADD COLUMN category_id TEXT;
ALTER TABLE conversations ADD COLUMN category_name TEXT;

CREATE TABLE routing_catalog_sections (
  site_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, id),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE TABLE routing_catalog_categories (
  site_id TEXT NOT NULL,
  id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  name TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, id),
  FOREIGN KEY (site_id, section_id)
    REFERENCES routing_catalog_sections(site_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_routing_catalog_categories_section
  ON routing_catalog_categories(site_id, section_id, name, id);

CREATE TABLE group_routing_rules (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  section_id TEXT NOT NULL DEFAULT '',
  category_id TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (is_default = 1 AND section_id = '' AND category_id = '')
    OR (is_default = 0 AND section_id <> '')
  ),
  UNIQUE (site_id, section_id, category_id),
  FOREIGN KEY (site_id, group_id)
    REFERENCES support_groups(site_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_group_routing_rules_lookup
  ON group_routing_rules(site_id, is_enabled, section_id, category_id, group_id);

INSERT OR IGNORE INTO group_routing_rules (
  id, site_id, group_id, section_id, category_id, is_default, is_enabled
)
SELECT
  'default-general-route',
  site_id,
  id,
  '',
  '',
  1,
  1
FROM support_groups
WHERE site_id = 'default' AND id = 'general' AND is_enabled = 1;
