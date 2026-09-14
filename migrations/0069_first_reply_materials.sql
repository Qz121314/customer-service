PRAGMA foreign_keys = ON;

CREATE TABLE agent_greeting_presets (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE agent_cta_presets (
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

CREATE TABLE agent_first_reply_profiles (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  name TEXT NOT NULL,
  greeting_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (greeting_id) REFERENCES agent_greeting_presets(id) ON DELETE SET NULL
);

CREATE TABLE agent_first_reply_profile_attachments (
  profile_id TEXT NOT NULL,
  preset_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_id, preset_id),
  FOREIGN KEY (profile_id) REFERENCES agent_first_reply_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (preset_id) REFERENCES agent_attachment_presets(id) ON DELETE CASCADE
);

CREATE TABLE agent_first_reply_profile_ctas (
  profile_id TEXT NOT NULL,
  cta_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_id, cta_id),
  FOREIGN KEY (profile_id) REFERENCES agent_first_reply_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (cta_id) REFERENCES agent_cta_presets(id) ON DELETE CASCADE
);

CREATE INDEX idx_agent_greeting_presets_agent_order
  ON agent_greeting_presets(agent_id, sort_order, id);
CREATE INDEX idx_agent_cta_presets_agent_order
  ON agent_cta_presets(agent_id, enabled, sort_order, id);
CREATE INDEX idx_agent_first_reply_profiles_agent_order
  ON agent_first_reply_profiles(agent_id, is_active, sort_order, id);
CREATE INDEX idx_agent_first_reply_profile_attachments_order
  ON agent_first_reply_profile_attachments(profile_id, sort_order, preset_id);
CREATE INDEX idx_agent_first_reply_profile_ctas_order
  ON agent_first_reply_profile_ctas(profile_id, sort_order, cta_id);
