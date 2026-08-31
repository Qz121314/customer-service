import { Hono, type Context } from 'hono';
import { hashAgentPassword } from './agent-password';
import { calendarMonthPeriod } from '../shared/calendar-month';
import {
  DEFAULT_NO_AGENT_MESSAGE,
  normalizeNoAgentMessage,
  normalizeNoAgentMessageFormat,
  type NoAgentMessageFormat,
} from './no-agent-message';

type Bindings = {
  DB: D1Database;
  CONVERSATION_ROOMS: DurableObjectNamespace;
  ADMIN_PASSWORD?: string;
};

type Env = { Bindings: Bindings };

type NoAgentMessageSettings = {
  message: string;
  format: NoAgentMessageFormat;
};

type AgentRow = {
  id: string;
  name: string;
  admin_label: string;
  username: string | null;
  status: 'online' | 'busy' | 'offline';
  is_enabled: number;
  daily_conversation_limit: number;
  traffic_quota_enabled: number;
  traffic_quota_total: number;
  traffic_quota_used: number;
  last_login_at: string | null;
  last_seen_at: string | null;
  password_hash: string | null;
  password_salt: string | null;
  password_iterations: number;
};

type ProductRow = {
  id: string;
  title: string;
  href: string | null;
  cover_url: string | null;
  section_id: string | null;
  section_name: string | null;
  category_id: string | null;
  category_name: string | null;
  is_enabled: number;
};

type ScopeType = 'section' | 'category' | 'product';

type ScopeRow = {
  agent_id: string;
  scope_type: ScopeType;
  section_id: string;
  category_id: string;
  product_id: string;
};

type QuotaAdjustmentRow = {
  id: string;
  request_id: string;
  amount: number;
  quota_total_before: number;
  quota_total_after: number;
  applied_at: string | null;
  created_at: string;
};

type AgentRoutingScope =
  | { type: 'none' }
  | { type: 'section'; sectionIds: string[] }
  | { type: 'category'; sectionId: string; categoryIds: string[] }
  | { type: 'product'; productIds: string[] };

const SESSION_COOKIE = 'cs_session';
const REPORTING_TIME_ZONE = 'America/Los_Angeles';

export const adminConfigApi = new Hono<Env>();

adminConfigApi.get('/api/admin/bootstrap', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const [agents, products, noAgentMessage] = await Promise.all([
    loadAgents(c.env.DB),
    loadProducts(c.env.DB),
    loadNoAgentMessage(c.env.DB),
  ]);
  return c.json({ agents, products, noAgentMessage });
});

adminConfigApi.get('/api/admin/no-agent-message', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  return c.json({ noAgentMessage: await loadNoAgentMessage(c.env.DB) });
});

adminConfigApi.put('/api/admin/no-agent-message', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const body = await readJson<{ message?: unknown; format?: unknown }>(
    c.req.raw,
  );
  const message = normalizeNoAgentMessage(body?.message);
  const format = normalizeNoAgentMessageFormat(body?.format);
  if (!message || !format) {
    return c.json({ error: 'INVALID_NO_AGENT_MESSAGE' }, 400);
  }
  await c.env.DB.prepare(
    `UPDATE sites
     SET no_agent_message = ?1,
         no_agent_message_format = ?2,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = 'default'`,
  )
    .bind(message, format)
    .run();
  return c.json({
    ok: true,
    noAgentMessage: { message, format },
  });
});

adminConfigApi.get('/api/admin/agents', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  return c.json({ agents: await loadAgents(c.env.DB) });
});

adminConfigApi.get('/api/admin/traffic-stats', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const requestedFrom = normalizeReportingDate(c.req.query('from'));
  const requestedTo = normalizeReportingDate(c.req.query('to'));
  if (!requestedFrom || !requestedTo || requestedFrom > requestedTo) {
    return c.json({ error: 'INVALID_REPORTING_RANGE' }, 400);
  }
  const retainedFrom = reportingRetentionCutoff();
  const today = reportingBusinessDate();
  const from = requestedFrom < retainedFrom ? retainedFrom : requestedFrom;
  const to = requestedTo > today ? today : requestedTo;
  if (from > to) return c.json({ error: 'REPORTING_RANGE_EXPIRED' }, 400);
  const result = await c.env.DB.prepare(
    `WITH scoped AS MATERIALIZED (
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
     ORDER BY dimension ASC, count DESC, item_name ASC`,
  )
    .bind(from, to)
    .all<{
      dimension: 'summary' | 'agent' | 'product';
      item_id: string | null;
      item_name: string | null;
      count: number;
    }>();
  const rows = result.results ?? [];

  return c.json({
    from,
    to,
    total: Number(rows.find((row) => row.dimension === 'summary')?.count ?? 0),
    agents: rows
      .filter((row) => row.dimension === 'agent')
      .map((row) => ({
        agentId: row.item_id === '__pending__' ? null : row.item_id,
        agentName: row.item_name ?? '待接待',
        count: Number(row.count),
      })),
    products: rows
      .filter((row) => row.dimension === 'product')
      .map((row) => ({
        productId: row.item_id === '__unknown__' ? null : row.item_id,
        productTitle: row.item_name ?? '未知产品',
        count: Number(row.count),
      })),
    retainedFrom,
  });
});

