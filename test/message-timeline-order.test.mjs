import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const migration = await readFile(
  new URL('../migrations/0007_message_timestamp_order.sql', import.meta.url),
  'utf8',
);

test('message timestamps are normalized before text ordering is used', () => {
  assert.match(
    migration,
    /UPDATE messages[\s\S]*strftime\('%Y-%m-%dT%H:%M:%fZ', created_at\)/u,
  );
  assert.match(migration, /WHERE instr\(created_at, 'T'\) = 0/u);
});

test('future non-ISO message timestamps are normalized on insert', () => {
  assert.match(migration, /CREATE TRIGGER trg_messages_normalize_created_at/u);
  assert.match(migration, /AFTER INSERT ON messages/u);
  assert.match(migration, /WHEN instr\(NEW\.created_at, 'T'\) = 0/u);
  assert.match(migration, /strftime\('%Y-%m-%dT%H:%M:%fZ', 'now'\)/u);
});
