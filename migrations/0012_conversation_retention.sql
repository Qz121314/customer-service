PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_conversations_expiry
  ON conversations(expires_at);

-- A visitor identity may own several conversations created at different times.
-- Keep the identity alive at least as long as its latest conversation so the
-- conversation's own 24-hour expiry is the only user-visible lifetime boundary.
UPDATE visitors
SET expires_at = (
  SELECT MAX(COALESCE(c.expires_at, datetime(c.created_at, '+1 day')))
  FROM conversations c
  WHERE c.visitor_id = visitors.id
)
WHERE EXISTS (
  SELECT 1 FROM conversations c WHERE c.visitor_id = visitors.id
)
AND (
  expires_at IS NULL
  OR datetime(expires_at) < datetime((
    SELECT MAX(COALESCE(c.expires_at, datetime(c.created_at, '+1 day')))
    FROM conversations c
    WHERE c.visitor_id = visitors.id
  ))
);
