export const TRAFFIC_STATS_LIVE_BUSINESS_DAYS = 3;
export const TRAFFIC_PENDING_AGENT_ID = '__pending__';
export const TRAFFIC_UNKNOWN_PRODUCT_ID = '__unknown__';

export type TrafficStatisticsRow = {
  dimension: 'summary' | 'agent' | 'product';
  item_id: string | null;
  item_name: string | null;
  count: number;
};

type TrafficStatisticsReadPlan =
  | {
      mode: 'raw';
      rawFrom: string;
      rawTo: string;
    }
  | {
      mode: 'rollup';
      rollupFrom: string;
      rollupTo: string;
    }
  | {
      mode: 'hybrid';
      rollupFrom: string;
      rollupTo: string;
      rawFrom: string;
      rawTo: string;
    };

const TRAFFIC_STATS_RECEPTION_ROWS_SQL = `SELECT 'summary' AS dimension,
       NULL AS item_id,
       NULL AS item_name,
       COALESCE(SUM(conversation_count), 0) AS count
     FROM receptions
     UNION ALL
     SELECT 'agent' AS dimension,
       receptions.agent_id AS item_id,
       COALESCE(MAX(NULLIF(TRIM(agents.name), '')), receptions.agent_id) AS item_name,
       SUM(receptions.conversation_count) AS count
     FROM receptions
     LEFT JOIN agents
       ON agents.site_id = 'default'
      AND agents.id = receptions.agent_id
     GROUP BY receptions.agent_id`;

export const TRAFFIC_STATS_RAW_SQL = `WITH receptions AS MATERIALIZED (
       SELECT agent_id, conversation_count
       FROM agent_daily_stats
       WHERE site_id = 'default'
         AND business_date >= ?1
         AND business_date <= ?2
     ),
     products AS MATERIALIZED (
       SELECT product_id, product_title
       FROM conversation_traffic_receipts
       WHERE site_id = 'default'
         AND business_date >= ?1
         AND business_date <= ?2
     )
     ${TRAFFIC_STATS_RECEPTION_ROWS_SQL}
     UNION ALL
     SELECT 'product' AS dimension,
       COALESCE(product_id, '__unknown__') AS item_id,
       COALESCE(MAX(NULLIF(TRIM(product_title), '')), '未知产品') AS item_name,
       COUNT(*) AS count
     FROM products
     GROUP BY product_id
     ORDER BY dimension ASC, count DESC, item_name ASC`;

export const TRAFFIC_STATS_ROLLUP_SQL = `WITH receptions AS MATERIALIZED (
       SELECT agent_id, conversation_count
       FROM agent_daily_stats
       WHERE site_id = 'default'
         AND business_date >= ?1
         AND business_date <= ?2
     ),
     products AS (
       SELECT CASE WHEN item_id = '__unknown__' THEN NULL ELSE item_id END AS product_id,
         item_name AS product_title, count
       FROM traffic_daily_rollups
       WHERE site_id = 'default'
         AND dimension = 'product'
         AND business_date >= ?1
         AND business_date <= ?2
     )
     ${TRAFFIC_STATS_RECEPTION_ROWS_SQL}
     UNION ALL
     SELECT 'product' AS dimension,
       COALESCE(product_id, '__unknown__') AS item_id,
       COALESCE(MAX(NULLIF(TRIM(product_title), '')), '未知产品') AS item_name,
       SUM(count) AS count
     FROM products
     GROUP BY product_id
     ORDER BY dimension ASC, count DESC, item_name ASC`;

export const TRAFFIC_STATS_HYBRID_SQL = `WITH receptions AS MATERIALIZED (
       SELECT agent_id, conversation_count
       FROM agent_daily_stats
       WHERE site_id = 'default'
         AND business_date >= ?1
         AND business_date <= ?4
     ),
     historical_products AS (
       SELECT CASE WHEN item_id = '__unknown__' THEN NULL ELSE item_id END AS product_id,
         item_name AS product_title, count
       FROM traffic_daily_rollups
       WHERE site_id = 'default'
         AND dimension = 'product'
         AND business_date >= ?1
         AND business_date <= ?2
     ),
     live_products AS MATERIALIZED (
       SELECT product_id, product_title
       FROM conversation_traffic_receipts
       WHERE site_id = 'default'
         AND business_date >= ?3
         AND business_date <= ?4
     ),
     products AS (
       SELECT product_id, product_title, count FROM historical_products
       UNION ALL
       SELECT product_id, product_title, COUNT(*) AS count
       FROM live_products
       GROUP BY product_id
     )
     ${TRAFFIC_STATS_RECEPTION_ROWS_SQL}
     UNION ALL
     SELECT 'product' AS dimension,
       COALESCE(product_id, '__unknown__') AS item_id,
       COALESCE(MAX(NULLIF(TRIM(product_title), '')), '未知产品') AS item_name,
       SUM(count) AS count
     FROM products
     GROUP BY product_id
     ORDER BY dimension ASC, count DESC, item_name ASC`;

