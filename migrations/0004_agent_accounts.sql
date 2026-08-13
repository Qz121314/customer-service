PRAGMA foreign_keys = ON;

ALTER TABLE agents ADD COLUMN username TEXT;
ALTER TABLE agents ADD COLUMN password_hash TEXT;
ALTER TABLE agents ADD COLUMN password_salt TEXT;
ALTER TABLE agents ADD COLUMN last_login_at TEXT;
ALTER TABLE agents ADD COLUMN last_seen_at TEXT;

CREATE UNIQUE INDEX idx_agents_username
  ON agents(lower(username))
  WHERE username IS NOT NULL;

CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX idx_agent_sessions_agent_expiry
  ON agent_sessions(agent_id, expires_at);

-- The legacy shared "admin" agent was only a bridge while the real seat-account
-- model was being built. Keep the row for historical references, but remove it
-- from routing and force it offline.
DELETE FROM group_agents WHERE agent_id = 'admin';
UPDATE agents
SET is_enabled = 0,
    status = 'offline',
    last_seen_at = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'admin';
