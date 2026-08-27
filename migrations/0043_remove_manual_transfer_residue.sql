PRAGMA foreign_keys = ON;

-- Manual transfer has been removed. The requeue exclusion column was only
-- used by that feature and is no longer part of the runtime routing model.
ALTER TABLE conversations DROP COLUMN requeue_excluded_agent_id;
