PRAGMA foreign_keys = ON;

-- The product has no waiting queue or recovery scan. Runtime assignment and
-- no-agent cleanup address one conversation by primary key, so the historical
-- ordered partial index has no production query consumer.
DROP INDEX IF EXISTS idx_conversations_waiting_assignment;
