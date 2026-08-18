import { Hono } from 'hono';
import { verifyAdminSession } from './core';

type Bindings = {
  DB: D1Database;
  ADMIN_PASSWORD?: string;
};

type Env = { Bindings: Bindings };

type QuotaLedgerRow = {
  quota_total: number;
  quota_used: number;
  total_baseline: number;
  archived_used: number;
  expected_total: number;
  expected_used: number;
  adjustment_id: string | null;
  request_id: string | null;
  amount: number | null;
  quota_total_before: number | null;
  quota_total_after: number | null;
  applied_at: string | null;
  created_at: string | null;
};

export const adminQuotaApi = new Hono<Env>();

adminQuotaApi.get('/api/admin/agents/:id/quota-ledger', async (c) => {
  const password = c.env.ADMIN_PASSWORD;
  if (!password || !(await verifyAdminSession(c.req.raw, password))) {
    return c.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const agentId = c.req.param('id');
  if (!agentId || agentId === 'admin') {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  // Ledger verification is intentionally admin-on-demand. Normal bootstrap and
  // routing never scan retained traffic receipts just to prove accounting state.
  // One D1 read returns both the audit totals and the ten newest top-ups.
  const result = await c.env.DB.prepare(
    `WITH ledger AS (
       SELECT
         agent.traffic_quota_total AS quota_total,
         agent.traffic_quota_used AS quota_used,
         agent.traffic_quota_total_baseline AS total_baseline,
         agent.traffic_quota_archived_used AS archived_used,
         agent.traffic_quota_total_baseline + COALESCE((
           SELECT SUM(adjustment.amount)
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
         ), 0) AS expected_used
       FROM agents agent
       WHERE agent.site_id = 'default'
         AND agent.id = ?1
         AND agent.id <> 'admin'
       LIMIT 1
     ),
     recent_adjustments AS (
       SELECT id, request_id, amount, quota_total_before, quota_total_after,
         applied_at, created_at
       FROM agent_quota_adjustments
       WHERE site_id = 'default'
         AND agent_id = ?1
         AND applied_at IS NOT NULL
       ORDER BY created_at DESC, id DESC
       LIMIT 10
     )
     SELECT
       ledger.quota_total,
       ledger.quota_used,
       ledger.total_baseline,
       ledger.archived_used,
       ledger.expected_total,
       ledger.expected_used,
       adjustment.id AS adjustment_id,
       adjustment.request_id,
       adjustment.amount,
       adjustment.quota_total_before,
       adjustment.quota_total_after,
       adjustment.applied_at,
       adjustment.created_at
     FROM ledger
     LEFT JOIN recent_adjustments adjustment ON 1 = 1
     ORDER BY adjustment.created_at DESC, adjustment.id DESC`,
  )
    .bind(agentId)
    .all<QuotaLedgerRow>();

  const rows = result.results ?? [];
  const first = rows[0];
  if (!first) return c.json({ error: 'NOT_FOUND' }, 404);

  const total = Number(first.quota_total);
  const used = Number(first.quota_used);
  const totalBaseline = Number(first.total_baseline);
  const archivedUsed = Number(first.archived_used);
  const expectedTotal = Number(first.expected_total);
  const expectedUsed = Number(first.expected_used);

  return c.json({
    ledger: {
      total,
      used,
      totalBaseline,
      archivedUsed,
      retainedUsed: Math.max(0, expectedUsed - archivedUsed),
      expectedTotal,
      expectedUsed,
      consistent: total === expectedTotal && used === expectedUsed,
    },
    adjustments: rows.flatMap((row) =>
      row.adjustment_id && row.request_id && row.created_at
        ? [
            {
              id: row.adjustment_id,
              requestId: row.request_id,
              amount: Number(row.amount),
              quotaTotalBefore: Number(row.quota_total_before),
              quotaTotalAfter: Number(row.quota_total_after),
              appliedAt: row.applied_at,
              createdAt: row.created_at,
            },
          ]
        : [],
    ),
  });
});
