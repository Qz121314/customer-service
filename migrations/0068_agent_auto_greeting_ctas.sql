PRAGMA foreign_keys = ON;

CREATE TABLE agent_auto_greeting_ctas (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  label TEXT NOT NULL,
  answer TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

INSERT INTO agent_auto_greeting_ctas (
  id, agent_id, label, answer, enabled, sort_order, created_at, updated_at
)
SELECT id, agent_id, question, answer, enabled, sort_order, created_at, updated_at
FROM agent_quick_replies;

DROP TABLE agent_quick_replies;

CREATE INDEX idx_agent_auto_greeting_ctas_agent_order
  ON agent_auto_greeting_ctas(agent_id, enabled, sort_order, id);
