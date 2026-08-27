import { Hono, type Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { routingBusinessDate } from './routing';
import { broadcastClientConversationEvent } from './client-api';
import { verifyAgentPassword } from './agent-password';
import { calendarMonthPeriod } from '../shared/calendar-month';
import { listConversationMedia } from './media-api';
import { sendAgentPushForConversation } from './agent-push';
import { assignWaitingConversations } from './waiting-assignment';

type Bindings = {
  DB: D1Database;
  CONVERSATION_ROOMS: DurableObjectNamespace;
};

type Env = { Bindings: Bindings };
type ConversationStatus = 'open' | 'pending' | 'closed';
type AgentAvailability = 'online' | 'busy';

type AgentSession = {
  id: string;
  name: string;
  username: string;
  status: 'online' | 'busy' | 'offline';
};

type AgentCredentialRow = AgentSession & {
  password_hash: string;
  password_salt: string;
  password_iterations: number;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_type: 'visitor' | 'agent' | 'system';
  sender_id: string | null;
  body: string;
  client_message_id: string | null;
  read_by_visitor_at: string | null;
  read_by_agent_at: string | null;
  created_at: string;
};

type MessageReadState = Pick<
  MessageRow,
  'id' | 'read_by_visitor_at' | 'read_by_agent_at'
>;

type ReadBoundary = {
  id: string;
  created_at: string;
};

const COOKIE = 'cs_agent_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const MESSAGE_LIMIT = 8000;
const CLOSED_INBOX_PREVIEW_LIMIT = 40;

export const agentApi = new Hono<Env>();

agentApi.get('/api/agent/auth/session', async (c) => {
  const agent = await authenticateAgent(c);
  return c.json({ authenticated: Boolean(agent), agent: agent ?? null });
});

agentApi.patch('/api/agent/profile', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);
  const body = await readJson<{ nickname?: string }>(c.req.raw);
  const nickname = body?.nickname?.trim() ?? '';
  if (!nickname || nickname.length > 40) {
    return c.json({ error: 'INVALID_AGENT_NICKNAME' }, 400);
  }

  const updated = await c.env.DB.prepare(
    `UPDATE agents
     SET name = ?1, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?2 AND is_enabled = 1
     RETURNING id, name, username, status`,
  )
    .bind(nickname, agent.id)
    .first<AgentSession>();
  if (!updated) return unauthorized(c);
  return c.json({ ok: true, agent: updated });
});