export function shiftReportingDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export function trafficStatisticsReadPlan(
  from: string,
  to: string,
  today: string,
): TrafficStatisticsReadPlan {
  const earliestLiveDate = shiftReportingDate(
    today,
    -(TRAFFIC_STATS_LIVE_BUSINESS_DAYS - 1),
  );
  if (to < earliestLiveDate) {
    return { mode: 'rollup', rollupFrom: from, rollupTo: to };
  }
  if (from >= earliestLiveDate) {
    return { mode: 'raw', rawFrom: from, rawTo: to };
  }
  return {
    mode: 'hybrid',
    rollupFrom: from,
    rollupTo: shiftReportingDate(earliestLiveDate, -1),
    rawFrom: earliestLiveDate,
    rawTo: to,
  };
}

export async function loadTrafficStatisticsRows(
  db: D1Database,
  from: string,
  to: string,
  today: string,
): Promise<TrafficStatisticsRow[]> {
  const plan = trafficStatisticsReadPlan(from, to, today);
  if (plan.mode === 'raw') {
    const result = await db
      .prepare(TRAFFIC_STATS_RAW_SQL)
      .bind(plan.rawFrom, plan.rawTo)
      .all<TrafficStatisticsRow>();
    return result.results ?? [];
  }
  if (plan.mode === 'rollup') {
    const result = await db
      .prepare(TRAFFIC_STATS_ROLLUP_SQL)
      .bind(plan.rollupFrom, plan.rollupTo)
      .all<TrafficStatisticsRow>();
    return result.results ?? [];
  }
  const result = await db
    .prepare(TRAFFIC_STATS_HYBRID_SQL)
    .bind(plan.rollupFrom, plan.rollupTo, plan.rawFrom, plan.rawTo)
    .all<TrafficStatisticsRow>();
  return result.results ?? [];
}

export async function rebuildTrafficDailyRollups(
  db: D1Database,
  currentBusinessDate: string,
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (
    let offset = 1;
    offset <= TRAFFIC_STATS_LIVE_BUSINESS_DAYS;
    offset += 1
  ) {
    const businessDate = shiftReportingDate(currentBusinessDate, -offset);
    statements.push(
      db
        .prepare(
          `DELETE FROM traffic_daily_rollups
           WHERE site_id = 'default'
             AND business_date = ?1`,
        )
        .bind(businessDate),
      db
        .prepare(
          `INSERT INTO traffic_daily_rollups (
             site_id, business_date, dimension, item_id, item_name, count, updated_at
           )
           SELECT site_id, business_date, 'summary', 'total', NULL,
             COUNT(*), CURRENT_TIMESTAMP
           FROM conversation_traffic_receipts
           WHERE site_id = 'default'
             AND business_date = ?1
           GROUP BY site_id, business_date`,
        )
        .bind(businessDate),
      db
        .prepare(
          `INSERT INTO traffic_daily_rollups (
             site_id, business_date, dimension, item_id, item_name, count, updated_at
           )
           SELECT site_id, business_date, 'agent',
             COALESCE(agent_id, '__pending__'),
             MAX(NULLIF(TRIM(agent_name), '')),
             COUNT(*), CURRENT_TIMESTAMP
           FROM conversation_traffic_receipts
           WHERE site_id = 'default'
             AND business_date = ?1
           GROUP BY site_id, business_date, agent_id`,
        )
        .bind(businessDate),
      db
        .prepare(
          `INSERT INTO traffic_daily_rollups (
             site_id, business_date, dimension, item_id, item_name, count, updated_at
           )
           SELECT site_id, business_date, 'product',
             COALESCE(product_id, '__unknown__'),
             MAX(NULLIF(TRIM(product_title), '')),
             COUNT(*), CURRENT_TIMESTAMP
           FROM conversation_traffic_receipts
           WHERE site_id = 'default'
             AND business_date = ?1
           GROUP BY site_id, business_date, product_id`,
        )
        .bind(businessDate),
    );
  }
  await db.batch(statements);
}
