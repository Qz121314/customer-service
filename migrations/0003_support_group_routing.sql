PRAGMA foreign_keys = ON;

ALTER TABLE support_groups
  ADD COLUMN routing_strategy TEXT NOT NULL DEFAULT 'least_active'
  CHECK (routing_strategy IN ('least_active'));

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offline'
    CHECK (status IN ('online', 'busy', 'offline')),
  is_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (is_enabled IN (0, 1)),
  max_active_conversations INTEGER NOT NULL DEFAULT 0
    CHECK (max_active_conversations >= 0),
  last_assigned_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_agents_site_name
  ON agents(site_id, lower(name));
CREATE INDEX idx_agents_site_availability
  ON agents(site_id, is_enabled, status, last_assigned_at);

CREATE TABLE group_agents (
  site_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  is_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (is_enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, group_id, agent_id),
  FOREIGN KEY (site_id, group_id)
    REFERENCES support_groups(site_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX idx_group_agents_routing
  ON group_agents(site_id, group_id, is_enabled, priority DESC, agent_id);

CREATE INDEX idx_conversations_group_assignment
  ON conversations(site_id, group_id, status, assigned_agent, last_message_at DESC);

-- Keep the existing single-admin workflow usable while the agent management UI
-- is introduced. The logical admin agent can later be disabled or replaced.
INSERT OR IGNORE INTO agents (
  id, site_id, name, status, is_enabled, max_active_conversations
)
VALUES ('admin', 'default', '默认客服', 'online', 1, 0);

INSERT OR IGNORE INTO group_agents (
  site_id, group_id, agent_id, priority, is_enabled
)
VALUES ('default', 'general', 'admin', 0, 1);
