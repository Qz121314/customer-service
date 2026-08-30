PRAGMA foreign_keys = ON;

-- Store the administrator-authored no-agent response per product/site. The raw
-- Markdown is retained so the visitor client can render it with its own safe
-- Markdown policy.
ALTER TABLE sites
  ADD COLUMN no_agent_message TEXT NOT NULL
    DEFAULT '当前暂无可用客服，请稍后再试。';

ALTER TABLE sites
  ADD COLUMN no_agent_message_format TEXT NOT NULL
    DEFAULT 'plain'
    CHECK (no_agent_message_format IN ('plain', 'markdown'));
