PRAGMA foreign_keys = ON;

-- A CTA start key is stable for one site + visitor + product. The unique index
-- is the final concurrency guard when two browser tabs start the same product at
-- the same time.
ALTER TABLE conversations
  ADD COLUMN start_reuse_key TEXT;

CREATE UNIQUE INDEX idx_conversations_start_reuse_key
  ON conversations(site_id, start_reuse_key)
  WHERE start_reuse_key IS NOT NULL;

CREATE INDEX idx_conversations_visitor_product_activity
  ON conversations(site_id, visitor_id, product_id, last_message_at DESC)
  WHERE product_id IS NOT NULL;

-- One logical CTA start consumes the visitor/source quota only once, even when
-- concurrent requests arrive before either request has returned.
CREATE TABLE conversation_creation_quota_receipts (
  site_id TEXT NOT NULL,
  reuse_key TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, reuse_key),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE INDEX idx_conversation_quota_receipts_expiry
  ON conversation_creation_quota_receipts(expires_at);

-- Coalescing several handoff IDs into one conversation must preserve retry
-- idempotency for every handoff, not only the first one stored on conversations.
CREATE TABLE conversation_source_handoffs (
  site_id TEXT NOT NULL,
  source_handoff_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, source_handoff_id),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_conversation_source_handoffs_conversation
  ON conversation_source_handoffs(conversation_id);

INSERT OR IGNORE INTO conversation_source_handoffs (
  site_id, source_handoff_id, conversation_id, created_at
)
SELECT site_id, source_handoff_id, id, created_at
FROM conversations
WHERE source_handoff_id IS NOT NULL;

-- A resolved conversation may start a new thread immediately. The route still
-- remembers its previous agent for the two-hour affinity preference.
CREATE TRIGGER trg_conversation_close_release_start_key
AFTER UPDATE OF status ON conversations
WHEN NEW.status = 'closed'
  AND OLD.status <> 'closed'
  AND NEW.start_reuse_key IS NOT NULL
BEGIN
  UPDATE conversations
  SET start_reuse_key = NULL
  WHERE id = NEW.id;
END;
