import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

// Keep active-load aggregation candidate-scoped as the conversation table grows.
test('agent active conversation reads use a dedicated partial index', () => {
  const migration = source(
    '../migrations/0028_conversation_agent_status_index.sql',
  );

  assert.match(migration, /idx_conversations_agent_status/u);
  assert.match(migration, /assigned_agent, status/u);
  assert.match(migration, /WHERE assigned_agent IS NOT NULL/u);
});
