PRAGMA foreign_keys = ON;

CREATE TABLE agent_quick_replies (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX idx_agent_quick_replies_agent_order
  ON agent_quick_replies(agent_id, enabled, sort_order, id);
