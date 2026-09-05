import { routingBusinessDate } from './routing';

export type RoutingExclusionReason =
  | 'disabled'
  | 'not_online'
  | 'account_unconfigured'
  | 'scope_mismatch'
  | 'daily_limit_reached'
  | 'quota_exhausted';

export type RoutingDiagnosticAgent = {
  id: string;
  name: string;
  adminLabel: string;
  status: string;
  isEnabled: boolean;
  accountConfigured: boolean;
  scopeMatched: boolean;
  todayConversationCount: number;
  dailyConversationLimit: number;
  dailyLimitAvailable: boolean;
  trafficQuotaEnabled: boolean;
  trafficQuotaTotal: number;
  trafficQuotaUsed: number;
  quotaAvailable: boolean;
  eligible: boolean;
  exclusionReasons: RoutingExclusionReason[];
  nextRoundRobin: boolean;
};

export type RoutingDiagnostics = {
  siteId: string;
  product: {
    id: string;
    title: string;
    sectionId: string | null;
    categoryId: string | null;
  };
  businessDate: string;
  cursor: { lastAgentId: string | null; nextAgentId: string | null };
  funnel: {
    total: number;
    enabled: number;
    online: number;
    accountConfigured: number;
    scopeMatched: number;
    dailyLimitAvailable: number;
    quotaAvailable: number;
    eligible: number;
  };
  agents: RoutingDiagnosticAgent[];
};

type ProductRow = {
  site_id: string;
  id: string;
  title: string;
  section_id: string | null;
  category_id: string | null;
};

type DiagnosticRow = {
  id: string;
  name: string;
  admin_label: string | null;
  status: string;
  is_enabled: number;
  account_configured: number;
  scope_matched: number;
  today_count: number;
  daily_conversation_limit: number;
  traffic_quota_enabled: number;
  traffic_quota_total: number;
  traffic_quota_used: number;
};

export async function diagnoseProductRouting(
  db: D1Database,
  productId: string,
): Promise<RoutingDiagnostics | null> {
  const product = await db
    .prepare(
      `SELECT site_id, id, title, section_id, category_id
       FROM product_catalog
       WHERE site_id = 'default'
         AND id = ?1
         AND is_enabled = 1
       LIMIT 1`,
    )
    .bind(productId)
    .first<ProductRow>();
  if (!product) return null;

  const businessDate = routingBusinessDate();
  const [agentResult, cursorRow] = await Promise.all([
    db
      .prepare(
        `SELECT
           a.id,
           a.name,
           a.admin_label,
           a.status,
           a.is_enabled,
           CASE
             WHEN a.username IS NOT NULL AND a.username <> ''
               AND a.password_hash IS NOT NULL AND a.password_hash <> ''
             THEN 1 ELSE 0
           END AS account_configured,
           CASE WHEN EXISTS (
             SELECT 1
             FROM agent_routing_scopes ars
             WHERE ars.site_id = a.site_id
               AND ars.agent_id = a.id
               AND ars.is_enabled = 1
               AND (
                 (ars.scope_type = 'product' AND ars.product_id = ?2)
                 OR (ars.scope_type = 'section' AND ars.section_id = ?3)
                 OR (
                   ars.scope_type = 'category'
                   AND ars.section_id = ?3
                   AND ars.category_id = ?4
                 )
               )
             LIMIT 1
           ) THEN 1 ELSE 0 END AS scope_matched,
           COALESCE((
             SELECT daily.conversation_count
             FROM agent_daily_stats daily
             WHERE daily.site_id = a.site_id
               AND daily.agent_id = a.id
               AND daily.business_date = ?5
             LIMIT 1
           ), 0) AS today_count,
           a.daily_conversation_limit,
           a.traffic_quota_enabled,
           a.traffic_quota_total,
           a.traffic_quota_used
         FROM agents a
         WHERE a.site_id = ?1
           AND a.id <> 'admin'
         ORDER BY a.id ASC`,
      )
      .bind(
        product.site_id,
        product.id,
        product.section_id ?? '',
        product.category_id ?? '',
        businessDate,
      )
      .all<DiagnosticRow>(),
    db
      .prepare(
        `SELECT last_agent_id
         FROM routing_round_robin_cursors
         WHERE site_id = ?1
         LIMIT 1`,
      )
      .bind(product.site_id)
      .first<{ last_agent_id: string }>(),
  ]);

  const agents = (agentResult.results ?? []).map((row) => {
    const isEnabled = row.is_enabled === 1;
    const online = row.status === 'online';
    const accountConfigured = row.account_configured === 1;
    const scopeMatched = row.scope_matched === 1;
    const todayConversationCount = Number(row.today_count ?? 0);
    const dailyConversationLimit = Number(
      row.daily_conversation_limit ?? 0,
    );
    const dailyLimitAvailable =
      dailyConversationLimit <= 0 ||
      todayConversationCount < dailyConversationLimit;
    const trafficQuotaEnabled = row.traffic_quota_enabled === 1;
    const trafficQuotaTotal = Number(row.traffic_quota_total ?? 0);
    const trafficQuotaUsed = Number(row.traffic_quota_used ?? 0);
    const quotaAvailable =
      !trafficQuotaEnabled || trafficQuotaUsed < trafficQuotaTotal;
    const exclusionReasons: RoutingExclusionReason[] = [];
    if (!isEnabled) exclusionReasons.push('disabled');
    if (!online) exclusionReasons.push('not_online');
    if (!accountConfigured) exclusionReasons.push('account_unconfigured');
    if (!scopeMatched) exclusionReasons.push('scope_mismatch');
    if (!dailyLimitAvailable) exclusionReasons.push('daily_limit_reached');
    if (!quotaAvailable) exclusionReasons.push('quota_exhausted');

    return {
      id: row.id,
      name: row.name,
      adminLabel: row.admin_label ?? '',
      status: row.status,
      isEnabled,
      accountConfigured,
      scopeMatched,
      todayConversationCount,
      dailyConversationLimit,
      dailyLimitAvailable,
      trafficQuotaEnabled,
      trafficQuotaTotal,
      trafficQuotaUsed,
      quotaAvailable,
      eligible: exclusionReasons.length === 0,
      exclusionReasons,
      nextRoundRobin: false,
    } satisfies RoutingDiagnosticAgent;
  });

  const lastAgentId = cursorRow?.last_agent_id ?? null;
  const eligible = agents.filter((agent) => agent.eligible);
  const next =
    eligible.find((agent) => lastAgentId === null || agent.id > lastAgentId) ??
    eligible[0] ??
    null;
  if (next) next.nextRoundRobin = true;

  const enabled = agents.filter((agent) => agent.isEnabled);
  const online = enabled.filter((agent) => agent.status === 'online');
  const configured = online.filter((agent) => agent.accountConfigured);
  const scoped = configured.filter((agent) => agent.scopeMatched);
  const withinDailyLimit = scoped.filter(
    (agent) => agent.dailyLimitAvailable,
  );
  const withinQuota = withinDailyLimit.filter((agent) => agent.quotaAvailable);

  return {
    siteId: product.site_id,
    product: {
      id: product.id,
      title: product.title,
      sectionId: product.section_id,
      categoryId: product.category_id,
    },
    businessDate,
    cursor: {
      lastAgentId,
      nextAgentId: next?.id ?? null,
    },
    funnel: {
      total: agents.length,
      enabled: enabled.length,
      online: online.length,
      accountConfigured: configured.length,
      scopeMatched: scoped.length,
      dailyLimitAvailable: withinDailyLimit.length,
      quotaAvailable: withinQuota.length,
      eligible: withinQuota.length,
    },
    agents,
  };
}
