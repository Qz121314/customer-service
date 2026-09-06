import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const assignmentMigration = readFileSync(
  new URL(
    '../migrations/0027_move_reporting_retention_to_cron.sql',
    import.meta.url,
  ),
  'utf8',
);
const rollupMigration = readFileSync(
  new URL('../migrations/0061_traffic_daily_rollups.sql', import.meta.url),
  'utf8',
);
const retentionSource = readFileSync(
  new URL('../src/worker/conversation-retention.ts', import.meta.url),
  'utf8',
);
const trafficStatisticsSource = readFileSync(
  new URL('../src/worker/traffic-statistics.ts', import.meta.url),
  'utf8',
);
const clientApiSource = readFileSync(
  new URL('../src/worker/client-api.ts', import.meta.url),
  'utf8',
);
const agentApiSource = readFileSync(
  new URL('../src/worker/agent-api.ts', import.meta.url),
  'utf8',
);

// Keep historical pruning out of the first-reception transaction as the
// reporting tables grow; cron owns that low-frequency maintenance cost.
test('assignment trigger does not prune reporting history on every reception', () => {
  assert.match(
    assignmentMigration,
    /CREATE TRIGGER trg_conversation_assignment_daily_stats/u,
  );
  assert.match(
    assignmentMigration,
    /INSERT OR IGNORE INTO agent_traffic_receipts/u,
  );
  assert.match(assignmentMigration, /INSERT INTO agent_daily_stats/u);
  assert.doesNotMatch(assignmentMigration, /DELETE FROM agent_daily_stats/u);
  assert.doesNotMatch(
    assignmentMigration,
    /DELETE FROM agent_traffic_receipts/u,
  );
});

test('dashboard rollups add zero visitor-create and assignment hot-path writes', () => {
  assert.doesNotMatch(rollupMigration, /CREATE TRIGGER/iu);
  assert.doesNotMatch(clientApiSource, /traffic_daily_rollups/u);
  assert.doesNotMatch(agentApiSource, /traffic_daily_rollups/u);
  assert.match(
    retentionSource,
    /rebuildTrafficDailyRollups\(env\.DB, nowIso\.slice\(0, 10\)\)/u,
  );
  assert.match(
    trafficStatisticsSource,
    /for \(\s*let offset = 1;\s*offset <= TRAFFIC_STATS_LIVE_BUSINESS_DAYS/u,
  );
});

test('scheduled reporting retention uses indexed site and business date predicates', () => {
  assert.match(retentionSource, /REPORTING_HISTORY_CLEANUP_UTC_HOUR = 12/u);
  assert.match(
    retentionSource,
    /DELETE FROM agent_daily_stats\s+WHERE site_id = 'default'\s+AND business_date < date\(\?1, '-89 days'\)/u,
  );
  assert.match(
    retentionSource,
    /DELETE FROM agent_traffic_receipts\s+WHERE site_id = 'default'\s+AND business_date < date\(\?1, '-89 days'\)/u,
  );
  assert.match(
    retentionSource,
    /DELETE FROM conversation_traffic_receipts\s+WHERE site_id = 'default'\s+AND business_date < date\(\?1, '-89 days'\)/u,
  );
  assert.match(
    retentionSource,
    /DELETE FROM traffic_daily_rollups\s+WHERE site_id = 'default'\s+AND business_date < date\(\?1, '-89 days'\)/u,
  );
  assert.match(
    agentApiSource,
    /date\.setUTCDate\(date\.getUTCDate\(\) - 89\)/u,
  );
});
