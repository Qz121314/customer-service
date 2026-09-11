PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS h5_page_content (
  site_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  draft_asset_id TEXT,
  draft_byte_size INTEGER CHECK (draft_byte_size IS NULL OR draft_byte_size > 0),
  draft_uploaded_at TEXT,
  published_asset_id TEXT,
  published_byte_size INTEGER
    CHECK (published_byte_size IS NULL OR published_byte_size > 0),
  published_at TEXT,
  PRIMARY KEY (site_id, page_id),
  FOREIGN KEY (site_id, page_id)
    REFERENCES h5_product_catalog(site_id, id)
    ON DELETE CASCADE
);
