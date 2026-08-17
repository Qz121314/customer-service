-- Quick replies are browser-local only. The compatibility view introduced by
-- 0029 is no longer referenced by runtime code, so remove it from the final schema.
DROP VIEW IF EXISTS agent_quick_replies;