adminConfigApi.get('/api/admin/agent-stats', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const month = normalizeMonth(c.req.query('month'));
  const agentId = normalizeIdentifier(c.req.query('agentId'));
  if (!month) return c.json({ error: 'INVALID_MONTH' }, 400);
  if (!agentId) return c.json({ error: 'INVALID_AGENT' }, 400);
  const period = calendarMonthPeriod(month);
  const retainedFrom = reportingRetentionCutoff();
  const result = await c.env.DB.prepare(
    `SELECT CAST(substr(business_date, 9, 2) AS INTEGER) AS day,
       conversation_count AS count
     FROM agent_daily_stats
     WHERE site_id = 'default'
       AND business_date >= ?1
       AND business_date <= ?2
       AND business_date >= ?3
       AND agent_id = ?4
     ORDER BY business_date ASC`,
  )
    .bind(period.start, period.end, retainedFrom, agentId)
    .all<{ day: number; count: number }>();

  return c.json({
    month,
    agentId,
    days: period.days,
    counts: (result.results ?? []).map((row) => ({
      day: Number(row.day),
      count: Number(row.count),
    })),
    retainedFrom,
  });
});

adminConfigApi.post('/api/admin/agents', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const body = await readJson<{
    name?: string;
    adminLabel?: unknown;
    username?: string;
    password?: string;
    routingScope?: unknown;
    dailyConversationLimit?: number;
    trafficQuotaEnabled?: boolean;
    trafficQuotaTopUp?: number;
    trafficQuotaRequestId?: string;
    isEnabled?: boolean;
  }>(c.req.raw);

  const name = normalizeName(body?.name);
  const adminLabel = normalizeAdminLabel(body?.adminLabel);
  const username = normalizeUsername(body?.username);
  const password = normalizePassword(body?.password);
  if (!name || !username || !password) {
    return c.json({ error: 'INVALID_AGENT' }, 400);
  }
  if (adminLabel === null) {
    return c.json({ error: 'INVALID_AGENT_LABEL' }, 400);
  }
  if (await usernameExists(c.env.DB, username)) {
    return c.json({ error: 'USERNAME_EXISTS' }, 409);
  }

  const routingScope = await normalizeRoutingScope(
    c.env.DB,
    body?.routingScope,
  );
  if (!routingScope) {
    return c.json({ error: 'INVALID_ROUTING_SCOPE' }, 400);
  }

  const dailyLimit = normalizeDailyLimit(body?.dailyConversationLimit);
  const trafficQuotaTopUp = normalizeTrafficQuotaTopUp(body?.trafficQuotaTopUp);
  if (trafficQuotaTopUp === null) {
    return c.json({ error: 'INVALID_TRAFFIC_QUOTA' }, 400);
  }
  const trafficQuotaRequestId =
    trafficQuotaTopUp > 0
      ? normalizeQuotaRequestId(body?.trafficQuotaRequestId)
      : null;
  if (trafficQuotaTopUp > 0 && !trafficQuotaRequestId) {
    return c.json({ error: 'INVALID_QUOTA_REQUEST' }, 400);
  }
  const trafficQuotaEnabled = body?.trafficQuotaEnabled === true ? 1 : 0;
  const credentials = await hashAgentPassword(password);
  const id = crypto.randomUUID();
  const enabled = body?.isEnabled === false ? 0 : 1;
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO agents (
         id, site_id, name, admin_label, username, password_hash, password_salt,
         password_iterations, status, is_enabled, daily_conversation_limit,
         traffic_quota_enabled, traffic_quota_total
       ) VALUES (
         ?1, 'default', ?2, ?3, ?4, ?5, ?6, ?7, 'offline', ?8, ?9, ?10, ?11
       )`,
    ).bind(
      id,
      name,
      adminLabel,
      username,
      credentials.hash,
      credentials.salt,
      credentials.iterations,
      enabled,
      dailyLimit,
      trafficQuotaEnabled,
      trafficQuotaTopUp,
    ),
  ];
  if (trafficQuotaTopUp > 0 && trafficQuotaRequestId) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO agent_quota_adjustments (
           id, site_id, agent_id, request_id, amount,
           quota_total_before, quota_total_after, applied_at
         ) VALUES (
           ?1, 'default', ?2, ?3, ?4, 0, ?4, CURRENT_TIMESTAMP
         )`,
      ).bind(crypto.randomUUID(), id, trafficQuotaRequestId, trafficQuotaTopUp),
    );
  }
  statements.push(...routingScopeStatements(c.env.DB, id, routingScope));

  try {
    await c.env.DB.batch(statements);
  } catch (error) {
    console.error('agent.create.failed', error);
    if (String(error).includes('idx_agents_username')) {
      return c.json({ error: 'USERNAME_EXISTS' }, 409);
    }
    return c.json({ error: 'AGENT_CREATE_FAILED' }, 500);
  }
  return c.json({ ok: true, id }, 201);
});

