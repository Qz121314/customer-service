import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { URL } from 'node:url';

const migrationsDirectory = new URL('../migrations/', import.meta.url);
const FIXED_TODAY = '2026-09-05';
const RETAINED_FROM = '2026-06-08';

const LEGACY_TRAFFIC_STATS_SQL = `WITH scoped AS MATERIALIZED (
       SELECT product_id, product_title, agent_id, agent_name
       FROM conversation_traffic_receipts
       WHERE site_id = 'default'
         AND business_date >= ?1
         AND business_date <= ?2
     )
     SELECT 'summary' AS dimension,
       NULL AS item_id,
       NULL AS item_name,
       COUNT(*) AS count
     FROM scoped
     UNION ALL
     SELECT 'agent' AS dimension,
       COALESCE(agent_id, '__pending__') AS item_id,
       COALESCE(MAX(NULLIF(TRIM(agent_name), '')), '待接待') AS item_name,
       COUNT(*) AS count
     FROM scoped
     GROUP BY agent_id
     UNION ALL
     SELECT 'product' AS dimension,
       COALESCE(product_id, '__unknown__') AS item_id,
       COALESCE(MAX(NULLIF(TRIM(product_title), '')), '未知产品') AS item_name,
       COUNT(*) AS count
     FROM scoped
     GROUP BY product_id
     ORDER BY dimension ASC, count DESC, item_name ASC`;

function createMigratedDatabase() {
  const database = new DatabaseSync(':memory:');
  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const filename of migrationFiles) {
    database.exec(readFileSync(new URL(filename, migrationsDirectory), 'utf8'));
  }
  return database;
}

function dateShift(day, offset) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function seedReceipts(database, rowCount) {
  const insert = database.prepare(
    `INSERT INTO conversation_traffic_receipts (
       conversation_id, site_id, business_date,
       product_id, product_title, agent_id, agent_name, started_at
     ) VALUES (?1, 'default', ?2, ?3, ?4, ?5, ?6, ?7)`,
  );
  database.exec('BEGIN');
  try {
    for (let index = 0; index < rowCount; index += 1) {
      const dayIndex = index % 90;
      const businessDate = dateShift(RETAINED_FROM, dayIndex);
      const productBucket = index % 9;
      const agentBucket = index % 7;
      const productId = productBucket === 0 ? null : `product-${productBucket}`;
      const agentId = agentBucket === 0 ? null : `agent-${agentBucket}`;
      insert.run(
        `baseline-${rowCount}-${index}`,
        businessDate,
        productId,
        productId ? `Product ${productBucket}` : null,
        agentId,
        agentId ? `Agent ${agentBucket}` : null,
        `${businessDate}T12:00:00.000Z`,
      );
    }
    database.exec('COMMIT; ANALYZE;');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function explain(database, sql, bindings) {
  return database
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...bindings)
    .map((row) => String(row.detail));
}

function rawRows(database, from, to) {
  return Number(
    database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM conversation_traffic_receipts
         WHERE site_id = 'default'
           AND business_date >= ?1
           AND business_date <= ?2`,
      )
      .get(from, to).count,
  );
}

function assertUsesReceiptDateIndex(plan) {
  assert.ok(
    plan.some(
      (detail) =>
        detail.includes('SEARCH conversation_traffic_receipts USING INDEX') &&
        detail.includes('idx_conversation_traffic_receipts_date'),
    ),
    `expected receipt date index; got:\n${plan.join('\n')}`,
  );
}

test('phase 11 records the legacy 1/7/30/90-day raw read baseline at 10k and 50k scale', () => {
  for (const rowCount of [10_080, 50_400]) {
    const database = createMigratedDatabase();
    seedReceipts(database, rowCount);

    for (const days of [1, 7, 30, 90]) {
      const from = dateShift(FIXED_TODAY, -(days - 1));
      const plan = explain(database, LEGACY_TRAFFIC_STATS_SQL, [from, FIXED_TODAY]);
      assertUsesReceiptDateIndex(plan);
      const rows = rawRows(database, from, FIXED_TODAY);
      const expectedRows = (rowCount / 90) * days;
      assert.equal(rows, expectedRows);
      console.log(
        `phase11 legacy baseline receipts=${rowCount} range=${days}d rawRows=${rows} d1Queries=1 plan=${plan.join(' | ')}`,
      );
    }

    database.close();
  }
});

export { LEGACY_TRAFFIC_STATS_SQL };
