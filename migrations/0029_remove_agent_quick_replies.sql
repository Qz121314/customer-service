-- Quick replies are intentionally browser-local convenience data.
-- Remove the old D1 table so no server-side persistence remains.
DROP TABLE IF EXISTS agent_quick_replies;
