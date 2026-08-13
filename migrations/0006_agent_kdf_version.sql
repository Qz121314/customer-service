PRAGMA foreign_keys = ON;

ALTER TABLE agents
  ADD COLUMN password_iterations INTEGER NOT NULL DEFAULT 120000
  CHECK (password_iterations >= 1000);
