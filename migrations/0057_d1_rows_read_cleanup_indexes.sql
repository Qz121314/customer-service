PRAGMA foreign_keys = ON;

-- One partial queue index serves both cleanup states. The OR predicate lets
-- SQLite prove that either status-specific query can use the index, while one
-- CREATE INDEX halves the full-table build work during production migration.
-- Ready media stays out, avoiding permanent write and storage amplification.
CREATE INDEX IF NOT EXISTS idx_media_items_cleanup_queue
  ON media_items(status, updated_at, id)
  WHERE status = 'pending' OR status = 'failed';
