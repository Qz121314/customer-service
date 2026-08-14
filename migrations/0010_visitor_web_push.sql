PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS visitor_push_vapid (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  public_key TEXT NOT NULL,
  private_jwk TEXT NOT NULL,
  subject TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS visitor_push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  visitor_external_id TEXT NOT NULL,
  expiration_time INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_visitor_push_subscriptions_identity
  ON visitor_push_subscriptions(site_id, visitor_external_id, updated_at DESC);