agentApi.post('/api/agent/auth/login', async (c) => {
  const body = await readJson<{ username?: string; password?: string }>(
    c.req.raw,
  );
  const username = body?.username?.trim() ?? '';
  const password = body?.password ?? '';
  if (!username || !password)
    return c.json({ error: 'INVALID_CREDENTIALS' }, 401);

  const agent = await c.env.DB.prepare(
    `SELECT id, name, username, status, password_hash, password_salt, password_iterations
     FROM agents
     WHERE lower(username) = lower(?1)
       AND is_enabled = 1
       AND password_hash IS NOT NULL
       AND password_salt IS NOT NULL
     LIMIT 1`,
  )
    .bind(username)
    .first<AgentCredentialRow>();
  if (
    !agent ||
    !(await verifyAgentPassword(
      password,
      agent.password_hash,
      agent.password_salt,
      agent.password_iterations,
    ))
  ) {
    return c.json({ error: 'INVALID_CREDENTIALS' }, 401);
  }

  const token = randomToken();
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_SECONDS * 1000,
  ).toISOString();
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO agent_sessions (id, agent_id, token_hash, expires_at)
       VALUES (?1, ?2, ?3, ?4)`,
    ).bind(sessionId, agent.id, await sha256(token), expiresAt),
    c.env.DB.prepare(
      `UPDATE agents
       SET status = 'online', last_login_at = ?1, last_seen_at = ?1,
           updated_at = ?1
       WHERE id = ?2`,
    ).bind(now, agent.id),
    c.env.DB.prepare(
      `DELETE FROM agent_sessions
       WHERE datetime(expires_at) <= CURRENT_TIMESTAMP`,
    ),
  ]);

  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  const assignedConversationIds = await assignWaitingConversations(
    c.env,
    agent.id,
  );
  scheduleAgentPush(c, assignedConversationIds);
  return c.json({
    ok: true,
    agent: {
      id: agent.id,
      name: agent.name,
      username: agent.username,
      status: 'online',
    },
  });
});

agentApi.post('/api/agent/auth/logout', async (c) => {
  const token = cookieValue(c.req.header('Cookie'), COOKIE);
  const agent = token ? await authenticateAgentToken(c.env.DB, token) : null;
  if (token) {
    await c.env.DB.prepare('DELETE FROM agent_sessions WHERE token_hash = ?1')
      .bind(await sha256(token))
      .run();
  }
  if (agent) {
    await c.env.DB.prepare(
      `UPDATE agents
       SET status = 'offline', last_seen_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1`,
    )
      .bind(agent.id)
      .run();
  }
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

agentApi.post('/api/agent/auth/heartbeat', async (c) => {
  const agent = await authenticateAgent(c);
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

agentApi.post('/api/agent/auth/status', async (c) => {
  const agent = await authenticateAgent(c);
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

agentApi.get('/api/agent/overview', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);
  return c.json(await loadAgentOverview(c.env.DB, agent.id));
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

async function loadAgentOverview(db: D1Database, agentId: string) {
  const [statusResult, quotaOverview] = await Promise.all([
    db
      .prepare(
        `SELECT status, COUNT(*) AS count
       FROM conversations
       WHERE assigned_agent = ?1
         AND expires_at > CURRENT_TIMESTAMP
       GROUP BY status`,
      )
      .bind(agentId)
      .all<{ status: ConversationStatus; count: number }>(),
    loadAgentQuotaOverview(db, agentId),
  ]);
  const counts = { open: 0, pending: 0, closed: 0 };
  for (const row of statusResult.results ?? [])
    counts[row.status] = Number(row.count ?? 0);
  return {
    ...counts,
    total: counts.open + counts.pending + counts.closed,
    ...quotaOverview,
  };
}

async function loadAgentInbox(
  db: D1Database,
  agent: AgentSession,
  requestedStatus?: string,
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

  const filtered =
    requestedStatus === 'open' ||
    requestedStatus === 'pending' ||
    requestedStatus === 'closed';

  if (filtered) {
    const shouldBoundClosed = requestedStatus === 'closed';
    const statement = db.prepare(
      `SELECT c.id, c.site_id, c.visitor_id, c.status, c.subject,
         c.product_id, c.section_id, c.section_name, c.category_id,
         c.category_name, c.product_title, c.product_cover_url, c.product_href,
         c.assigned_agent, c.agent_unread_count, c.last_message_at, c.created_at,
         c.expires_at, v.display_name AS visitor_name,
         c.last_message_preview AS last_message
       FROM conversations c
       JOIN visitors v ON v.id = c.visitor_id
       WHERE c.assigned_agent = ?1
         AND c.status = ?2
         AND c.expires_at > CURRENT_TIMESTAMP
       ORDER BY c.last_message_at DESC, c.id DESC
       LIMIT COALESCE(?3, -1)`,
    );
    const [result, overview] = await Promise.all([
      statement
        .bind(
          agent.id,
          requestedStatus,
          shouldBoundClosed ? CLOSED_INBOX_PREVIEW_LIMIT : null,
        )
        .all<InboxConversationRow>(),
      loadAgentOverview(db, agent.id),
    ]);
    return {
      conversations: result.results ?? [],
      overview,
      availability: agent.status === 'busy' ? 'busy' : 'online',
    };
  }

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

agentApi.get('/api/agent/stats', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);
  const month = normalizeMonth(c.req.query('month'));
  if (!month) return c.json({ error: 'INVALID_MONTH' }, 400);
  const period = calendarMonthPeriod(month);

  const businessDate = routingBusinessDate();
  const retainedFrom = retentionCutoffBusinessDate();
  const [result, quotaRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT CAST(substr(business_date, 9, 2) AS INTEGER) AS day,
         conversation_count AS count
       FROM agent_daily_stats
       WHERE agent_id = ?1
         AND business_date >= ?2
         AND business_date <= ?3
         AND business_date >= ?4
       ORDER BY business_date ASC`,
    )
      .bind(agent.id, period.start, period.end, retainedFrom)
      .all<{ day: number; count: number }>(),
    c.env.DB.prepare(
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
      .bind(agent.id, businessDate)
      .first<{
        daily_conversation_limit: number;
        today_count: number;
        traffic_quota_enabled: number;
        traffic_quota_total: number;
        traffic_quota_used: number;
      }>(),
  ]);
  const counts = (result.results ?? []).map((row) => ({
    day: Number(row.day),
    count: Number(row.count),
  }));
  return c.json({
    month,
    days: period.days,
    counts,
    total: counts.reduce((sum, row) => sum + row.count, 0),
    todayCount: Number(quotaRow?.today_count ?? 0),
    dailyLimit: Number(quotaRow?.daily_conversation_limit ?? 0),
    trafficQuotaEnabled: quotaRow?.traffic_quota_enabled === 1,
    trafficQuotaTotal: Number(quotaRow?.traffic_quota_total ?? 0),
    trafficQuotaUsed: Number(quotaRow?.traffic_quota_used ?? 0),
    trafficQuotaRemaining: Math.max(
      0,
      Number(quotaRow?.traffic_quota_total ?? 0) -
        Number(quotaRow?.traffic_quota_used ?? 0),
    ),
    retainedFrom,
  });
});

