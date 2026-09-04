PRAGMA foreign_keys = ON;

ALTER TABLE agent_push_subscriptions ADD COLUMN p256dh TEXT;
ALTER TABLE agent_push_subscriptions ADD COLUMN auth TEXT;

