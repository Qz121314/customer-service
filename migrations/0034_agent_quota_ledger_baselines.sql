PRAGMA foreign_keys = ON;

-- Paid traffic counters are lifetime totals, while detailed traffic receipts are
-- retained for only the reporting window. These two baselines let the admin
-- reconcile lifetime totals without keeping every receipt forever.
ALTER TABLE agents ADD COLUMN traffic_quota_total_baseline INTEGER NOT NULL DEFAULT 0
  CHECK (traffic_quota_total_baseline >= 0);
ALTER TABLE agents ADD COLUMN traffic_quota_archived_used INTEGER NOT NULL DEFAULT 0
  CHECK (traffic_quota_archived_used >= 0);

-- Establish a trusted starting checkpoint from the counters that existed before
-- this migration. If historical detail already exceeds a stored counter, keep
-- the baseline at zero so the mismatch remains visible instead of being hidden.
UPDATE agents
SET traffic_quota_total_baseline = MAX(
      traffic_quota_total - COALESCE((
        SELECT SUM(adjustment.amount)
        FROM agent_quota_adjustments adjustment
        WHERE adjustment.site_id = agents.site_id
          AND adjustment.agent_id = agents.id
          AND adjustment.applied_at IS NOT NULL
      ), 0),
      0
    ),
    traffic_quota_archived_used = MAX(
      traffic_quota_used - COALESCE((
        SELECT COUNT(*)
        FROM agent_traffic_receipts receipt
        WHERE receipt.site_id = agents.site_id
          AND receipt.agent_id = agents.id
          AND receipt.quota_consumed = 1
      ), 0),
      0
    )
WHERE id <> 'admin';