agentApi.get('/api/agent/conversations', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);
  return c.json(await loadAgentInbox(c.env.DB, agent, c.req.query('status')));
});

agentApi.get('/api/agent/conversations/:id/messages', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);
  const afterIdValue = c.req.query('afterId');
  const afterCreatedAtValue = c.req.query('afterCreatedAt');
  const afterId = normalizeMessageId(afterIdValue);
  const afterCreatedAt = normalizeCursorDateTime(afterCreatedAtValue);
  if (
    (afterIdValue !== undefined || afterCreatedAtValue !== undefined) &&
    (!afterId || !afterCreatedAt)
  ) {
    return c.json({ error: 'INVALID_MESSAGE_CURSOR' }, 400);
  }
  const after =
    afterId && afterCreatedAt
      ? { id: afterId, createdAt: afterCreatedAt }
      : null;
  const conversation = await assignedConversation(
    c.env.DB,
    c.req.param('id'),
    agent.id,
  );
  if (!conversation) return c.json({ error: 'NOT_FOUND' }, 404);
  const readStateRequest = after
    ? c.env.DB.prepare(
        `SELECT id, read_by_visitor_at, read_by_agent_at
         FROM messages
         WHERE conversation_id = ?1
           AND (read_by_visitor_at IS NOT NULL OR read_by_agent_at IS NOT NULL)
         ORDER BY created_at ASC, id ASC
         LIMIT 500`,
      )
        .bind(c.req.param('id'))
        .all<MessageReadState>()
    : Promise.resolve({ results: [] as MessageReadState[] });
  const [messages, media, readState] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, conversation_id, sender_type, sender_id, body,
       client_message_id, read_by_visitor_at, read_by_agent_at, created_at
     FROM messages
     WHERE conversation_id = ?1
       AND (
         ?2 IS NULL
         OR created_at > ?2
         OR (created_at = ?2 AND id > ?3)
       )
     ORDER BY created_at ASC, id ASC
     LIMIT 500`,
    )
      .bind(c.req.param('id'), after?.createdAt ?? null, after?.id ?? null)
      .all<MessageRow>(),
    listConversationMedia(c.env.DB, c.req.param('id'), after),
    readStateRequest,
  ]);
  return c.json({
    conversation,
    messages: messages.results ?? [],
    media,
    readState: readState.results ?? [],
  });
});

agentApi.post('/api/agent/conversations/:id/read', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);
  const id = c.req.param('id');
  const body = await readJson<{ lastMessageId?: string | null }>(c.req.raw);
  const requestedLastMessageId = normalizeMessageId(body?.lastMessageId);
  let boundary: ReadBoundary | null = null;
  if (requestedLastMessageId) {
    boundary = await c.env.DB.prepare(
      `SELECT m.id, m.created_at
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.id = ?1 AND m.conversation_id = ?2
         AND m.sender_type = 'visitor'
         AND c.assigned_agent = ?3
         AND c.expires_at > CURRENT_TIMESTAMP
       LIMIT 1`,
    )
      .bind(requestedLastMessageId, id, agent.id)
      .first<ReadBoundary>();
  }

  const [readResult, conversationResult] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE messages
       SET read_by_agent_at = COALESCE(read_by_agent_at, CURRENT_TIMESTAMP)
       WHERE conversation_id = ?1
         AND sender_type = 'visitor'
         AND EXISTS (
           SELECT 1
           FROM conversations c
           WHERE c.id = ?1 AND c.assigned_agent = ?4
             AND c.expires_at > CURRENT_TIMESTAMP
         )
         AND (
           ?2 IS NULL
           OR created_at < ?3
           OR (created_at = ?3 AND id <= ?2)
         )`,
    ).bind(id, boundary?.id ?? null, boundary?.created_at ?? null, agent.id),
    c.env.DB.prepare(
      `UPDATE conversations
       SET agent_unread_count = (
         SELECT COUNT(*)
         FROM messages
         WHERE conversation_id = ?1
           AND sender_type = 'visitor'
           AND read_by_agent_at IS NULL
       ),
       updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND assigned_agent = ?2
         AND expires_at > CURRENT_TIMESTAMP`,
    ).bind(id, agent.id),
  ]);

  if (!conversationResult.meta.changes) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  if (readResult.meta.changes) {
    await Promise.all([
      broadcastConversationRoom(c.env, id, {
        type: 'message.read',
        reader: 'agent',
        lastMessageId: boundary?.id ?? null,
      }),
      broadcastClientConversationEvent(c.env, id, 'message.read', {
        reader: 'agent',
        lastMessageId: boundary?.id ?? null,
      }),
    ]);
  }
  return c.json({ ok: true });
});

