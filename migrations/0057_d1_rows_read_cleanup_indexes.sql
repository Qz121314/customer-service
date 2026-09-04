PRAGMA foreign_keys = ON;

-- Hourly retention only needs to range-scan media rows that are still pending
-- or have already failed. Keep ready rows out of these indexes so the cleanup
-- read win does not turn into permanent write amplification on chat media.
CREATE INDEX IF NOT EXISTS idx_media_items_pending_cleanup
  ON media_items(updated_at, id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_media_items_failed_cleanup
  ON media_items(updated_at, id)
  WHERE status = 'failed';
