PRAGMA foreign_keys = ON;

CREATE TABLE visitor_phone_numbers (
  number TEXT PRIMARY KEY,
  first_collected_at TEXT NOT NULL
);

CREATE INDEX idx_visitor_phone_numbers_collected_at
  ON visitor_phone_numbers(first_collected_at, number);

CREATE TABLE visitor_phone_collection_scans (
  message_id TEXT PRIMARY KEY,
  scanned_at TEXT NOT NULL
);

CREATE INDEX idx_visitor_phone_collection_scans_scanned_at
  ON visitor_phone_collection_scans(scanned_at);

CREATE TABLE visitor_phone_download_logs (
  id TEXT PRIMARY KEY,
  downloaded_at TEXT NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count >= 0)
);

CREATE INDEX idx_visitor_phone_download_logs_downloaded_at
  ON visitor_phone_download_logs(downloaded_at DESC, id DESC);