adminConfigApi.get('/api/admin/agents/:id/quota-adjustments', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const id = c.req.param('id');
  const result = await c.env.DB.prepare(
    `SELECT id, request_id, amount, quota_total_before, quota_total_after,
       applied_at, created_at
     FROM agent_quota_adjustments
     WHERE site_id = 'default'
       AND agent_id = ?1
       AND applied_at IS NOT NULL
     ORDER BY created_at DESC, id DESC
     LIMIT 10`,
  )
    .bind(id)
    .all<QuotaAdjustmentRow>();
  return c.json({
    adjustments: (result.results ?? []).map((adjustment) => ({
      id: adjustment.id,
      requestId: adjustment.request_id,
      amount: Number(adjustment.amount),
      quotaTotalBefore: Number(adjustment.quota_total_before),
      quotaTotalAfter: Number(adjustment.quota_total_after),
      appliedAt: adjustment.applied_at,
      createdAt: adjustment.created_at,
    })),
  });
});

adminConfigApi.patch('/api/admin/agents/:id', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const id = c.req.param('id');
  if (id === 'admin') return c.json({ error: 'NOT_FOUND' }, 404);

  const current = await c.env.DB.prepare(
    `SELECT id, name, admin_label, username, status, is_enabled,
       daily_conversation_limit, last_login_at, last_seen_at, password_hash,
       password_salt, password_iterations, traffic_quota_enabled,
       traffic_quota_total, traffic_quota_used
     FROM agents WHERE id = ?1 AND site_id = 'default'`,
  )
    .bind(id)
    .first<AgentRow>();
  if (!current) return c.json({ error: 'NOT_FOUND' }, 404);

  const body = await readJson<{
    name?: string;
    adminLabel?: unknown;
    username?: string;
    password?: string;
    routingScope?: unknown;
    dailyConversationLimit?: number;
    trafficQuotaEnabled?: boolean;
    trafficQuotaTopUp?: number;
    trafficQuotaRequestId?: string;
    isEnabled?: boolean;
  }>(c.req.raw);
  if (!body) return c.json({ error: 'INVALID_AGENT' }, 400);

  const name =
    body.name === undefined ? current.name : normalizeName(body.name);
  const adminLabel =
    body.adminLabel === undefined
      ? current.admin_label
      : normalizeAdminLabel(body.adminLabel);
  const username =
    body.username === undefined
      ? current.username
      : normalizeUsername(body.username);
  if (!name || !username) return c.json({ error: 'INVALID_AGENT' }, 400);
  if (adminLabel === null) {
    return c.json({ error: 'INVALID_AGENT_LABEL' }, 400);
  }
  if (await usernameExists(c.env.DB, username, id)) {
    return c.json({ error: 'USERNAME_EXISTS' }, 409);
  }

  let passwordHash = current.password_hash;
  let passwordSalt = current.password_salt;
  let passwordIterations = current.password_iterations;
  if (body.password !== undefined && body.password !== '') {
    const password = normalizePassword(body.password);
    if (!password) return c.json({ error: 'INVALID_PASSWORD' }, 400);
    const credentials = await hashAgentPassword(password);
    passwordHash = credentials.hash;
    passwordSalt = credentials.salt;
    passwordIterations = credentials.iterations;
  }
  if (!passwordHash || !passwordSalt) {
    return c.json({ error: 'PASSWORD_REQUIRED' }, 400);
  }

  const enabled =
    body.isEnabled === undefined ? current.is_enabled : body.isEnabled ? 1 : 0;
  const dailyLimit =
    body.dailyConversationLimit === undefined
      ? current.daily_conversation_limit
      : normalizeDailyLimit(body.dailyConversationLimit);
  const trafficQuotaEnabled =
    body.trafficQuotaEnabled === undefined
      ? current.traffic_quota_enabled
      : body.trafficQuotaEnabled
        ? 1
        : 0;
  const trafficQuotaTopUp = normalizeTrafficQuotaTopUp(body.trafficQuotaTopUp);
  const trafficQuotaRequestId =
    Number(trafficQuotaTopUp) > 0
      ? normalizeQuotaRequestId(body.trafficQuotaRequestId)
      : null;
  if (
    trafficQuotaTopUp === null ||
    (trafficQuotaTopUp > 0 && !trafficQuotaRequestId)
  ) {
    return c.json(
      {
        error:
          trafficQuotaTopUp === null
            ? 'INVALID_TRAFFIC_QUOTA'
            : 'INVALID_QUOTA_REQUEST',
      },
      400,
    );
  }
  const existingAdjustment = trafficQuotaRequestId
    ? await c.env.DB.prepare(
        `SELECT id, request_id, amount, quota_total_before,
           quota_total_after, applied_at, created_at
         FROM agent_quota_adjustments
         WHERE site_id = 'default'
           AND agent_id = ?1
           AND request_id = ?2
         LIMIT 1`,
      )
        .bind(id, trafficQuotaRequestId)
        .first<QuotaAdjustmentRow>()
    : null;
  if (
    existingAdjustment &&
    Number(existingAdjustment.amount) !== trafficQuotaTopUp
  ) {
    return c.json({ error: 'QUOTA_REQUEST_CONFLICT' }, 409);
  }
  const pendingTrafficQuotaTopUp = existingAdjustment?.applied_at
    ? 0
    : trafficQuotaTopUp;
  if (current.traffic_quota_total + pendingTrafficQuotaTopUp > 2_000_000_000) {
    return c.json({ error: 'INVALID_TRAFFIC_QUOTA' }, 400);
  }

  const routingScope =
    body.routingScope === undefined
      ? await currentRoutingScope(c.env.DB, id)
      : await normalizeRoutingScope(c.env.DB, body.routingScope);
  if (!routingScope) {
    return c.json({ error: 'INVALID_ROUTING_SCOPE' }, 400);
  }

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE agents
       SET name = ?1,
           username = ?2,
           password_hash = ?3,
           password_salt = ?4,
           password_iterations = ?5,
           is_enabled = ?6,
           daily_conversation_limit = ?7,
           traffic_quota_enabled = ?8,
           admin_label = ?9,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?10 AND site_id = 'default'`,
    ).bind(
      name,
      username,
      passwordHash,
      passwordSalt,
      passwordIterations,
      enabled,
      dailyLimit,
      trafficQuotaEnabled,
      adminLabel,
      id,
    ),
  ];
  let quotaUpdateIndex = -1;
  if (
    trafficQuotaTopUp > 0 &&
    trafficQuotaRequestId &&
    !existingAdjustment?.applied_at
  ) {
    statements.push(
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO agent_quota_adjustments (
           id, site_id, agent_id, request_id, amount,
           quota_total_before, quota_total_after
         )
         SELECT ?1, 'default', id, ?2, ?3,
           traffic_quota_total, traffic_quota_total + ?3
         FROM agents
         WHERE id = ?4
           AND site_id = 'default'
           AND traffic_quota_total <= 2000000000 - ?3`,
      ).bind(crypto.randomUUID(), trafficQuotaRequestId, trafficQuotaTopUp, id),
    );
    quotaUpdateIndex = statements.length;
    statements.push(
      c.env.DB.prepare(
        `UPDATE agents
         SET traffic_quota_total = traffic_quota_total + ?1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?2
           AND site_id = 'default'
           AND traffic_quota_total <= 2000000000 - ?1
           AND EXISTS (
             SELECT 1
             FROM agent_quota_adjustments adjustment
             WHERE adjustment.site_id = 'default'
               AND adjustment.agent_id = agents.id
               AND adjustment.request_id = ?3
               AND adjustment.amount = ?1
               AND adjustment.applied_at IS NULL
           )`,
      ).bind(trafficQuotaTopUp, id, trafficQuotaRequestId),
      c.env.DB.prepare(
        `UPDATE agent_quota_adjustments
         SET applied_at = CURRENT_TIMESTAMP
         WHERE site_id = 'default'
           AND agent_id = ?1
           AND request_id = ?2
           AND amount = ?3
           AND applied_at IS NULL
           AND EXISTS (
             SELECT 1
             FROM agents
             WHERE agents.id = agent_quota_adjustments.agent_id
               AND agents.site_id = agent_quota_adjustments.site_id
               AND agents.traffic_quota_total = agent_quota_adjustments.quota_total_after
           )`,
      ).bind(id, trafficQuotaRequestId, trafficQuotaTopUp),
    );
  }
  statements.push(
    c.env.DB.prepare(
      `DELETE FROM agent_routing_scopes
       WHERE site_id = 'default' AND agent_id = ?1`,
    ).bind(id),
    ...routingScopeStatements(c.env.DB, id, routingScope),
  );
  const results = await c.env.DB.batch(statements);
  const quotaApplied =
    quotaUpdateIndex >= 0 &&
    Number(results[quotaUpdateIndex]?.meta?.changes ?? 0) === 1;
  if (
    trafficQuotaTopUp > 0 &&
    trafficQuotaRequestId &&
    !existingAdjustment?.applied_at &&
    !quotaApplied
  ) {
    const resolvedAdjustment = await c.env.DB.prepare(
      `SELECT id, request_id, amount, quota_total_before,
         quota_total_after, applied_at, created_at
       FROM agent_quota_adjustments
       WHERE site_id = 'default'
         AND agent_id = ?1
         AND request_id = ?2
       LIMIT 1`,
    )
      .bind(id, trafficQuotaRequestId)
      .first<QuotaAdjustmentRow>();
    if (
      !resolvedAdjustment?.applied_at ||
      Number(resolvedAdjustment.amount) !== trafficQuotaTopUp
    ) {
      return c.json(
        {
          error:
            resolvedAdjustment &&
            Number(resolvedAdjustment.amount) !== trafficQuotaTopUp
              ? 'QUOTA_REQUEST_CONFLICT'
              : 'QUOTA_TOP_UP_FAILED',
        },
        resolvedAdjustment ? 409 : 500,
      );
    }
  }
  return c.json({ ok: true, quotaApplied });
});

