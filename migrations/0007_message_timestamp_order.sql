PRAGMA foreign_keys = ON;

-- Visitor messages already use ISO-8601 timestamps, while legacy agent messages
-- used SQLite CURRENT_TIMESTAMP. Mixing "T" and space-separated timestamps makes
-- TEXT ordering group messages by sender path instead of real chronology.
UPDATE messages
SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
WHERE instr(created_at, 'T') = 0;

DROP TRIGGER IF EXISTS trg_messages_normalize_created_at;
CREATE TRIGGER trg_messages_normalize_created_at
AFTER INSERT ON messages
FOR EACH ROW
WHEN instr(NEW.created_at, 'T') = 0
BEGIN
  UPDATE messages
  SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE rowid = NEW.rowid;
END;
