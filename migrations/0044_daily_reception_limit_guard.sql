PRAGMA foreign_keys = ON;

-- Daily reception limits are a hard boundary for fresh traffic. Keep the guard
-- in D1 so concurrent first-assignment attempts cannot push a seat beyond its
-- Los Angeles business-day cap. A value of 0 means unlimited. Conversations
-- that already have an immutable reception receipt may be recovered after a
-- seat is disabled without consuming a second daily unit.
DROP TRIGGER IF EXISTS trg_conversation_daily_reception_limit_guard;
CREATE TRIGGER trg_conversation_daily_reception_limit_guard
BEFORE UPDATE OF assigned_agent ON conversations
WHEN NEW.assigned_agent IS NOT NULL
  AND (
    OLD.assigned_agent IS NULL
    OR OLD.assigned_agent <> NEW.assigned_agent
  )
  AND NEW.assigned_business_date IS NOT NULL
  AND NEW.assigned_business_date <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM agent_traffic_receipts receipt
    WHERE receipt.conversation_id = NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'AGENT_DAILY_RECEPTION_LIMIT_EXHAUSTED')
  WHERE EXISTS (
    SELECT 1
    FROM agents target
    WHERE target.id = NEW.assigned_agent
      AND target.site_id = NEW.site_id
      AND target.daily_conversation_limit > 0
      AND COALESCE((
        SELECT daily.conversation_count
        FROM agent_daily_stats daily
        WHERE daily.site_id = target.site_id
          AND daily.agent_id = target.id
          AND daily.business_date = NEW.assigned_business_date
        LIMIT 1
      ), 0) >= target.daily_conversation_limit
  );
END;