adminConfigApi.delete('/api/admin/agents/:id', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const id = c.req.param('id');
  if (id === 'admin') return c.json({ error: 'NOT_FOUND' }, 404);

  const current = await c.env.DB.prepare(
    `SELECT id
     FROM agents
     WHERE id = ?1 AND site_id = 'default'`,
  )
    .bind(id)
    .first<{ id: string }>();
  if (!current) return c.json({ error: 'NOT_FOUND' }, 404);

  try {
    const activeConversationIds = await assignedActiveConversationIds(
      c.env.DB,
      id,
    );
    if (activeConversationIds.length) {
      return c.json(
        {
          error: 'AGENT_HAS_ACTIVE_CONVERSATIONS',
          activeConversationCount: activeConversationIds.length,
        },
        409,
      );
    }

    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM agent_sessions WHERE agent_id = ?1').bind(
        id,
      ),
      c.env.DB.prepare(
        `UPDATE conversations
         SET cta_affinity_agent_id = NULL,
             cta_affinity_expires_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE cta_affinity_agent_id = ?1`,
      ).bind(id),
      c.env.DB.prepare(
        `DELETE FROM agents
         WHERE id = ?1 AND site_id = 'default'`,
      ).bind(id),
    ]);

    return c.json({
      ok: true,
      reassignedConversationCount: 0,
    });
  } catch (error) {
    console.error('agent.delete.failed', { agentId: id, error });
    return c.json({ error: 'AGENT_DELETE_FAILED' }, 500);
  }
});

