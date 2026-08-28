import { Hono } from 'hono';
import { routingBusinessDate } from './routing';
import {
  authenticateAgentSession,
  type AgentSessionIdentity,
} from './agent-session';

type Bindings = {
  DB: D1Database;
  CONVERSATION_ROOMS: DurableObjectNamespace;
};

type Env = { Bindings: Bindings };
type ConversationStatus = 'open' | 'pending' | 'closed';

const CLOSED_INBOX_PREVIEW_LIMIT = 40;

export const agentBootstrapApi = new Hono<Env>();

// Initial dashboard hydration uses one external Worker request and one session
// lookup. The inbox query intentionally mirrors the unfiltered agent inbox so
// the existing AgentPortal startup state remains unchanged.
agentBootstrapApi.get('/api/agent/bootstrap', async (c) => {
  const agent = await authenticateAgentSession(
    c.env.DB,
    c.req.header('Cookie'),
  );
  if (!agent) {
    return c.json({ authenticated: false, agent: null, inbox: null });
  }

  return c.json({
    authenticated: true,
    agent,
    inbox: await loadBootstrapInbox(c.env.DB, agent),
  });
});

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

async function loadBootstrapInbox(
  db: D1Database,
  agent: AgentSessionIdentity,
) {
  type InboxConversationRow = Record<string, unknown> & {
    id: string;
    status: ConversationStatus;
    last_message_at: string;
    __overview_open?: number;
    __overview_pending?: number;
    __overview_closed?: number;
    __closed_rank?: number;
  };

  const statement = db.prepare(
    `WITH ranked AS (
       SELECT c.id, c.site_id, c.visitor_id, c.status, c.subject,
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
         c.last_message_preview AS last_message
       FROM conversations c
       JOIN visitors v ON v.id = c.visitor_id
       WHERE c.assigned_agent = ?1
         AND c.expires_at > CURRENT_TIMESTAMP
     )
     SELECT * FROM ranked
     WHERE status <> 'closed' OR __closed_rank <= ?2
     ORDER BY CASE WHEN status = 'closed' THEN 1 ELSE 0 END,
       last_message_at DESC, id DESC`,
  );

  const [result, quotaOverview] = await Promise.all([
    statement
      .bind(agent.id, CLOSED_INBOX_PREVIEW_LIMIT)
      .all<InboxConversationRow>(),
    loadAgentQuotaOverview(db, agent.id),
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

  return {
    conversations,
    overview: {
      ...counts,
      total: counts.open + counts.pending + counts.closed,
      ...quotaOverview,
    },
    availability: agent.status === 'busy' ? 'busy' : 'online',
    history: {
      closedLoaded,
      closedHasMore: counts.closed > closedLoaded,
    },
  };
}
