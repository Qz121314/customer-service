PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS visitor_promotions (
  site_id TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
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
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);
