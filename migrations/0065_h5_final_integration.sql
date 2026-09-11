PRAGMA foreign_keys = ON;

ALTER TABLE h5_settings ADD COLUMN chat_public_origin TEXT;

ALTER TABLE conversation_traffic_receipts
  ADD COLUMN h5_conversion_pool_id TEXT;

DROP TRIGGER IF EXISTS trg_conversation_start_traffic_receipt;
CREATE TRIGGER trg_conversation_start_traffic_receipt
AFTER INSERT ON conversations
WHEN NEW.started_business_date IS NOT NULL
  AND NEW.started_business_date <> ''
BEGIN
  INSERT OR IGNORE INTO conversation_traffic_receipts (
    conversation_id, site_id, business_date, product_id, product_title,
    h5_conversion_pool_id, started_at
  )
  SELECT NEW.id, NEW.site_id, NEW.started_business_date, NEW.product_id,
    NEW.product_title, p.conversion_pool_id, NEW.created_at
  FROM h5_product_catalog p
  WHERE p.site_id = NEW.site_id AND p.id = NEW.product_id
    AND NEW.product_id LIKE 'h5:product:%';

  INSERT OR IGNORE INTO conversation_traffic_receipts (
    conversation_id, site_id, business_date, product_id, product_title,
    started_at
  )
  SELECT NEW.id, NEW.site_id, NEW.started_business_date, NEW.product_id,
    NEW.product_title, NEW.created_at
  WHERE NEW.product_id IS NULL OR NEW.product_id NOT LIKE 'h5:product:%';
END;

CREATE INDEX IF NOT EXISTS idx_conversation_traffic_receipts_h5_pool
  ON conversation_traffic_receipts(site_id, h5_conversion_pool_id, business_date);
