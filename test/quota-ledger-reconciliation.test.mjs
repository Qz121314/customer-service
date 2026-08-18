import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { URL } from 'node:url';

const migration = await readFile(
  new URL('../migrations/0034_agent_quota_ledger_baselines.sql', import.meta.url),
  'utf8',
);

function createDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      traffic_quota_total INTEGER NOT NULL DEFAULT 0,
      traffic_quota_used INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE agent_quota_adjustments (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      applied_at TEXT
    );
    CREATE TABLE agent_traffic_receipts (
      conversation_id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      quota_consumed INTEGER NOT NULL DEFAULT -1
    );
  `);
  return database;
}

function ledger(database, agentId) {
  return database
    .prepare(
      `SELECT
         agent.traffic_quota_total AS total,
         agent.traffic_quota_used AS used,
         agent.traffic_quota_total_baseline + COALESCE((
           SELECT SUM(amount)
           FROM agent_quota_adjustments adjustment
           WHERE adjustment.site_id = agent.site_id
             AND adjustment.agent_id = agent.id
             AND adjustment.applied_at IS NOT NULL
         ), 0) AS expected_total,
         agent.traffic_quota_archived_used + COALESCE((
           SELECT COUNT(*)
           FROM agent_traffic_receipts receipt
           WHERE receipt.site_id = agent.site_id
             AND receipt.agent_id = agent.id
             AND receipt.quota_consumed = 1
         ), 0) AS expected_used,
         agent.traffic_quota_total_baseline AS total_baseline,
         agent.traffic_quota_archived_used AS archived_used
       FROM agents agent
       WHERE agent.id = ?`,
    )
    .get(agentId);
}

test('quota ledger migration preserves lifetime counters with explicit baselines', () => {
  const database = createDatabase();
  database.exec(`
    INSERT INTO agents (id, site_id, traffic_quota_total, traffic_quota_used)
    VALUES ('agent-ok', 'default', 150, 3);
    INSERT INTO agent_quota_adjustments (
      id, site_id, agent_id, amount, applied_at
    ) VALUES ('topup-1', 'default', 'agent-ok', 100, CURRENT_TIMESTAMP);
    INSERT INTO agent_traffic_receipts (
      conversation_id, site_id, agent_id, quota_consumed
    ) VALUES
      ('paid-1', 'default', 'agent-ok', 1),
      ('paid-2', 'default', 'agent-ok', 1),
      ('unlimited-1', 'default', 'agent-ok', -1);
  `);

  database.exec(migration);
  const result = ledger(database, 'agent-ok');

  assert.equal(result.total_baseline, 50);
  assert.equal(result.archived_used, 1);
  assert.equal(result.expected_total, result.total);
  assert.equal(result.expected_used, result.used);
  database.close();
});

test('baseline initialization never hides pre-existing counter mismatches', () => {
  const database = createDatabase();
  database.exec(`
    INSERT INTO agents (id, site_id, traffic_quota_total, traffic_quota_used)
    VALUES ('agent-drift', 'default', 50, 1);
    INSERT INTO agent_quota_adjustments (
      id, site_id, agent_id, amount, applied_at
    ) VALUES ('topup-drift', 'default', 'agent-drift', 100, CURRENT_TIMESTAMP);
    INSERT INTO agent_traffic_receipts (
      conversation_id, site_id, agent_id, quota_consumed
    ) VALUES
      ('paid-drift-1', 'default', 'agent-drift', 1),
      ('paid-drift-2', 'default', 'agent-drift', 1);
  `);

  database.exec(migration);
  const result = ledger(database, 'agent-drift');

  assert.equal(result.total_baseline, 0);
  assert.equal(result.archived_used, 0);
  assert.equal(result.total, 50);
  assert.equal(result.expected_total, 100);
  assert.equal(result.used, 1);
  assert.equal(result.expected_used, 2);
  database.close();
});
