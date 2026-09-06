import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { URL } from 'node:url';
import {
  rebuildTrafficDailyRollups,
  shiftReportingDate,
  TRAFFIC_PENDING_AGENT_ID,
  TRAFFIC_STATS_HYBRID_SQL,
  TRAFFIC_STATS_LIVE_BUSINESS_DAYS,
  TRAFFIC_STATS_RAW_SQL,
  TRAFFIC_STATS_ROLLUP_SQL,
  TRAFFIC_UNKNOWN_PRODUCT_ID,
  loadTrafficStatisticsRows,
  trafficStatisticsReadPlan,
} from '../src/worker/traffic-statistics.ts';

const migrationsDirectory = new URL('../migrations/', import.meta.url);
const rollupMigrationUrl = new URL(
  '../migrations/0061_traffic_daily_rollups.sql',
  import.meta.url,
);
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

function migrationFiles() {
  return readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

function createDatabaseThrough0060() {
  const database = new DatabaseSync(':memory:');
  for (const filename of migrationFiles()) {
    if (filename >= '0061_') break;
    database.exec(readFileSync(new URL(filename, migrationsDirectory), 'utf8'));
  }
  return database;
}

function createMigratedDatabase() {
  const database = new DatabaseSync(':memory:');
  for (const filename of migrationFiles()) {
    database.exec(readFileSync(new URL(filename, migrationsDirectory), 'utf8'));
  }
  return database;
}

function applyRollupMigration(database) {
  database.exec(readFileSync(rollupMigrationUrl, 'utf8'));
}

function d1(database) {
  const counter = { queries: 0, batches: 0 };
  function prepare(sql) {
    let bindings = [];
    const statement = {
      bind(...values) {
        bindings = values;
        return statement;
      },
      async all() {
        counter.queries += 1;
        return { results: database.prepare(sql).all(...bindings) };
      },
      async run() {
        counter.queries += 1;
        const result = database.prepare(sql).run(...bindings);
        return { meta: { changes: Number(result.changes) } };
      },
      executeRun() {
        const result = database.prepare(sql).run(...bindings);
        return { meta: { changes: Number(result.changes) } };
      },
    };
    return statement;
  }
  async function batch(statements) {
    counter.batches += 1;
    database.exec('BEGIN');
    try {
      const results = statements.map((statement) => statement.executeRun());
      database.exec('COMMIT');
      return results;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
  return { prepare, batch, counter };
}

function dateShift(day, offset) {
  return shiftReportingDate(day, offset);
}

function insertReceipt(
  database,
  {
    conversationId,
    businessDate,
    productId = null,
    productTitle = null,
    agentId = null,
    agentName = null,
  },
) {
  database
    .prepare(
      `INSERT INTO conversation_traffic_receipts (
         conversation_id, site_id, business_date,
         product_id, product_title, agent_id, agent_name, started_at
       ) VALUES (?1, 'default', ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .run(
      conversationId,
      businessDate,
      productId,
      productTitle,
      agentId,
      agentName,
      `${businessDate}T12:00:00.000Z`,
    );
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
        `synthetic-${rowCount}-${index}`,
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
  if (!from || !to || from > to) return 0;
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

function legacyRows(database, from, to) {
  return database
    .prepare(LEGACY_TRAFFIC_STATS_SQL)
    .all(from, to)
    .map((row) => ({ ...row, count: Number(row.count) }));
}

function apiShape(rows, from, to) {
  return {
    from,
    to,
    total: Number(rows.find((row) => row.dimension === 'summary')?.count ?? 0),
    agents: rows
      .filter((row) => row.dimension === 'agent')
      .map((row) => ({
        agentId: row.item_id === TRAFFIC_PENDING_AGENT_ID ? null : row.item_id,
        agentName: row.item_name ?? '待接待',
        count: Number(row.count),
      })),
    products: rows
      .filter((row) => row.dimension === 'product')
      .map((row) => ({
        productId:
          row.item_id === TRAFFIC_UNKNOWN_PRODUCT_ID ? null : row.item_id,
        productTitle: row.item_name ?? '未知产品',
        count: Number(row.count),
      })),
    retainedFrom: RETAINED_FROM,
  };
}

function assertUsesIndex(plan, table, index) {
  assert.ok(
    plan.some(
      (detail) =>
        detail.includes(`SEARCH ${table} USING INDEX`) &&
        detail.includes(index),
    ),
    `expected ${index}; got:\n${plan.join('\n')}`,
  );
}

test('0061 creates one indexed daily rollup table and backfills retained facts without mutating receipts', () => {
  const database = createDatabaseThrough0060();
  insertReceipt(database, {
    conversationId: 'historical-agent',
    businessDate: '2026-08-10',
    productId: 'product-gone',
    productTitle: 'Historical Product',
    agentId: 'agent-gone',
    agentName: 'Historical Agent',
  });
  insertReceipt(database, {
    conversationId: 'pending-unknown',
    businessDate: '2026-08-10',
  });
  const before = rawRows(database, RETAINED_FROM, FIXED_TODAY);

  applyRollupMigration(database);

  assert.equal(rawRows(database, RETAINED_FROM, FIXED_TODAY), before);
  const tableSql = database
    .prepare(
      `SELECT sql FROM sqlite_master
       WHERE type = 'table' AND name = 'traffic_daily_rollups'`,
    )
    .get().sql;
  assert.match(
    tableSql,
    /PRIMARY KEY \(site_id, business_date, dimension, item_id\)/u,
  );
  assert.match(tableSql, /summary.*agent.*product/u);
  const indexes = database
    .prepare("PRAGMA index_list('traffic_daily_rollups')")
    .all()
    .map((row) => row.name);
  assert.ok(indexes.includes('idx_traffic_daily_rollups_site_date'));
  assert.deepEqual(
    database
      .prepare(
        `SELECT dimension, item_id, item_name, count
         FROM traffic_daily_rollups
         WHERE business_date = '2026-08-10'
         ORDER BY dimension, item_id`,
      )
      .all(),
    [
      {
        dimension: 'agent',
        item_id: TRAFFIC_PENDING_AGENT_ID,
        item_name: null,
        count: 1,
      },
      {
        dimension: 'agent',
        item_id: 'agent-gone',
        item_name: 'Historical Agent',
        count: 1,
      },
      {
        dimension: 'product',
        item_id: TRAFFIC_UNKNOWN_PRODUCT_ID,
        item_name: null,
        count: 1,
      },
      {
        dimension: 'product',
        item_id: 'product-gone',
        item_name: 'Historical Product',
        count: 1,
      },
      {
        dimension: 'summary',
        item_id: 'total',
        item_name: null,
        count: 2,
      },
    ],
  );
  assert.doesNotMatch(
    readFileSync(rollupMigrationUrl, 'utf8'),
    /CREATE TRIGGER/iu,
  );
  database.close();
});

test('fresh migration chain includes the rollup schema', () => {
  const database = createMigratedDatabase();
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM sqlite_master
         WHERE type = 'table' AND name = 'traffic_daily_rollups'`,
      )
      .get().count,
    1,
  );
  database.close();
});

test('scheduled rebuild self-heals only the previous three completed business days', async () => {
  const database = createDatabaseThrough0060();
  const yesterday = dateShift(FIXED_TODAY, -1);
  const dayFour = dateShift(FIXED_TODAY, -4);
  insertReceipt(database, {
    conversationId: 'yesterday-before-backfill',
    businessDate: yesterday,
    productId: 'product-a',
    productTitle: 'Product A',
    agentId: 'agent-a',
    agentName: 'Agent A',
  });
  insertReceipt(database, {
    conversationId: 'day-four-before-backfill',
    businessDate: dayFour,
    productId: 'product-a',
    productTitle: 'Product A',
    agentId: 'agent-a',
    agentName: 'Agent A',
  });
  applyRollupMigration(database);
  insertReceipt(database, {
    conversationId: 'yesterday-late-fact',
    businessDate: yesterday,
    productId: 'product-a',
    productTitle: 'Product A New',
    agentId: 'agent-a',
    agentName: 'Agent A New',
  });
  insertReceipt(database, {
    conversationId: 'day-four-late-fact',
    businessDate: dayFour,
    productId: 'product-a',
    productTitle: 'Product A New',
    agentId: 'agent-a',
    agentName: 'Agent A New',
  });

  const db = d1(database);
  await rebuildTrafficDailyRollups(db, FIXED_TODAY);

  assert.equal(db.counter.batches, 1);
  assert.equal(
    database
      .prepare(
        `SELECT count FROM traffic_daily_rollups
         WHERE business_date = ?1 AND dimension = 'summary'`,
      )
      .get(yesterday).count,
    2,
  );
  assert.equal(
    database
      .prepare(
        `SELECT count FROM traffic_daily_rollups
         WHERE business_date = ?1 AND dimension = 'summary'`,
      )
      .get(dayFour).count,
    1,
    'the maintenance rebuild must stay bounded to three completed days',
  );
  database.close();
});

test('legacy raw aggregation and the production hybrid read are strict-equal across dashboard ranges and edge semantics', async () => {
  const database = createDatabaseThrough0060();
  seedReceipts(database, 900);
  insertReceipt(database, {
    conversationId: 'historical-name-old',
    businessDate: dateShift(FIXED_TODAY, -20),
    productId: 'product-history',
    productTitle: 'History Product A',
    agentId: 'agent-history',
    agentName: 'History Agent A',
  });
  insertReceipt(database, {
    conversationId: 'historical-name-new',
    businessDate: dateShift(FIXED_TODAY, -10),
    productId: 'product-history',
    productTitle: 'History Product Z',
    agentId: 'agent-history',
    agentName: 'History Agent Z',
  });
  insertReceipt(database, {
    conversationId: 'deleted-catalog-snapshot',
    businessDate: dateShift(FIXED_TODAY, -40),
    productId: 'product-deleted',
    productTitle: 'Deleted Product Snapshot',
    agentId: 'agent-deleted',
    agentName: 'Deleted Agent Snapshot',
  });
  insertReceipt(database, {
    conversationId: 'historical-pending-unknown',
    businessDate: dateShift(FIXED_TODAY, -12),
  });
  applyRollupMigration(database);

  insertReceipt(database, {
    conversationId: 'live-after-rollup',
    businessDate: FIXED_TODAY,
    productId: 'product-history',
    productTitle: 'History Product Live',
    agentId: 'agent-history',
    agentName: 'History Agent Live',
  });
  insertReceipt(database, {
    conversationId: 'live-pending-unknown-after-rollup',
    businessDate: dateShift(FIXED_TODAY, -1),
  });

  const ranges = [
    ['today', FIXED_TODAY, FIXED_TODAY],
    ['yesterday', dateShift(FIXED_TODAY, -1), dateShift(FIXED_TODAY, -1)],
    ['7d', dateShift(FIXED_TODAY, -6), FIXED_TODAY],
    ['30d', dateShift(FIXED_TODAY, -29), FIXED_TODAY],
    ['90d', RETAINED_FROM, FIXED_TODAY],
    [
      'custom-historical',
      dateShift(FIXED_TODAY, -60),
      dateShift(FIXED_TODAY, -50),
    ],
    ['custom-hybrid', dateShift(FIXED_TODAY, -5), dateShift(FIXED_TODAY, -1)],
    ['retention-boundary', RETAINED_FROM, RETAINED_FROM],
  ];

  for (const [label, from, to] of ranges) {
    const legacy = apiShape(legacyRows(database, from, to), from, to);
    const db = d1(database);
    const hybridRows = await loadTrafficStatisticsRows(
      db,
      from,
      to,
      FIXED_TODAY,
    );
    const hybrid = apiShape(hybridRows, from, to);
    assert.deepEqual(hybrid, legacy, `${label} must reconcile exactly`);
    assert.equal(
      db.counter.queries,
      1,
      `${label} must use one D1 read statement`,
    );
  }

  const emptyDatabase = createDatabaseThrough0060();
  applyRollupMigration(emptyDatabase);
  const emptyDb = d1(emptyDatabase);
  const emptyFrom = dateShift(FIXED_TODAY, -20);
  const emptyTo = dateShift(FIXED_TODAY, -10);
  assert.deepEqual(
    apiShape(
      await loadTrafficStatisticsRows(emptyDb, emptyFrom, emptyTo, FIXED_TODAY),
      emptyFrom,
      emptyTo,
    ),
    apiShape(legacyRows(emptyDatabase, emptyFrom, emptyTo), emptyFrom, emptyTo),
  );
  database.close();
  emptyDatabase.close();
});

test('historical-only and 90-day hybrid plans use indexed bounded sources', () => {
  const database = createDatabaseThrough0060();
  seedReceipts(database, 10_080);
  applyRollupMigration(database);
  database.exec('ANALYZE');

  const historicalTo = dateShift(FIXED_TODAY, -3);
  const historicalPlan = explain(database, TRAFFIC_STATS_ROLLUP_SQL, [
    RETAINED_FROM,
    historicalTo,
  ]);
  assertUsesIndex(
    historicalPlan,
    'traffic_daily_rollups',
    'idx_traffic_daily_rollups_site_date',
  );
  assert.ok(
    historicalPlan.every(
      (detail) => !detail.includes('conversation_traffic_receipts'),
    ),
    `historical-only range must not scan raw receipts:\n${historicalPlan.join('\n')}`,
  );

  const plan = trafficStatisticsReadPlan(
    RETAINED_FROM,
    FIXED_TODAY,
    FIXED_TODAY,
  );
  assert.equal(plan.mode, 'hybrid');
  assert.equal(plan.rawFrom, dateShift(FIXED_TODAY, -2));
  assert.equal(plan.rawTo, FIXED_TODAY);
  assert.equal(plan.rollupTo, dateShift(FIXED_TODAY, -3));
  const hybridPlan = explain(database, TRAFFIC_STATS_HYBRID_SQL, [
    plan.rollupFrom,
    plan.rollupTo,
    plan.rawFrom,
    plan.rawTo,
  ]);
  assertUsesIndex(
    hybridPlan,
    'traffic_daily_rollups',
    'idx_traffic_daily_rollups_site_date',
  );
  assertUsesIndex(
    hybridPlan,
    'conversation_traffic_receipts',
    'idx_conversation_traffic_receipts_date',
  );
  assert.equal(
    (new Date(`${plan.rawTo}T00:00:00Z`) -
      new Date(`${plan.rawFrom}T00:00:00Z`)) /
      86_400_000 +
      1,
    TRAFFIC_STATS_LIVE_BUSINESS_DAYS,
  );
  database.close();
});

test('1/7/30/90-day synthetic cost contracts keep one D1 query and cap raw facts at three days', async () => {
  for (const rowCount of [10_080, 50_400]) {
    const database = createDatabaseThrough0060();
    seedReceipts(database, rowCount);
    applyRollupMigration(database);
    database.exec('ANALYZE');

    for (const days of [1, 7, 30, 90]) {
      const from = dateShift(FIXED_TODAY, -(days - 1));
      const legacyFactRows = rawRows(database, from, FIXED_TODAY);
      const readPlan = trafficStatisticsReadPlan(
        from,
        FIXED_TODAY,
        FIXED_TODAY,
      );
      const liveFactRows =
        readPlan.mode === 'rollup'
          ? 0
          : rawRows(database, readPlan.rawFrom, readPlan.rawTo);
      const db = d1(database);
      await loadTrafficStatisticsRows(db, from, FIXED_TODAY, FIXED_TODAY);
      assert.equal(db.counter.queries, 1);
      assert.ok(
        liveFactRows <= (rowCount / 90) * TRAFFIC_STATS_LIVE_BUSINESS_DAYS,
      );
      if (days >= TRAFFIC_STATS_LIVE_BUSINESS_DAYS) {
        assert.equal(
          liveFactRows,
          (rowCount / 90) * TRAFFIC_STATS_LIVE_BUSINESS_DAYS,
        );
      }
      console.log(
        `phase11 cost receipts=${rowCount} range=${days}d beforeRawRows=${legacyFactRows} afterRawRows=${liveFactRows} beforeD1Queries=1 afterD1Queries=${db.counter.queries}`,
      );
    }

    const legacyPlan = explain(database, LEGACY_TRAFFIC_STATS_SQL, [
      RETAINED_FROM,
      FIXED_TODAY,
    ]);
    const hybridBounds = trafficStatisticsReadPlan(
      RETAINED_FROM,
      FIXED_TODAY,
      FIXED_TODAY,
    );
    const hybridPlan = explain(database, TRAFFIC_STATS_HYBRID_SQL, [
      hybridBounds.rollupFrom,
      hybridBounds.rollupTo,
      hybridBounds.rawFrom,
      hybridBounds.rawTo,
    ]);
    console.log(
      `phase11 plan receipts=${rowCount} before=${legacyPlan.join(' | ')} after=${hybridPlan.join(' | ')}`,
    );
    database.close();
  }
});

test('production SQL keeps explicit bounded date predicates and no request-time rollup rebuild', () => {
  assert.match(TRAFFIC_STATS_RAW_SQL, /business_date >= \?1/u);
  assert.match(TRAFFIC_STATS_RAW_SQL, /business_date <= \?2/u);
  assert.match(TRAFFIC_STATS_HYBRID_SQL, /business_date >= \?3/u);
  assert.match(TRAFFIC_STATS_HYBRID_SQL, /business_date <= \?4/u);
  assert.doesNotMatch(TRAFFIC_STATS_HYBRID_SQL, /INSERT|UPDATE|DELETE/iu);
  assert.equal(TRAFFIC_STATS_LIVE_BUSINESS_DAYS, 3);
});

export { LEGACY_TRAFFIC_STATS_SQL };
