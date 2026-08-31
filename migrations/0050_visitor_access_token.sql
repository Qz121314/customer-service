PRAGMA foreign_keys = ON;

-- Keep the existing visitor identifier for rollout compatibility, but give the
-- browser a high-entropy credential for conversation reads, writes and sockets.
-- Existing rows are upgraded the first time a client supplies a token.
ALTER TABLE visitors ADD COLUMN access_token_hash TEXT;

CREATE UNIQUE INDEX idx_visitors_access_token_hash
  ON visitors(access_token_hash)
  WHERE access_token_hash IS NOT NULL;
