PRAGMA foreign_keys = ON;

CREATE TABLE agent_quota_adjustments (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  quota_total_before INTEGER NOT NULL CHECK (quota_total_before >= 0),
  quota_total_after INTEGER NOT NULL CHECK (quota_total_after >= quota_total_before),
  applied_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_agent_quota_adjustments_request
  ON agent_quota_adjustments(site_id, agent_id, request_id);

CREATE INDEX idx_agent_quota_adjustments_history
  ON agent_quota_adjustments(site_id, agent_id, created_at DESC, id DESC)
  WHERE applied_at IS NOT NULL;

CREATE INDEX idx_conversations_waiting_assignment
  ON conversations(status, last_message_at ASC, id ASC)
  WHERE assigned_agent IS NULL;
