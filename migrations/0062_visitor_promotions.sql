PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS visitor_promotions (
  site_id TEXT NOT NULL,
  id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  is_enabled INTEGER NOT NULL DEFAULT 0 CHECK (is_enabled IN (0, 1)),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  cover_url TEXT,
  body_markdown TEXT NOT NULL,
  cta_label TEXT,
  cta_url TEXT,
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, id),
  UNIQUE (site_id),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_visitor_promotions_active
  ON visitor_promotions(site_id, is_enabled, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS visitor_promotion_views (
  site_id TEXT NOT NULL,
  promotion_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  visitor_id TEXT NOT NULL,
  viewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, promotion_id, revision, visitor_id),
  FOREIGN KEY (site_id, promotion_id)
    REFERENCES visitor_promotions(site_id, id) ON DELETE CASCADE,
  FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_visitor_promotion_views_visitor
  ON visitor_promotion_views(site_id, visitor_id, promotion_id, revision);
