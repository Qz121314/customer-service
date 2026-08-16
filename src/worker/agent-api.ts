import { Hono, type Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { assignConversationAgent, routingBusinessDate } from './routing';
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

type TransferTargetRow = {
  id: string;
  name: string;
  status: 'online' | 'busy' | 'offline';
  active_count: number;
  max_active_conversations: number;
};

type QuickReplyRow = {
  id: string;
  title: string;
  body: string;
};

const COOKIE = 'cs_agent_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const MESSAGE_LIMIT = 8000;

export const agentApi = new Hono<Env>();

agentApi.get('/api/agent/auth/session', async (c) => {
  const agent = await authenticateAgent(c);
  return c.json({ authenticated: Boolean(agent), agent: agent ?? null });
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

async function loadAgentOverview(db: D1Database, agentId: string) {
  const businessDate = routingBusinessDate();
  const [statusResult, quotaRow] = await Promise.all([
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
    db
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
      }>(),
  ]);
  const counts = { open: 0, pending: 0, closed: 0 };
  for (const row of statusResult.results ?? [])
    counts[row.status] = Number(row.count ?? 0);
  return {
    ...counts,
    total: counts.open + counts.pending + counts.closed,
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

async function loadQuickReplies(db: D1Database, agentId: string) {
  const result = await db
    .prepare(
      `SELECT id, title, body
       FROM agent_quick_replies
       WHERE agent_id = ?1
       ORDER BY updated_at DESC, id ASC
       LIMIT 30`,
    )
    .bind(agentId)
    .all<QuickReplyRow>();
  return result.results ?? [];
}

async function loadAgentInbox(
  db: D1Database,
  agent: AgentSession,
  requestedStatus?: string,
) {
  const filtered =
    requestedStatus === 'open' ||
    requestedStatus === 'pending' ||
    requestedStatus === 'closed';
  let statement = db.prepare(
    `SELECT c.id, c.site_id, c.visitor_id, c.status, c.subject, c.group_id,
       c.product_id, c.section_id, c.section_name, c.category_id,
       c.category_name, c.product_title, c.product_cover_url, c.product_href,
       c.assigned_agent, c.agent_unread_count, c.last_message_at, c.created_at,
       c.expires_at,
       v.display_name AS visitor_name,
       (SELECT body FROM messages m WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message
     FROM conversations c
     JOIN visitors v ON v.id = c.visitor_id
     WHERE c.assigned_agent = ?1
       AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP
       ${filtered ? 'AND c.status = ?2' : ''}
     ORDER BY CASE WHEN c.status = 'closed' THEN 1 ELSE 0 END,
       c.last_message_at DESC, c.id DESC
     LIMIT 100`,
  );
  statement = filtered
    ? statement.bind(agent.id, requestedStatus)
    : statement.bind(agent.id);
  const [result, overview, transferTargets, quickReplies] = await Promise.all([
    statement.all(),
    loadAgentOverview(db, agent.id),
    loadTransferTargets(db, agent.id),
    loadQuickReplies(db, agent.id),
  ]);
  return {
    conversations: result.results ?? [],
    overview,
    transferTargets,
    quickReplies,
    availability: agent.status === 'busy' ? 'busy' : 'online',
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

agentApi.post('/api/agent/quick-replies', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);
  const body = await readJson<{ title?: string; body?: string }>(c.req.raw);
  const title = normalizeText(body?.title, 40);
  const replyBody = normalizeText(body?.body, 1000);
  if (!title || !replyBody)
    return c.json({ error: 'INVALID_QUICK_REPLY' }, 400);
  const count = await c.env.DB.prepare(
    'SELECT COUNT(*) AS count FROM agent_quick_replies WHERE agent_id = ?1',
  )
    .bind(agent.id)
    .first<{ count: number }>();
  if (Number(count?.count ?? 0) >= 30)
    return c.json({ error: 'QUICK_REPLY_LIMIT_REACHED' }, 409);

  const reply = { id: crypto.randomUUID(), title, body: replyBody };
  await c.env.DB.prepare(
    `INSERT INTO agent_quick_replies (id, agent_id, title, body)
     VALUES (?1, ?2, ?3, ?4)`,
  )
    .bind(reply.id, agent.id, reply.title, reply.body)
    .run();
  return c.json({ reply }, 201);
});

agentApi.delete('/api/agent/quick-replies/:id', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);
  const result = await c.env.DB.prepare(
    'DELETE FROM agent_quick_replies WHERE id = ?1 AND agent_id = ?2',
  )
    .bind(c.req.param('id'), agent.id)
    .run();
  if (!result.meta.changes) return c.json({ error: 'NOT_FOUND' }, 404);
  return c.json({ ok: true });
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
         ORDER BY julianday(created_at) ASC, id ASC
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
         OR julianday(created_at) > julianday(?2)
         OR (julianday(created_at) = julianday(?2) AND id > ?3)
       )
     ORDER BY julianday(created_at) ASC, id ASC
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
  const conversation = await assignedConversation(c.env.DB, id, agent.id);
  if (!conversation) return c.json({ error: 'NOT_FOUND' }, 404);

  const body = await readJson<{ lastMessageId?: string | null }>(c.req.raw);
  const requestedLastMessageId = normalizeMessageId(body?.lastMessageId);
  let boundary: ReadBoundary | null = null;
  if (requestedLastMessageId) {
    boundary = await c.env.DB.prepare(
      `SELECT id, created_at
       FROM messages
       WHERE id = ?1 AND conversation_id = ?2 AND sender_type = 'visitor'
       LIMIT 1`,
    )
      .bind(requestedLastMessageId, id)
      .first<ReadBoundary>();
  }

  const [readResult] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE messages
       SET read_by_agent_at = COALESCE(read_by_agent_at, CURRENT_TIMESTAMP)
       WHERE conversation_id = ?1
         AND sender_type = 'visitor'
         AND (
           ?2 IS NULL
           OR created_at < ?3
           OR (created_at = ?3 AND id <= ?2)
         )`,
    ).bind(id, boundary?.id ?? null, boundary?.created_at ?? null),
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
       WHERE id = ?1 AND assigned_agent = ?2`,
    ).bind(id, agent.id),
  ]);

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
  const conversation = await assignedConversation(c.env.DB, id, agent.id);
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
       (id, conversation_id, sender_type, sender_id, body, client_message_id)
     VALUES (?1, ?2, 'agent', ?3, ?4, ?5)`,
  )
    .bind(messageId, id, agent.id, text, clientMessageId)
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
         updated_at = ?1
     WHERE id = ?2 AND assigned_agent = ?3
       AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP`,
  )
    .bind(now, id, agent.id)
    .run();
  const message = await c.env.DB.prepare(
    `SELECT id, conversation_id, sender_type, sender_id, body,
       client_message_id, read_by_visitor_at, read_by_agent_at, created_at
     FROM messages WHERE id = ?1`,
  )
    .bind(messageId)
    .first<MessageRow>();
  await broadcastConversationRoom(c.env, id, { type: 'message', message });
  await broadcastClientConversationEvent(c.env, id, 'message.created', {
    message: message ? clientRealtimeMessage(message) : undefined,
  });
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
       AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP`,
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

agentApi.post('/api/agent/conversations/:id/transfer', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);
  const id = c.req.param('id');
  const conversation = await assignedConversation(c.env.DB, id, agent.id);
  if (!conversation) return c.json({ error: 'NOT_FOUND' }, 404);
  if (conversation.status === 'closed')
    return c.json({ error: 'CONVERSATION_CLOSED' }, 409);
  const body = await readJson<{ targetAgentId?: string | null }>(c.req.raw);
  const targetAgentId = normalizeOptionalId(body?.targetAgentId);
  if (body?.targetAgentId && !targetAgentId)
    return c.json({ error: 'INVALID_TRANSFER_TARGET' }, 400);
  if (targetAgentId === agent.id)
    return c.json({ error: 'INVALID_TRANSFER_TARGET' }, 400);

  let assignment: { id: string; name: string } | null = null;
  if (targetAgentId) {
    const now = new Date().toISOString();
    const businessDate = routingBusinessDate(new Date(now));
    const transfer = await c.env.DB.prepare(
      `UPDATE conversations
       SET assigned_agent = ?1,
           assigned_at = ?2,
           assigned_business_date = ?3,
           status = 'pending',
           updated_at = ?2
       WHERE id = ?4
         AND assigned_agent = ?5
         AND status IN ('open', 'pending')
         AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP
         AND EXISTS (
           SELECT 1
           FROM agents target
           LEFT JOIN agent_daily_stats daily
             ON daily.site_id = target.site_id
            AND daily.agent_id = target.id
            AND daily.business_date = ?3
           WHERE target.id = ?1
             AND target.site_id = ?6
             AND target.is_enabled = 1
             AND target.status = 'online'
             AND target.username IS NOT NULL
             AND target.password_hash IS NOT NULL
             AND target.last_seen_at IS NOT NULL
             AND datetime(target.last_seen_at) >= datetime('now', '-2 minutes')
             AND (
               target.max_active_conversations = 0
               OR (
                 SELECT COUNT(*)
                 FROM conversations load
                 WHERE load.assigned_agent = target.id
                   AND load.status IN ('open', 'pending')
                   AND COALESCE(load.expires_at, datetime(load.created_at, '+1 day')) > CURRENT_TIMESTAMP
               ) < target.max_active_conversations
             )
             AND (
               target.daily_conversation_limit = 0
               OR COALESCE(daily.conversation_count, 0) < target.daily_conversation_limit
             )
             AND (
               target.traffic_quota_enabled = 0
               OR target.traffic_quota_used < target.traffic_quota_total
             )
         )`,
    )
      .bind(
        targetAgentId,
        now,
        businessDate,
        id,
        agent.id,
        String(conversation.site_id),
      )
      .run();
    if (!transfer.meta.changes)
      return c.json({ error: 'TRANSFER_TARGET_UNAVAILABLE' }, 409);

    await c.env.DB.prepare(
      `UPDATE agents
       SET last_assigned_at = ?1, updated_at = ?1
       WHERE id = ?2 AND site_id = ?3`,
    )
      .bind(now, targetAgentId, String(conversation.site_id))
      .run();
    assignment = await c.env.DB.prepare(
      'SELECT id, name FROM agents WHERE id = ?1 LIMIT 1',
    )
      .bind(targetAgentId)
      .first<{ id: string; name: string }>();
  } else {
    const released = await c.env.DB.prepare(
      `UPDATE conversations
       SET assigned_agent = NULL,
           assigned_at = NULL,
           assigned_business_date = NULL,
           status = 'open',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1
         AND assigned_agent = ?2
         AND status IN ('open', 'pending')
         AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP`,
    )
      .bind(id, agent.id)
      .run();
    if (!released.meta.changes) return c.json({ error: 'NOT_FOUND' }, 404);
    assignment = await assignConversationAgent(c.env.DB, id, agent.id);
  }

  const realtimeUpdates: Promise<void>[] = [
    broadcastConversationRoom(c.env, id, {
      type: 'conversation.transferred',
      assignment,
    }),
    broadcastAgentInboxRefresh(c.env, agent.id, id),
    broadcastClientConversationEvent(c.env, id, 'conversation.assigned'),
  ];
  if (assignment) {
    realtimeUpdates.push(broadcastAgentInboxRefresh(c.env, assignment.id, id));
  }
  await Promise.all(realtimeUpdates);
  if (assignment) {
    c.executionCtx.waitUntil(
      sendAgentPushForConversation(c.env, id).catch((error) => {
        console.warn('Agent push dispatch failed.', error);
      }),
    );
  }
  return c.json({ ok: true, assignment });
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
         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP
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

function normalizeOptionalId(value?: string | null): string | null {
  if (value === null || value === undefined || value === '') return null;
  const id = value.trim();
  return id && id.length <= 200 ? id : null;
}

function normalizeCursorDateTime(value?: string | null): string | null {
  const text = value?.trim() ?? '';
  if (!text || text.length > 40 || !Number.isFinite(Date.parse(text))) {
    return null;
  }
  return text;
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= maxLength ? text : null;
}

function normalizeMonth(value?: string): string | null {
  const month = value?.trim() ?? '';
  return /^\d{4}-(0[1-9]|1[0-2])$/u.test(month) ? month : null;
}

function retentionCutoffBusinessDate(now = new Date()): string {
  const today = routingBusinessDate(now);
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 399);
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

async function broadcastAgentInboxRefresh(
  env: Bindings,
  agentId: string,
  conversationId: string,
): Promise<void> {
  await room(env, agentInboxRoom(agentId)).fetch(
    'https://conversation-room/broadcast',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'conversation.refresh', conversationId }),
    },
  );
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