adminConfigApi.get('/api/admin/products', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  return c.json({ products: await loadProducts(c.env.DB) });
});

async function loadNoAgentMessage(
  db: D1Database,
): Promise<NoAgentMessageSettings> {
  const row = await db
    .prepare(
      `SELECT no_agent_message, no_agent_message_format
       FROM sites
       WHERE id = 'default'
       LIMIT 1`,
    )
    .first<{
      no_agent_message: string | null;
      no_agent_message_format: NoAgentMessageFormat | null;
    }>();
  return {
    message: row?.no_agent_message?.trim() || DEFAULT_NO_AGENT_MESSAGE,
    format:
      normalizeNoAgentMessageFormat(row?.no_agent_message_format) ?? 'plain',
  };
}

async function loadAgents(db: D1Database) {
  const businessDate = reportingBusinessDate();
  const [agentsResult, assignmentsResult, todayResult] = await Promise.all([
    db
      .prepare(
        `SELECT id, name, admin_label, username, status, is_enabled,
           daily_conversation_limit, last_login_at, last_seen_at, password_hash,
           password_salt, password_iterations, traffic_quota_enabled,
           traffic_quota_total, traffic_quota_used
         FROM agents
         WHERE id <> 'admin'
         ORDER BY is_enabled DESC, name ASC, id ASC`,
      )
      .all<AgentRow>(),
    db
      .prepare(
        `SELECT agent_id, scope_type, section_id, category_id, product_id
         FROM agent_routing_scopes
         WHERE site_id = 'default'
           AND is_enabled = 1
         ORDER BY agent_id ASC, scope_type ASC, section_id ASC,
           category_id ASC, product_id ASC`,
      )
      .all<ScopeRow>(),
    db
      .prepare(
        `SELECT agent_id, conversation_count AS count
         FROM agent_daily_stats
         WHERE site_id = 'default'
           AND business_date = ?1`,
      )
      .bind(businessDate)
      .all<{ agent_id: string; count: number }>(),
  ]);

  const todayByAgent = new Map(
    (todayResult.results ?? []).map((row) => [row.agent_id, Number(row.count)]),
  );
  const rowsByAgent = new Map<string, ScopeRow[]>();
  for (const row of assignmentsResult.results ?? []) {
    const current = rowsByAgent.get(row.agent_id) ?? [];
    current.push(row);
    rowsByAgent.set(row.agent_id, current);
  }

  return (agentsResult.results ?? []).map((agent) => {
    const routingScope = scopeFromRows(rowsByAgent.get(agent.id) ?? []);
    return {
      id: agent.id,
      name: agent.name,
      adminLabel: agent.admin_label,
      username: agent.username,
      status: agent.status,
      isEnabled: agent.is_enabled === 1,
      dailyConversationLimit: agent.daily_conversation_limit,
      todayConversationCount: todayByAgent.get(agent.id) ?? 0,
      trafficQuotaEnabled: agent.traffic_quota_enabled === 1,
      trafficQuotaTotal: agent.traffic_quota_total,
      trafficQuotaUsed: agent.traffic_quota_used,
      trafficQuotaRemaining: Math.max(
        0,
        agent.traffic_quota_total - agent.traffic_quota_used,
      ),
      lastLoginAt: agent.last_login_at,
      lastSeenAt: agent.last_seen_at,
      hasPassword: Boolean(agent.password_hash && agent.password_salt),
      routingScope,
    };
  });
}

