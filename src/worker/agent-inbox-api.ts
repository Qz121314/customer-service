import { Hono, type Context } from 'hono';
import { requireAgentSession, type AgentSessionIdentity } from './agent-session';
import { sendAgentPushForConversation } from './agent-push';
import { routingBusinessDate } from './routing';
import { assignWaitingConversations } from './waiting-assignment';

type Bindings = {
  DB: D1Database;
  CONVERSATION_ROOMS: DurableObjectNamespace;
};

type Env = { Bindings: Bindings };
type ConversationStatus = 'open' | 'pending' | 'closed';
type AgentAvailability = 'online' | 'busy';

type TransferTargetRow = {
  id: string;
  name: string;
  status: 'online' | 'busy' | 'offline';
  active_count: number;
  max_active_conversations: number;
};

type InboxConversationRow = Record<string, unknown> & {
  id: string;
  status: ConversationStatus;
  last_message_at: string;
  __overview_open?: number;
  __overview_pending?: number;
  __overview_closed?: number;
  __closed_rank?: number;
};

type ClosedCursor = {
  at: string;
  id: string;
};

const CLOSED_PREVIEW_LIMIT = 40;
const CLOSED_HISTORY_PAGE_LIMIT = 50;

export const agentInboxApi = new Hono<Env>();

agentInboxApi.get('/api/agent/conversations', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return unauthorized(c);
  const requestedStatus = normalizeStatus(c.req.query('status'));
  const cursor = normalizeClosedCursor(
    c.req.query('beforeAt'),
    c.req.query('beforeId'),
  );
  return c.json(
    await loadAgentInbox(c.env.DB, agent, requestedStatus, cursor),
  );
});

agentInboxApi.post('/api/agent/auth/heartbeat', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return unauthorized(c);
  const nextStatus: AgentAvailability =
    agent.status === 'busy' ? 'busy' : 'online';
  await c.env.DB.prepare(
    `UPDATE agents
     SET status = CASE WHEN status = 'busy' THEN 'busy' ELSE 'online' END,
         last_seen_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?1`,
  )
    .bind(agent.id)
    .run();
  if (nextStatus === 'online') {
    const assignedConversationIds = await assignWaitingConversations(
      c.env,
      agent.id,
    );
    scheduleAgentPush(c, assignedConversationIds);
  }
  return c.json({
    ok: true,
    ...(await loadAgentInbox(c.env.DB, { ...agent, status: nextStatus })),
  });
});

