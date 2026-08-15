PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agent_push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  expiration_time INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_push_subscriptions_agent
  ON agent_push_subscriptions(agent_id, updated_at DESC);
