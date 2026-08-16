-- Quick replies are a per-browser agent productivity preference.
-- Keeping them out of D1 removes a read from inbox/heartbeat hot paths and
-- avoids server writes for data that does not need cross-device sync.
DROP TABLE IF EXISTS agent_quick_replies;
