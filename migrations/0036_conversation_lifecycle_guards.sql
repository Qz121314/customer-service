PRAGMA foreign_keys = ON;

-- A manual requeue should not silently return to the same seat on that seat's
-- next heartbeat. The exclusion lives only while the conversation is unassigned
-- and is cleared automatically as soon as another seat accepts it.
ALTER TABLE conversations
  ADD COLUMN requeue_excluded_agent_id TEXT;

-- Only an enabled seat explicitly releasing its own conversation creates a
-- requeue exclusion. Administrative disable/reassignment first disables the
-- agent, so that system lifecycle is intentionally not treated as manual requeue.
CREATE TRIGGER trg_conversation_requeue_exclusion
AFTER UPDATE OF assigned_agent ON conversations
WHEN OLD.assigned_agent IS NOT NULL
  AND NEW.assigned_agent IS NULL
  AND EXISTS (
    SELECT 1
    FROM agents agent
    WHERE agent.id = OLD.assigned_agent
      AND agent.site_id = NEW.site_id
      AND agent.is_enabled = 1
  )
BEGIN
  UPDATE conversations
  SET requeue_excluded_agent_id = OLD.assigned_agent
  WHERE id = NEW.id;
END;

-- Every ownership change is a seat-attention event. Reuse the existing unread
-- counter rather than adding another notification state machine. MAX preserves
-- real unread visitor-message counts while giving a newly receiving seat one
-- visible attention marker when the previous seat had already read everything.
CREATE TRIGGER trg_conversation_assignment_attention
AFTER UPDATE OF assigned_agent ON conversations
WHEN NEW.assigned_agent IS NOT NULL
  AND (
    OLD.assigned_agent IS NULL
    OR OLD.assigned_agent <> NEW.assigned_agent
  )
BEGIN
  UPDATE conversations
  SET requeue_excluded_agent_id = NULL,
      agent_unread_count = MAX(agent_unread_count, 1)
  WHERE id = NEW.id;
END;

-- Closing a conversation releases active capacity and can immediately admit
-- another waiting consultation. Reopening the closed item must therefore claim
-- capacity again atomically, otherwise one seat can exceed its configured active
-- limit after close -> refill -> reopen.
CREATE TRIGGER trg_conversation_reopen_capacity
BEFORE UPDATE OF status ON conversations
WHEN OLD.status = 'closed'
  AND NEW.status IN ('open', 'pending')
  AND OLD.assigned_agent IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM agents owner
    WHERE owner.id = OLD.assigned_agent
      AND owner.site_id = OLD.site_id
      AND owner.max_active_conversations > 0
      AND (
        SELECT COUNT(*)
        FROM conversations active
        WHERE active.site_id = OLD.site_id
          AND active.assigned_agent = OLD.assigned_agent
          AND active.id <> OLD.id
          AND active.status IN ('open', 'pending')
          AND COALESCE(
            active.expires_at,
            datetime(active.created_at, '+1 day')
          ) > CURRENT_TIMESTAMP
      ) >= owner.max_active_conversations
  )
BEGIN
  SELECT RAISE(ABORT, 'CONVERSATION_REOPEN_CAPACITY');
END;
