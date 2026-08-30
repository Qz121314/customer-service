PRAGMA foreign_keys = ON;

-- New consultations no longer enter a waiting queue when routing has no eligible
-- seat. The Worker rejects that start immediately and returns this administrator-
-- controlled visitor message instead.
ALTER TABLE sites
  ADD COLUMN no_agent_message TEXT NOT NULL
  DEFAULT '当前暂无可接待客服，请稍后再试。';

-- Remove legacy unassigned active rows so they cannot be revived after the new
-- no-waiting contract is deployed. Related messages and source handoffs cascade.
DELETE FROM conversations
WHERE assigned_agent IS NULL
  AND status IN ('open', 'pending');
