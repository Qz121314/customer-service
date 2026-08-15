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

CREATE VIEW IF NOT EXISTS conversation_creation_quota_gate AS
SELECT
  '' AS site_id,
  '' AS visitor_key,
  '' AS source_key,
  '' AS window_started_at,
  '' AS expires_at
WHERE 0;

CREATE TRIGGER IF NOT EXISTS trg_conversation_creation_quota_gate
INSTEAD OF INSERT ON conversation_creation_quota_gate
BEGIN
  INSERT OR IGNORE INTO conversation_creation_limits (
    site_id, subject_key, accepted_count, window_started_at, expires_at, updated_at
  ) VALUES (
    NEW.site_id, NEW.visitor_key, 0,
    NEW.window_started_at, NEW.expires_at, NEW.window_started_at
  );

  UPDATE conversation_creation_limits
  SET accepted_count = 0,
      window_started_at = NEW.window_started_at,
      expires_at = NEW.expires_at,
      updated_at = NEW.window_started_at
  WHERE site_id = NEW.site_id
    AND subject_key = NEW.visitor_key
    AND datetime(expires_at) <= datetime(NEW.window_started_at);

  SELECT CASE
    WHEN (
      SELECT accepted_count
      FROM conversation_creation_limits
      WHERE site_id = NEW.site_id AND subject_key = NEW.visitor_key
    ) >= 10
    THEN RAISE(ABORT, 'VISITOR_CONVERSATION_LIMIT_REACHED')
  END;

  INSERT OR IGNORE INTO conversation_creation_limits (
    site_id, subject_key, accepted_count, window_started_at, expires_at, updated_at
  ) VALUES (
    NEW.site_id, NEW.source_key, 0,
    NEW.window_started_at, NEW.expires_at, NEW.window_started_at
  );

  UPDATE conversation_creation_limits
  SET accepted_count = 0,
      window_started_at = NEW.window_started_at,
      expires_at = NEW.expires_at,
      updated_at = NEW.window_started_at
  WHERE site_id = NEW.site_id
    AND subject_key = NEW.source_key
    AND datetime(expires_at) <= datetime(NEW.window_started_at);

  SELECT CASE
    WHEN (
      SELECT accepted_count
      FROM conversation_creation_limits
      WHERE site_id = NEW.site_id AND subject_key = NEW.source_key
    ) >= 20
    THEN RAISE(ABORT, 'SOURCE_CONVERSATION_LIMIT_REACHED')
  END;

  UPDATE conversation_creation_limits
  SET accepted_count = accepted_count + 1,
      updated_at = NEW.window_started_at
  WHERE site_id = NEW.site_id
    AND subject_key IN (NEW.visitor_key, NEW.source_key);
END;