async function loadProducts(db: D1Database) {
  const result = await db
    .prepare(
      `SELECT id, title, href, cover_url, section_id, section_name,
         category_id, category_name, is_enabled
       FROM product_catalog
       WHERE site_id = 'default'
       ORDER BY is_enabled DESC,
         COALESCE(section_name, '') COLLATE NOCASE ASC,
         COALESCE(category_name, '') COLLATE NOCASE ASC,
         title COLLATE NOCASE ASC,
         id ASC`,
    )
    .all<ProductRow>();

  return (result.results ?? []).map((product) => ({
    id: product.id,
    title: product.title,
    href: product.href,
    coverUrl: product.cover_url,
    sectionId: product.section_id,
    sectionName: product.section_name,
    categoryId: product.category_id,
    categoryName: product.category_name,
    isEnabled: product.is_enabled === 1,
  }));
}

async function assignedActiveConversationIds(
  db: D1Database,
  agentId: string,
): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT id
       FROM conversations
       WHERE assigned_agent = ?1
         AND status IN ('open', 'pending')
         AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP
       ORDER BY last_message_at ASC, id ASC`,
    )
    .bind(agentId)
    .all<{ id: string }>();
  return (result.results ?? []).map((conversation) => conversation.id);
}

async function currentRoutingScope(
  db: D1Database,
  agentId: string,
): Promise<AgentRoutingScope> {
  const result = await db
    .prepare(
      `SELECT agent_id, scope_type, section_id, category_id, product_id
       FROM agent_routing_scopes
       WHERE site_id = 'default'
         AND agent_id = ?1
         AND is_enabled = 1
       ORDER BY scope_type ASC, section_id ASC, category_id ASC, product_id ASC`,
    )
    .bind(agentId)
    .all<ScopeRow>();
  return scopeFromRows(result.results ?? []);
}

function scopeFromRows(rows: ScopeRow[]): AgentRoutingScope {
  if (!rows.length) return { type: 'none' };

  const sectionRows = rows.filter((row) => row.scope_type === 'section');
  if (sectionRows.length) {
    return {
      type: 'section',
      sectionIds: distinct(sectionRows.map((row) => row.section_id)),
    };
  }

  const categoryRows = rows.filter((row) => row.scope_type === 'category');
  if (categoryRows.length) {
    return {
      type: 'category',
      sectionId: categoryRows[0]?.section_id ?? '',
      categoryIds: distinct(categoryRows.map((row) => row.category_id)),
    };
  }

  return {
    type: 'product',
    productIds: distinct(
      rows
        .filter((row) => row.scope_type === 'product')
        .map((row) => row.product_id),
    ),
  };
}

async function normalizeRoutingScope(
  db: D1Database,
  raw: unknown,
): Promise<AgentRoutingScope | null> {
  if (raw === undefined) return { type: 'none' };
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;

  if (raw.type === 'none') return { type: 'none' };

  if (raw.type === 'section') {
    if (!Array.isArray(raw.sectionIds)) return null;
    const sectionIds = normalizedIdentifiers(raw.sectionIds);
    if (!sectionIds.length) return null;
    return (await allEnabledSectionsExist(db, sectionIds))
      ? { type: 'section', sectionIds }
      : null;
  }

  if (raw.type === 'category') {
    const sectionId = normalizeIdentifier(raw.sectionId);
    if (!sectionId || !Array.isArray(raw.categoryIds)) return null;
    const categoryIds = normalizedIdentifiers(raw.categoryIds);
    if (!categoryIds.length) return null;
    return (await allEnabledCategoriesExist(db, sectionId, categoryIds))
      ? { type: 'category', sectionId, categoryIds }
      : null;
  }

  if (raw.type === 'product') {
    if (!Array.isArray(raw.productIds)) return null;
    const productIds = normalizedIdentifiers(raw.productIds);
    if (!productIds.length) return { type: 'none' };
    return (await allEnabledProductsExist(db, productIds))
      ? { type: 'product', productIds }
      : null;
  }

  return null;
}

function routingScopeStatements(
  db: D1Database,
  agentId: string,
  scope: AgentRoutingScope,
): D1PreparedStatement[] {
  if (scope.type === 'none') return [];

  if (scope.type === 'section') {
    return [
      db
        .prepare(
          `INSERT INTO agent_routing_scopes (
             site_id, agent_id, scope_type, section_id,
             category_id, product_id, is_enabled
           )
           SELECT 'default', ?1, 'section', CAST(requested.value AS TEXT),
             '', '', 1
           FROM json_each(?2) requested`,
        )
        .bind(agentId, JSON.stringify(scope.sectionIds)),
    ];
  }

  if (scope.type === 'category') {
    return [
      db
        .prepare(
          `INSERT INTO agent_routing_scopes (
             site_id, agent_id, scope_type, section_id,
             category_id, product_id, is_enabled
           )
           SELECT 'default', ?1, 'category', ?2,
             CAST(requested.value AS TEXT), '', 1
           FROM json_each(?3) requested`,
        )
        .bind(agentId, scope.sectionId, JSON.stringify(scope.categoryIds)),
    ];
  }

  return [
    db
      .prepare(
        `INSERT INTO agent_routing_scopes (
           site_id, agent_id, scope_type, section_id,
           category_id, product_id, is_enabled
         )
         SELECT 'default', ?1, 'product', '', '',
           CAST(requested.value AS TEXT), 1
         FROM json_each(?2) requested`,
      )
      .bind(agentId, JSON.stringify(scope.productIds)),
  ];
}

async function allEnabledSectionsExist(
  db: D1Database,
  sectionIds: string[],
): Promise<boolean> {
  return allRequestedScopeValuesExist(
    db,
    `SELECT COUNT(*) AS count
     FROM json_each(?1) requested
     WHERE EXISTS (
       SELECT 1
       FROM product_catalog product
       WHERE product.site_id = 'default'
         AND product.is_enabled = 1
         AND product.section_id = CAST(requested.value AS TEXT)
       LIMIT 1
     )`,
    [JSON.stringify(sectionIds)],
    sectionIds.length,
  );
}

async function allEnabledCategoriesExist(
  db: D1Database,
  sectionId: string,
  categoryIds: string[],
): Promise<boolean> {
  return allRequestedScopeValuesExist(
    db,
    `SELECT COUNT(*) AS count
     FROM json_each(?1) requested
     WHERE EXISTS (
       SELECT 1
       FROM product_catalog product
       WHERE product.site_id = 'default'
         AND product.is_enabled = 1
         AND product.section_id = ?2
         AND product.category_id = CAST(requested.value AS TEXT)
       LIMIT 1
     )`,
    [JSON.stringify(categoryIds), sectionId],
    categoryIds.length,
  );
}

async function allEnabledProductsExist(
  db: D1Database,
  productIds: string[],
): Promise<boolean> {
  if (!productIds.length) return true;
  return allRequestedScopeValuesExist(
    db,
    `SELECT COUNT(*) AS count
     FROM json_each(?1) requested
     WHERE EXISTS (
       SELECT 1
       FROM product_catalog product
       WHERE product.site_id = 'default'
         AND product.id = CAST(requested.value AS TEXT)
         AND product.is_enabled = 1
       LIMIT 1
     )`,
    [JSON.stringify(productIds)],
    productIds.length,
  );
}

async function allRequestedScopeValuesExist(
  db: D1Database,
  sql: string,
  bindings: string[],
  expectedCount: number,
): Promise<boolean> {
  const statement = db.prepare(sql).bind(...bindings);
  const row = await statement.first<{ count: number }>();
  return Number(row?.count ?? 0) === expectedCount;
}

function normalizedIdentifiers(values: unknown[]): string[] {
  return distinct(
    values
      .map((value) => normalizeIdentifier(value))
      .filter((value): value is string => Boolean(value)),
  );
}

function normalizeIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 500 ? trimmed : null;
}

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function adminAuthorized(c: Context<Env>): Promise<boolean> {
  const password = c.env.ADMIN_PASSWORD;
  if (!password) return false;
  const header = c.req.header('Cookie') ?? '';
  const token = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  if (!timingSafeEqual(signature, await hmac(password, payload))) return false;
  try {
    const session = JSON.parse(decode(payload)) as { exp?: number };
    return typeof session.exp === 'number' && session.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

function unauthorized(c: Context<Env>) {
  return c.json({ error: 'UNAUTHORIZED' }, 401);
}

async function usernameExists(
  db: D1Database,
  username: string,
  excludingId?: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id FROM agents
       WHERE lower(username) = lower(?1)
         AND (?2 IS NULL OR id <> ?2)
       LIMIT 1`,
    )
    .bind(username, excludingId ?? null)
    .first<{ id: string }>();
  return Boolean(row);
}

