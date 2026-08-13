PRAGMA foreign_keys = ON;

-- Display names are labels, not identities. Login usernames remain unique.
DROP INDEX IF EXISTS idx_agents_site_name;
CREATE INDEX IF NOT EXISTS idx_agents_site_name
  ON agents(site_id, name);
