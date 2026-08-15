CREATE TABLE IF NOT EXISTS conversation_creation_limits (
  site_id TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  accepted_count INTEGER NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  window_started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (site_id, subject_key)
);

CREATE INDEX IF NOT EXISTS idx_conversation_creation_limits_expiry
  ON conversation_creation_limits(expires_at);
