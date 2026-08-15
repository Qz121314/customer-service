PRAGMA foreign_keys = ON;

ALTER TABLE media_items
ADD COLUMN client_upload_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_items_client_upload
  ON media_items(conversation_id, sender_type, sender_id, client_upload_id)
  WHERE client_upload_id IS NOT NULL;