function normalizeName(value?: string): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed && trimmed.length <= 80 ? trimmed : null;
}

function normalizeAdminLabel(value: unknown): string | null {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length <= 10 ? trimmed : null;
}

function normalizeUsername(value?: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length < 2 || trimmed.length > 40 || /\s/u.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function normalizePassword(value?: string | null): string | null {
  if (!value || value.length < 4 || value.length > 128) return null;
  return value;
}

function normalizeDailyLimit(value?: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(9999, Math.trunc(value ?? 0)));
}

function normalizeTrafficQuotaTopUp(value?: number): number | null {
  if (value === undefined) return 0;
  if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
  return value >= 0 && value <= 1_000_000 ? value : null;
}

function normalizeQuotaRequestId(value?: string): string | null {
  const requestId = value?.trim() ?? '';
  return /^[A-Za-z0-9:_-]{8,120}$/u.test(requestId) ? requestId : null;
}

function normalizeMonth(value?: string): string | null {
  const month = value?.trim() ?? '';
  return /^\d{4}-(0[1-9]|1[0-2])$/u.test(month) ? month : null;
}

function normalizeReportingDate(value?: string): string | null {
  const date = value?.trim() ?? '';
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/u.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
    ? null
    : date;
}

function reportingBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORTING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function reportingRetentionCutoff(now = new Date()): string {
  const today = reportingBusinessDate(now);
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 89);
  return date.toISOString().slice(0, 10);
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function timingSafeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a[index] ^ b[index];
  }
  return diff === 0;
}

async function hmac(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(value),
  );
  return toBase64Url(new Uint8Array(signature));
}

function decode(value: string): string {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return new TextDecoder().decode(
    Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)),
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
