import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const migration = readFileSync(
  new URL(
    '../migrations/0027_move_reporting_retention_to_cron.sql',
    import.meta.url,
  ),
  'utf8',
);
const retentionSource = readFileSync(
  new URL('../src/worker/conversation-retention.ts', import.meta.url),
  'utf8',
);

// Keep historical pruning out of the first-reception transaction as the
// reporting tables grow; cron owns that low-frequency maintenance cost.
test('assignment trigger does not prune reporting history on every reception', () => {
  assert.match(
    migration,
    /CREATE TRIGGER trg_conversation_assignment_daily_stats/u,
  );
  assert.match(migration, /INSERT OR IGNORE INTO agent_traffic_receipts/u);
  assert.match(migration, /INSERT INTO agent_daily_stats/u);
  assert.doesNotMatch(migration, /DELETE FROM agent_daily_stats/u);
  assert.doesNotMatch(migration, /DELETE FROM agent_traffic_receipts/u);
});

test('scheduled reporting retention uses indexed site and business date predicates', () => {
  assert.match(retentionSource, /REPORTING_HISTORY_CLEANUP_UTC_HOUR = 12/u);
  assert.match(
    retentionSource,
    /DELETE FROM agent_daily_stats\s+WHERE site_id = 'default'\s+AND business_date < date\(\?1, '-399 days'\)/u,
  );
  assert.match(
    retentionSource,
    /DELETE FROM agent_traffic_receipts\s+WHERE site_id = 'default'\s+AND business_date < date\(\?1, '-399 days'\)/u,
  );
});
