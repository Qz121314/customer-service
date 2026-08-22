PRAGMA foreign_keys = ON;

-- A closed conversation may create a fresh thread, but the visitor + product
-- pair must stay with its already-selected agent for the remaining two-hour
-- protection window. Routing treats this as a hard constraint, not a preference.
ALTER TABLE conversations
  ADD COLUMN cta_affinity_agent_id TEXT;

ALTER TABLE conversations
  ADD COLUMN cta_affinity_expires_at TEXT;

CREATE INDEX idx_conversations_cta_affinity
  ON conversations(
    site_id,
    cta_affinity_agent_id,
    cta_affinity_expires_at
  )
  WHERE cta_affinity_agent_id IS NOT NULL;
