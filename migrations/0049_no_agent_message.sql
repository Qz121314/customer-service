PRAGMA foreign_keys = ON;

-- New CTA attempts are no longer persisted as waiting conversations. The
-- Storefront receives this administrator-owned message when no eligible seat
-- can accept the product immediately.
ALTER TABLE sites
  ADD COLUMN no_agent_message TEXT NOT NULL
  DEFAULT '当前暂无客服可接待，请稍后再试。'
  CHECK (
    length(trim(no_agent_message)) BETWEEN 1 AND 500
  );

-- No runtime query scans unassigned conversations after waiting recovery is
-- removed.
DROP INDEX IF EXISTS idx_conversations_waiting_assignment;
