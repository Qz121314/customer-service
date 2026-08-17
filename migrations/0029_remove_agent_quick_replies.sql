-- Quick replies are intentionally browser-local convenience data.
-- Remove the old D1 table so no server-side quick-reply rows can persist.
DROP TABLE IF EXISTS agent_quick_replies;

-- Keep an empty read-only compatibility surface for isolated handler tests and
-- stale internal code paths. Production inbox requests bypass this SELECT in
-- memory, and legacy write routes are blocked before reaching the agent API.
CREATE VIEW agent_quick_replies AS
SELECT
  CAST(NULL AS TEXT) AS id,
  CAST(NULL AS TEXT) AS agent_id,
  CAST(NULL AS TEXT) AS title,
  CAST(NULL AS TEXT) AS body,
  CAST(NULL AS TEXT) AS updated_at
WHERE 0;