agentInboxApi.post('/api/agent/auth/status', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return unauthorized(c);
  const body = await readJson<{ status?: AgentAvailability }>(c.req.raw);
  if (body?.status !== 'online' && body?.status !== 'busy') {
    return c.json({ error: 'INVALID_AGENT_STATUS' }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE agents
     SET status = ?1, last_seen_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?2 AND is_enabled = 1`,
  )
    .bind(body.status, agent.id)
    .run();

  if (body.status === 'online') {
    const assignedConversationIds = await assignWaitingConversations(
      c.env,
      agent.id,
    );
    scheduleAgentPush(c, assignedConversationIds);
  }
  return c.json({
    ok: true,
    ...(await loadAgentInbox(c.env.DB, { ...agent, status: body.status })),
  });
});

async function loadAgentInbox(
  db: D1Database,
  agent: AgentSessionIdentity,
  requestedStatus: ConversationStatus | null = null,
  closedCursor: ClosedCursor | null = null,
) {
  if (requestedStatus) {
    return loadFilteredAgentInbox(db, agent, requestedStatus, closedCursor);
  }

  const statement = db.prepare(
    `WITH ranked AS (
       SELECT c.id, c.site_id, c.visitor_id, c.status, c.subject, c.group_id,
         c.product_id, c.section_id, c.section_name, c.category_id,
         c.category_name, c.product_title, c.product_cover_url, c.product_href,
         c.assigned_agent, c.agent_unread_count, c.last_message_at, c.created_at,
         c.expires_at, v.display_name AS visitor_name,
         SUM(CASE WHEN c.status = 'open' THEN 1 ELSE 0 END) OVER () AS __overview_open,
         SUM(CASE WHEN c.status = 'pending' THEN 1 ELSE 0 END) OVER () AS __overview_pending,
         SUM(CASE WHEN c.status = 'closed' THEN 1 ELSE 0 END) OVER () AS __overview_closed,
         CASE
           WHEN c.status = 'closed' THEN ROW_NUMBER() OVER (
             PARTITION BY c.status
             ORDER BY c.last_message_at DESC, c.id DESC
           )
           ELSE 0
         END AS __closed_rank,
         (SELECT body FROM messages m WHERE m.conversation_id = c.id
          ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message
       FROM conversations c
       JOIN visitors v ON v.id = c.visitor_id
       WHERE c.assigned_agent = ?1
         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP
     )
     SELECT * FROM ranked
     WHERE status <> 'closed' OR __closed_rank <= ?2
     ORDER BY CASE WHEN status = 'closed' THEN 1 ELSE 0 END,
       last_message_at DESC, id DESC`,
  );
  const transferTargetsRequest = loadTransferTargets(db, agent.id);
  const [result, quotaOverview, transferTargets] = await Promise.all([
    statement.bind(agent.id, CLOSED_PREVIEW_LIMIT).all<InboxConversationRow>(),
    loadAgentQuotaOverview(db, agent.id),
    transferTargetsRequest,
  ]);
  const conversations = result.results ?? [];
  const firstConversation = conversations[0];
  const counts = {
    open: Number(firstConversation?.__overview_open ?? 0),
    pending: Number(firstConversation?.__overview_pending ?? 0),
    closed: Number(firstConversation?.__overview_closed ?? 0),
  };
  let closedLoaded = 0;
  for (const conversation of conversations) {
    if (conversation.status === 'closed') closedLoaded += 1;
    delete conversation.__overview_open;
    delete conversation.__overview_pending;
    delete conversation.__overview_closed;
    delete conversation.__closed_rank;
  }
  const closedHasMore = counts.closed > closedLoaded;
  return {
    conversations,
    overview: {
      ...counts,
      total: counts.open + counts.pending + counts.closed,
      ...quotaOverview,
    },
    transferTargets,
    availability: agent.status === 'busy' ? 'busy' : 'online',
    history: {
      closedLoaded,
      closedHasMore,
      nextClosedCursor: closedHasMore
        ? closedHasMoreCursor(conversations)
        : null,
    },
  };
}

async function loadFilteredAgentInbox(
  db: D1Database,
  agent: AgentSessionIdentity,
  status: ConversationStatus,
  closedCursor: ClosedCursor | null,
) {
  const isClosed = status === 'closed';
  const fetchLimit = isClosed ? CLOSED_HISTORY_PAGE_LIMIT + 1 : null;
  const result = await db
    .prepare(
      `SELECT c.id, c.site_id, c.visitor_id, c.status, c.subject, c.group_id,
         c.product_id, c.section_id, c.section_name, c.category_id,
         c.category_name, c.product_title, c.product_cover_url, c.product_href,
         c.assigned_agent, c.agent_unread_count, c.last_message_at, c.created_at,
         c.expires_at, v.display_name AS visitor_name,
         (SELECT body FROM messages m WHERE m.conversation_id = c.id
          ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message
       FROM conversations c
       JOIN visitors v ON v.id = c.visitor_id
       WHERE c.assigned_agent = ?1
         AND c.status = ?2
         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP
         AND (
           ?3 IS NULL
           OR c.last_message_at < ?3
           OR (c.last_message_at = ?3 AND c.id < ?4)
         )
       ORDER BY c.last_message_at DESC, c.id DESC
       LIMIT COALESCE(?5, -1)`,
    )
    .bind(
      agent.id,
      status,
      isClosed ? closedCursor?.at ?? null : null,
      isClosed ? closedCursor?.id ?? null : null,
      fetchLimit,
    )
    .all<InboxConversationRow>();
  const rows = result.results ?? [];
  const hasMore = isClosed && rows.length > CLOSED_HISTORY_PAGE_LIMIT;
  const conversations = isClosed
    ? rows.slice(0, CLOSED_HISTORY_PAGE_LIMIT)
    : rows;
  const [overview, transferTargets] = await Promise.all([
    loadAgentOverview(db, agent.id),
    loadTransferTargets(db, agent.id),
  ]);
  return {
    conversations,
    overview,
    transferTargets,
    availability: agent.status === 'busy' ? 'busy' : 'online',
    history: {
      closedLoaded: conversations.length,
      closedHasMore: hasMore,
      nextClosedCursor: hasMore ? closedHasMoreCursor(conversations) : null,
    },
  };
}

async function loadAgentQuotaOverview(db: D1Database, agentId: string) {
  const businessDate = routingBusinessDate();
  const quotaRow = await db
    .prepare(
      `SELECT a.daily_conversation_limit, a.traffic_quota_enabled,
         a.traffic_quota_total, a.traffic_quota_used,
         COALESCE(s.conversation_count, 0) AS today_count
       FROM agents a
       LEFT JOIN agent_daily_stats s
         ON s.site_id = a.site_id
        AND s.agent_id = a.id
        AND s.business_date = ?2
       WHERE a.id = ?1
       LIMIT 1`,
    )
    .bind(agentId, businessDate)
    .first<{
      daily_conversation_limit: number;
      today_count: number;
      traffic_quota_enabled: number;
      traffic_quota_total: number;
      traffic_quota_used: number;
    }>();
  return {
    todayAccepted: Number(quotaRow?.today_count ?? 0),
    dailyLimit: Number(quotaRow?.daily_conversation_limit ?? 0),
    trafficQuotaEnabled: quotaRow?.traffic_quota_enabled === 1,
    trafficQuotaTotal: Number(quotaRow?.traffic_quota_total ?? 0),
    trafficQuotaUsed: Number(quotaRow?.traffic_quota_used ?? 0),
    trafficQuotaRemaining: Math.max(
      0,
      Number(quotaRow?.traffic_quota_total ?? 0) -
        Number(quotaRow?.traffic_quota_used ?? 0),
    ),
  };
}

async function loadAgentOverview(db: D1Database, agentId: string) {
  const [statusResult, quotaOverview] = await Promise.all([
    db
      .prepare(
        `SELECT status, COUNT(*) AS count
         FROM conversations
         WHERE assigned_agent = ?1
           AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP
         GROUP BY status`,
      )
      .bind(agentId)
      .all<{ status: ConversationStatus; count: number }>(),
    loadAgentQuotaOverview(db, agentId),
  ]);
  const counts = { open: 0, pending: 0, closed: 0 };
  for (const row of statusResult.results ?? []) {
    counts[row.status] = Number(row.count ?? 0);
  }
  return {
    ...counts,
    total: counts.open + counts.pending + counts.closed,
    ...quotaOverview,
  };
}

async function loadTransferTargets(db: D1Database, agentId: string) {
  const businessDate = routingBusinessDate();
  const result = await db
    .prepare(
      `SELECT a.id, a.name, a.status, a.max_active_conversations,
         COUNT(load.id) AS active_count
       FROM agents current
       JOIN agents a ON a.site_id = current.site_id AND a.id <> current.id
       LEFT JOIN conversations load
         ON load.assigned_agent = a.id
        AND load.status IN ('open', 'pending')
        AND COALESCE(load.expires_at, datetime(load.created_at, '+1 day')) > CURRENT_TIMESTAMP
       LEFT JOIN agent_daily_stats daily
         ON daily.site_id = a.site_id
        AND daily.agent_id = a.id
        AND daily.business_date = ?2
       WHERE current.id = ?1
         AND a.is_enabled = 1
         AND a.status = 'online'
         AND a.username IS NOT NULL
         AND a.password_hash IS NOT NULL
         AND a.last_seen_at IS NOT NULL
         AND datetime(a.last_seen_at) >= datetime('now', '-2 minutes')
         AND (
           a.daily_conversation_limit = 0
           OR COALESCE(daily.conversation_count, 0) < a.daily_conversation_limit
         )
         AND (
           a.traffic_quota_enabled = 0
           OR a.traffic_quota_used < a.traffic_quota_total
         )
       GROUP BY a.id, a.name, a.status, a.max_active_conversations
       HAVING (
         a.max_active_conversations = 0
         OR COUNT(load.id) < a.max_active_conversations
       )
       ORDER BY COUNT(load.id) ASC, a.name ASC, a.id ASC`,
    )
    .bind(agentId, businessDate)
    .all<TransferTargetRow>();
  return result.results ?? [];
}

function normalizeStatus(value?: string): ConversationStatus | null {
  return value === 'open' || value === 'pending' || value === 'closed'
    ? value
    : null;
}

function normalizeClosedCursor(
  atValue?: string,
  idValue?: string,
): ClosedCursor | null {
  if (!atValue && !idValue) return null;
  const at = atValue?.trim() ?? '';
  const id = idValue?.trim() ?? '';
  if (
    !at ||
    at.length > 40 ||
    !Number.isFinite(Date.parse(at)) ||
    !id ||
    id.length > 200
  ) {
    return null;
  }
  return { at, id };
}

function closedHasMoreCursor(
  conversations: InboxConversationRow[],
): ClosedCursor | null {
  const closed = conversations.filter((item) => item.status === 'closed');
  const last = closed.at(-1);
  return last ? { at: last.last_message_at, id: last.id } : null;
}

function scheduleAgentPush(c: Context<Env>, conversationIds: string[]): void {
  for (const conversationId of conversationIds) {
    c.executionCtx.waitUntil(
      sendAgentPushForConversation(c.env, conversationId).catch((error) => {
        console.warn('Agent push dispatch failed.', error);
      }),
    );
  }
}

function unauthorized(c: Context<Env>) {
  return c.json({ error: 'UNAUTHORIZED' }, 401);
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
