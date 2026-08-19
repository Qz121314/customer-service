PRAGMA foreign_keys = ON;

-- Conversation expiry became authoritative during the lifecycle rollout. Repair
-- any pre-rollout/null rows once more before runtime queries rely directly on
-- expires_at, allowing idx_conversations_expiry to serve the hot paths without
-- wrapping the indexed column in COALESCE/datetime expressions.
UPDATE conversations
SET expires_at = datetime(created_at, '+1 day')
WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_expiry
  ON conversations(expires_at);
