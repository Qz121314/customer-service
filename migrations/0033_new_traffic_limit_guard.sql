PRAGMA foreign_keys = ON;

-- Daily and paid traffic limits protect only a conversation's first effective
-- seat receipt. Requeues and transfers already have an immutable receipt and
-- therefore must not consume or require another new-traffic unit.
DROP TRIGGER IF EXISTS trg_conversation_new_traffic_limit_guard;
CREATE TRIGGER trg_conversation_new_traffic_limit_guard
BEFORE UPDATE OF assigned_agent ON conversations
WHEN NEW.assigned_agent IS NOT NULL
  AND (
    OLD.assigned_agent IS NULL
    OR OLD.assigned_agent <> NEW.assigned_agent
  )
  AND NOT EXISTS (
    SELECT 1
    FROM agent_traffic_receipts receipt
    WHERE receipt.conversation_id = NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'AGENT_NEW_TRAFFIC_LIMIT_EXHAUSTED')
  WHERE EXISTS (
    SELECT 1
    FROM agents target
    LEFT JOIN agent_daily_stats daily
      ON daily.site_id = target.site_id
     AND daily.agent_id = target.id
     AND daily.business_date = NEW.assigned_business_date
    WHERE target.id = NEW.assigned_agent
      AND target.site_id = NEW.site_id
      AND (
        (
          target.daily_conversation_limit > 0
          AND COALESCE(daily.conversation_count, 0) >= target.daily_conversation_limit
        )
        OR (
          target.traffic_quota_enabled = 1
          AND target.traffic_quota_used >= target.traffic_quota_total
        )
      )
  );
END;
