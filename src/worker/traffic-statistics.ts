// Traffic statistics configuration
export const TRAFFIC_STATS_LIVE_BUSINESS_DAYS = 3;
export const TRAFFIC_PENDING_AGENT_ID = '__pending__';
export const TRAFFIC_UNKNOWN_PRODUCT_ID = '__unknown__';

// SQL for querying raw traffic receipts
export const TRAFFIC_STATS_RAW_SQL = `
WITH scoped AS MATERIALIZED (
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
ORDER BY dimension ASC, count DESC, item_name ASC
`;

// SQL for querying pre-aggregated rollup table
export const TRAFFIC_STATS_ROLLUP_SQL = `
SELECT dimension, item_id, item_name, SUM(count) AS count
FROM traffic_daily_rollups
WHERE site_id = 'default'
  AND business_date >= ?1
  AND business_date <= ?2
GROUP BY dimension, item_id
ORDER BY dimension ASC, count DESC, item_name ASC
`;

// SQL for hybrid query combining rollup and raw data
export const TRAFFIC_STATS_HYBRID_SQL = `
SELECT dimension, item_id, item_name, SUM(count) AS count
FROM (
  SELECT dimension, item_id, item_name, count
  FROM traffic_daily_rollups
  WHERE site_id = 'default'
    AND business_date >= ?1
    AND business_date <= ?2
  UNION ALL
  SELECT 'summary' AS dimension,
    NULL AS item_id,
    NULL AS item_name,
    COUNT(*) AS count
  FROM conversation_traffic_receipts
  WHERE site_id = 'default'
    AND business_date >= ?3
    AND business_date <= ?4
  UNION ALL
  SELECT 'agent' AS dimension,
    COALESCE(agent_id, '__pending__') AS item_id,
    COALESCE(MAX(NULLIF(TRIM(agent_name), '')), '待接待') AS item_name,
    COUNT(*) AS count
  FROM conversation_traffic_receipts
  WHERE site_id = 'default'
    AND business_date >= ?3
    AND business_date <= ?4
  GROUP BY agent_id
  UNION ALL
  SELECT 'product' AS dimension,
    COALESCE(product_id, '__unknown__') AS item_id,
    COALESCE(MAX(NULLIF(TRIM(product_title), '')), '未知产品') AS item_name,
    COUNT(*) AS count
  FROM conversation_traffic_receipts
  WHERE site_id = 'default'
    AND business_date >= ?3
    AND business_date <= ?4
  GROUP BY product_id
)
GROUP BY dimension, item_id
ORDER BY dimension ASC, count DESC, item_name ASC
`;

type ReadPlan = {
  mode: 'rollup' | 'hybrid';
  rollupFrom?: string;
  rollupTo?: string;
  rawFrom?: string;
  rawTo?: string;
};

type TrafficStatsRow = {
  dimension: string;
  item_id: string | null;
  item_name: string | null;
  count: number;
};

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
};

type D1Database = {
  prepare(sql: string): D1Statement;
  batch(
    statements: Array<{ executeRun(): { meta: { changes: number } } }>,
  ): Promise<Array<{ meta: { changes: number } }>>;
};

/**
 * Shift a business date (YYYY-MM-DD) by a number of days.
 * Positive offsets move forward in time, negative offsets move backward.
 */