agentApi.post('/api/agent/conversations/:id/messages', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);
  const id = c.req.param('id');
  const conversation = await assignedConversationForMessageWrite(
    c.env.DB,
    id,
    agent.id,
  );
  if (!conversation) return c.json({ error: 'NOT_FOUND' }, 404);

  const body = await readJson<{ body?: string; clientMessageId?: string }>(
    c.req.raw,
  );
  const text = body?.body?.trim() ?? '';
  const clientMessageId = normalizeMessageId(body?.clientMessageId);
  if (
    !text ||
    text.length > MESSAGE_LIMIT ||
    (body?.clientMessageId !== undefined && !clientMessageId)
  )
    return c.json({ error: 'INVALID_MESSAGE' }, 400);

  if (conversation.status === 'closed') {
    const existing = clientMessageId
      ? await findAgentMessageByClientId(
          c.env.DB,
          id,
          agent.id,
          clientMessageId,
        )
      : null;
    if (existing) return c.json({ message: existing, duplicate: true });
    return c.json({ error: 'CONVERSATION_CLOSED' }, 409);
  }

  const messageId = crypto.randomUUID();
  const now = new Date().toISOString();
  const inserted = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO messages
       (id, conversation_id, sender_type, sender_id, body, client_message_id, created_at)
     VALUES (?1, ?2, 'agent', ?3, ?4, ?5, ?6)`,
  )
    .bind(messageId, id, agent.id, text, clientMessageId, now)
    .run();

  if (!inserted.meta.changes && clientMessageId) {
    const existing = await findAgentMessageByClientId(
      c.env.DB,
      id,
      agent.id,
      clientMessageId,
    );
    if (existing) return c.json({ message: existing, duplicate: true });
    return c.json({ error: 'MESSAGE_ID_CONFLICT' }, 409);
  }

  await c.env.DB.prepare(
    `UPDATE conversations
     SET status = CASE WHEN status = 'open' THEN 'pending' ELSE status END,
         visitor_unread_count = visitor_unread_count + 1,
         agent_unread_count = 0,
         last_message_at = ?1,
         last_message_preview = ?2,
         updated_at = ?1
     WHERE id = ?3 AND assigned_agent = ?4
       AND expires_at > CURRENT_TIMESTAMP`,
  )
    .bind(now, text, id, agent.id)
    .run();
  const message: MessageRow = {
    id: messageId,
    conversation_id: id,
    sender_type: 'agent',
    sender_id: agent.id,
    body: text,
    client_message_id: clientMessageId,
    read_by_visitor_at: null,
    read_by_agent_at: null,
    created_at: now,
  };
  await broadcastConversationRoom(c.env, id, { type: 'message', message });
  await broadcastClientConversationEvent(
    c.env,
    id,
    'message.created',
    { message: clientRealtimeMessage(message) },
    { includeOverview: conversation.status === 'open' },
  );
  return c.json({ message }, 201);
});

agentApi.post('/api/agent/conversations/:id/status', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);
  const id = c.req.param('id');
  const body = await readJson<{ status?: ConversationStatus }>(c.req.raw);
  if (!body || !['open', 'pending', 'closed'].includes(body.status ?? '')) {
    return c.json({ error: 'INVALID_STATUS' }, 400);
  }
  const result = await c.env.DB.prepare(
    `UPDATE conversations
     SET status = ?1, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?2 AND assigned_agent = ?3
       AND expires_at > CURRENT_TIMESTAMP`,
  )
    .bind(body.status, id, agent.id)
    .run();
  if (!result.meta.changes) return c.json({ error: 'NOT_FOUND' }, 404);

  await broadcastConversationRoom(c.env, id, {
    type: 'conversation.status',
    status: body.status,
  });
  await broadcastClientConversationEvent(
    c.env,
    id,
    body.status === 'closed' ? 'conversation.closed' : 'conversation.assigned',
  );
  if (body.status === 'closed') {
    await assignWaitingConversations(c.env, agent.id);
  }
  return c.json({ ok: true });
});

agentApi.get('/api/agent/realtime/inbox', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);
  return room(c.env, agentInboxRoom(agent.id)).fetch(
    authenticatedRealtimeRequest(c.req.raw, agent.id),
  );
});

agentApi.get('/api/agent/realtime/:id', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);
  const conversation = await assignedConversation(
    c.env.DB,
    c.req.param('id'),
    agent.id,
  );
  if (!conversation) return c.json({ error: 'NOT_FOUND' }, 404);
  return room(c.env, c.req.param('id')).fetch(
    authenticatedRealtimeRequest(c.req.raw, agent.id),
  );
});

async function authenticateAgent(
  c: Context<Env>,
): Promise<AgentSession | null> {
  const token = cookieValue(c.req.header('Cookie'), COOKIE);
  if (!token) return null;
  return authenticateAgentToken(c.env.DB, token);
}

async function authenticateAgentToken(
  db: D1Database,
  token: string,
): Promise<AgentSession | null> {
  return db
    .prepare(
      `SELECT a.id, a.name, a.username, a.status
       FROM agent_sessions s
       JOIN agents a ON a.id = s.agent_id
       WHERE s.token_hash = ?1
         AND datetime(s.expires_at) > CURRENT_TIMESTAMP
         AND a.is_enabled = 1
         AND a.username IS NOT NULL
       LIMIT 1`,
    )
    .bind(await sha256(token))
    .first<AgentSession>();
}

async function assignedConversationForMessageWrite(
  db: D1Database,
  id: string,
  agentId: string,
) {
  return db
    .prepare(
      `SELECT id, status
       FROM conversations
       WHERE id = ?1 AND assigned_agent = ?2
         AND expires_at > CURRENT_TIMESTAMP
       LIMIT 1`,
    )
    .bind(id, agentId)
    .first<{ id: string; status: ConversationStatus }>();
}

async function assignedConversation(
  db: D1Database,
  id: string,
  agentId: string,
) {
  return db
    .prepare(
      `SELECT c.*, v.display_name AS visitor_name
       FROM conversations c
       JOIN visitors v ON v.id = c.visitor_id
       WHERE c.id = ?1 AND c.assigned_agent = ?2
         AND c.expires_at > CURRENT_TIMESTAMP
       LIMIT 1`,
    )
    .bind(id, agentId)
    .first<Record<string, unknown> & { status: ConversationStatus }>();
}

async function findAgentMessageByClientId(
  db: D1Database,
  conversationId: string,
  agentId: string,
  clientMessageId: string,
): Promise<MessageRow | null> {
  return db
    .prepare(
      `SELECT id, conversation_id, sender_type, sender_id, body,
         client_message_id, read_by_visitor_at, read_by_agent_at, created_at
       FROM messages
       WHERE conversation_id = ?1
         AND client_message_id = ?2
         AND sender_type = 'agent'
         AND sender_id = ?3
       LIMIT 1`,
    )
    .bind(conversationId, clientMessageId, agentId)
    .first<MessageRow>();
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

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return toHex(new Uint8Array(digest));
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toHex(bytes);
}

function cookieValue(header: string | undefined, name: string): string | null {
  const prefix = `${name}=`;
  return (
    (header ?? '')
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix))
      ?.slice(prefix.length) ?? null
  );
}

function normalizeMessageId(value?: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed && trimmed.length <= 200 ? trimmed : null;
}

function normalizeCursorDateTime(value?: string | null): string | null {
  const text = value?.trim() ?? '';
  if (!text || text.length > 40 || !Number.isFinite(Date.parse(text))) {
    return null;
  }
  return text;
}

function normalizeMonth(value?: string): string | null {
  const month = value?.trim() ?? '';
  return /^\d{4}-(0[1-9]|1[0-2])$/u.test(month) ? month : null;
}

function retentionCutoffBusinessDate(now = new Date()): string {
  const today = routingBusinessDate(now);
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 89);
  return date.toISOString().slice(0, 10);
}

function clientRealtimeMessage(message: MessageRow) {
  const sentAt = /^\d{4}-\d{2}-\d{2}T/u.test(message.created_at)
    ? message.created_at
    : `${message.created_at.replace(' ', 'T')}Z`;
  return {
    id: message.id,
    direction: message.sender_type === 'agent' ? 'agent' : 'customer',
    body: message.body,
    sentAt,
    delivery:
      message.sender_type === 'agent' && message.read_by_visitor_at
        ? 'read'
        : message.sender_type === 'visitor' && message.read_by_agent_at
          ? 'read'
          : 'sent',
    attachments: [],
  };
}

function authenticatedRealtimeRequest(
  request: Request,
  agentId: string,
): Request {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.set('X-CS-Agent-ID', agentId);
  headers.set('X-CS-Participant-Role', 'agent');
  headers.set('X-CS-Participant-ID', agentId);
  return new Request(url, { ...request, headers });
}

function room(env: Bindings, id: string): DurableObjectStub {
  return env.CONVERSATION_ROOMS.get(env.CONVERSATION_ROOMS.idFromName(id));
}

function agentInboxRoom(agentId: string): string {
  return `agent-inbox:${agentId}`;
}

async function broadcastConversationRoom(
  env: Bindings,
  id: string,
  payload: unknown,
): Promise<void> {
  await room(env, id).fetch('https://conversation-room/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
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

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}