export function shiftReportingDate(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/**
 * Determine the optimal read plan for traffic statistics.
 * Combines pre-aggregated historical data (from rollup table)
 * with fresh raw data for the last few days.
 */
export function trafficStatisticsReadPlan(
  from: string,
  to: string,
  fixedToday: string,
): ReadPlan {
  const rawFrom = shiftReportingDate(
    fixedToday,
    -(TRAFFIC_STATS_LIVE_BUSINESS_DAYS - 1),
  );
  const rollupCutoff = shiftReportingDate(
    fixedToday,
    -TRAFFIC_STATS_LIVE_BUSINESS_DAYS,
  );

  // If the entire range is within the raw window, use rollup mode
  if (from >= rawFrom) {
    return { mode: 'rollup' };
  }

  // Hybrid: use rollup for historical data and raw for recent data
  return {
    mode: 'hybrid',
    rollupFrom: from,
    rollupTo: rollupCutoff,
    rawFrom,
    rawTo: to,
  };
}

/**
 * Load traffic statistics for a given date range.
 * Automatically chooses between rollup-only, raw-only, or hybrid reads
 * based on the date range.
 */
export async function loadTrafficStatisticsRows(
  db: D1Database,
  from: string,
  to: string,
  fixedToday: string,
): Promise<TrafficStatsRow[]> {
  const plan = trafficStatisticsReadPlan(from, to, fixedToday);

  if (plan.mode === 'rollup') {
    const result = await db
      .prepare(TRAFFIC_STATS_ROLLUP_SQL)
      .bind(from, to)
      .all<TrafficStatsRow>();
    return result.results ?? [];
  }

  // Hybrid mode
  const result = await db
    .prepare(TRAFFIC_STATS_HYBRID_SQL)
    .bind(plan.rollupFrom, plan.rollupTo, plan.rawFrom, plan.rawTo)
    .all<TrafficStatsRow>();
  return result.results ?? [];
}

/**
 * Rebuild the traffic daily rollups for the previous three completed business days.
 * This is called daily during the reporting maintenance window (12:00 UTC).
 *
 * The rebuild ensures that late-arriving traffic receipts are captured in the
 * pre-aggregated rollup table before they age out of the raw window.
 */
export async function rebuildTrafficDailyRollups(
  db: D1Database,
  businessDate: string,
): Promise<void> {
  // Delete and rebuild the previous 3 completed business days
  const statements = [];

  for (let offset = 1; offset <= TRAFFIC_STATS_LIVE_BUSINESS_DAYS; offset++) {
    const rebuildDate = shiftReportingDate(businessDate, -offset);

    // Delete existing rollup entries for this date
    statements.push(
      db
        .prepare(
          `DELETE FROM traffic_daily_rollups
         WHERE site_id = 'default' AND business_date = ?1`,
        )
        .bind(rebuildDate),
    );

    // Rebuild summary dimension
    statements.push(
      db
        .prepare(
          `INSERT INTO traffic_daily_rollups (
          site_id, business_date, dimension, item_id, item_name, count, updated_at
        )
        SELECT 'default', ?1, 'summary', 'total', NULL, COUNT(*), CURRENT_TIMESTAMP
        FROM conversation_traffic_receipts
        WHERE site_id = 'default' AND business_date = ?1`,
        )
        .bind(rebuildDate),
    );

    // Rebuild agent dimension
    statements.push(
      db
        .prepare(
          `INSERT INTO traffic_daily_rollups (
          site_id, business_date, dimension, item_id, item_name, count, updated_at
        )
        SELECT 'default', ?1, 'agent',
          COALESCE(agent_id, '__pending__'),
          MAX(NULLIF(TRIM(agent_name), '')),
          COUNT(*),
          CURRENT_TIMESTAMP
        FROM conversation_traffic_receipts
        WHERE site_id = 'default' AND business_date = ?1
        GROUP BY agent_id`,
        )
        .bind(rebuildDate),
    );

    // Rebuild product dimension
    statements.push(
      db
        .prepare(
          `INSERT INTO traffic_daily_rollups (
          site_id, business_date, dimension, item_id, item_name, count, updated_at
        )
        SELECT 'default', ?1, 'product',
          COALESCE(product_id, '__unknown__'),
          MAX(NULLIF(TRIM(product_title), '')),
          COUNT(*),
          CURRENT_TIMESTAMP
        FROM conversation_traffic_receipts
        WHERE site_id = 'default' AND business_date = ?1
        GROUP BY product_id`,
        )
        .bind(rebuildDate),
    );
  }

  // Execute all updates in a single batch transaction
  await db.batch(
    statements.map((stmt) => ({
      executeRun: () =>
        stmt.run() as unknown as { meta: { changes: number } },
    })),
  );
}
