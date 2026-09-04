import { Hono, type Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { routingBusinessDate } from './routing';
import { loadAgentInbox, loadAgentOverview } from './agent-inbox';
import {
  broadcastClientConversationEvent,
  type ConversationEventSnapshot,
} from './client-api';
import { verifyAgentPassword } from './agent-password';
import { calendarMonthPeriod } from '../shared/calendar-month';
import {
  listConversationAttachments,
  type ConversationAttachmentPage,
} from './message-attachments';
import { createDownloadSigningContext, presignGet } from './media-signing.ts';
import {
  AGENT_SESSION_COOKIE,
  hashAgentSessionToken,
  publicAgentSession,
  requireAgentSession,
  type AgentSessionIdentity,
} from './agent-session';

type Bindings = {
  DB: D1Database;
  CONVERSATION_ROOMS: DurableObjectNamespace;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
};

type Env = { Bindings: Bindings };
type ConversationStatus = 'open' | 'pending' | 'closed';
type AgentAvailability = 'online' | 'busy';

type AgentSession = Pick<
  AgentSessionIdentity,
  'id' | 'name' | 'username' | 'status' | 'is_enabled'
>;

type AgentCredentialRow = AgentSession & {
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  has_active_session: number;
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

type MessageWriteConversation = {
  id: string;
  status: ConversationStatus;
  external_id: string | null;
  visitor_name: string | null;
  agent_name: string | null;
  agent_avatar_version: string | null;
};

type UpdatedConversationSnapshot = Omit<
  ConversationEventSnapshot,
  'external_id' | 'visitor_name' | 'agent_name' | 'agent_avatar_version'
>;

const SESSION_TTL_SECONDS = 60 * 60 * 12;
const MESSAGE_LIMIT = 8000;

export const agentApi = new Hono<Env>();

agentApi.get('/api/agent/auth/session', async (c) => {
  const agent = await requireAgentSession(c);
  return c.json({
    authenticated: Boolean(agent),
    agent: agent ? publicAgentSession(agent) : null,
  });
});

agentApi.patch('/api/agent/profile', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return unauthorized(c);
  const body = await readJson<{ nickname?: string }>(c.req.raw);
  const nickname = body?.nickname?.trim() ?? '';
  if (!nickname || nickname.length > 40) {
    return c.json({ error: 'INVALID_AGENT_NICKNAME' }, 400);
  }

  const updated = await c.env.DB.prepare(
    `UPDATE agents
     SET name = ?1, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?2
     RETURNING id, name, username, status, is_enabled`,
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
    `SELECT a.id, a.name, a.username, a.status, a.is_enabled,
       a.password_hash, a.password_salt, a.password_iterations,
       EXISTS (
         SELECT 1
         FROM agent_sessions session
         WHERE session.agent_id = a.id
           AND datetime(session.expires_at) > CURRENT_TIMESTAMP
       ) AS has_active_session
     FROM agents a
     WHERE lower(a.username) = lower(?1)
       AND a.password_hash IS NOT NULL
       AND a.password_salt IS NOT NULL
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
  const loginStatus = agent.has_active_session ? agent.status : 'online';
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO agent_sessions (id, agent_id, token_hash, expires_at)
       VALUES (?1, ?2, ?3, ?4)`,
    ).bind(sessionId, agent.id, await hashAgentSessionToken(token), expiresAt),
    c.env.DB.prepare(
      `UPDATE agents
       SET status = ?2, last_login_at = ?1, last_seen_at = ?1,
           updated_at = ?1
       WHERE id = ?3`,
    ).bind(now, loginStatus, agent.id),
    c.env.DB.prepare(
      `DELETE FROM agent_sessions
       WHERE datetime(expires_at) <= CURRENT_TIMESTAMP`,
    ),
  ]);

  setCookie(c, AGENT_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return c.json({
    ok: true,
    agent: {
      id: agent.id,
      name: agent.name,
      username: agent.username,
      status: loginStatus,
    },
  });
});

agentApi.post('/api/agent/auth/logout', async (c) => {
  const agent = await requireAgentSession(c);
  if (agent) {
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        'DELETE FROM agent_sessions WHERE id = ?1 AND agent_id = ?2',
      ).bind(agent.session_id, agent.id),
      c.env.DB.prepare(
        `UPDATE agents
         SET status = 'offline', last_seen_at = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?1
           AND NOT EXISTS (
             SELECT 1
             FROM agent_sessions session
             WHERE session.agent_id = ?1
               AND datetime(session.expires_at) > CURRENT_TIMESTAMP
           )`,
      ).bind(agent.id),
    ]);
    const finalSessionLoggedOut = Boolean(results[1]?.meta.changes);
    if (finalSessionLoggedOut) {
      const activeConversationIds = await activeConversationIdsForAgent(
        c.env.DB,
        agent.id,
      );
      try {
        await disconnectAgentRealtime(c.env, agent.id, activeConversationIds);
      } catch (error) {
        console.warn('agent realtime disconnect failed during logout', error);
      }
    }
  }
  deleteCookie(c, AGENT_SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

agentApi.post('/api/agent/auth/revoke-all', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return unauthorized(c);
  const activeConversationIds = await activeConversationIdsForAgent(
    c.env.DB,
    agent.id,
  );
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM agent_sessions WHERE agent_id = ?1').bind(
      agent.id,
    ),
    c.env.DB.prepare(
      `UPDATE agents
       SET status = 'offline', last_seen_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1`,
    ).bind(agent.id),
  ]);
  try {
    await disconnectAgentRealtime(c.env, agent.id, activeConversationIds);
  } catch (error) {
    console.warn(
      'agent realtime disconnect failed during session revoke',
      error,
    );
  }
  deleteCookie(c, AGENT_SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

agentApi.post('/api/agent/auth/heartbeat', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return unauthorized(c);
  await c.env.DB.prepare(
    `UPDATE agents
     SET last_seen_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?1
       AND (
         last_seen_at IS NULL
         OR datetime(last_seen_at) <= datetime('now', '-90 seconds')
       )`,
  )
    .bind(agent.id)
    .run();
  return c.json({
    ok: true,
    ...(await loadAgentInbox(c.env.DB, agent)),
  });
});

agentApi.post('/api/agent/auth/status', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return unauthorized(c);
  const body = await readJson<{ status?: AgentAvailability }>(c.req.raw);
  if (body?.status !== 'online' && body?.status !== 'busy') {
    return c.json({ error: 'INVALID_AGENT_STATUS' }, 400);
  }

  const updatedAt = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE agents
     SET status = ?1, last_seen_at = ?2,
         updated_at = ?2
     WHERE id = ?3`,
  )
    .bind(body.status, updatedAt, agent.id)
    .run();

  await deferAgentRealtime(
    c,
    broadcastConversationRoom(c.env, agentInboxRoom(agent.id), {
      type: 'agent.availability.changed',
      agentId: agent.id,
      availability: body.status,
      updatedAt,
    }),
  );

  return c.json({
    ok: true,
    ...(await loadAgentInbox(c.env.DB, { ...agent, status: body.status })),
  });
});

agentApi.get('/api/agent/overview', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return unauthorized(c);
  return c.json(await loadAgentOverview(c.env.DB, agent.id));
});

agentApi.get('/api/agent/stats', async (c) => {
  const agent = await requireAgentSession(c);
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
  const agent = await requireAgentSession(c);
  if (!agent) return unauthorized(c);
  return c.json(await loadAgentInbox(c.env.DB, agent, c.req.query('status')));
});

agentApi.get('/api/agent/conversations/:id/messages', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return unauthorized(c);

  const afterIdValue = c.req.query('afterId');
  const afterCreatedAtValue = c.req.query('afterCreatedAt');
  const beforeIdValue = c.req.query('beforeId');
  const beforeCreatedAtValue = c.req.query('beforeCreatedAt');
  const hasAfterCursor =
    afterIdValue !== undefined || afterCreatedAtValue !== undefined;
  const hasBeforeCursor =
    beforeIdValue !== undefined || beforeCreatedAtValue !== undefined;
  const afterId = normalizeMessageId(afterIdValue);
  const afterCreatedAt = normalizeCursorDateTime(afterCreatedAtValue);
  const beforeId = normalizeMessageId(beforeIdValue);
  const beforeCreatedAt = normalizeCursorDateTime(beforeCreatedAtValue);

  if (
    (hasAfterCursor && (!afterId || !afterCreatedAt)) ||
    (hasBeforeCursor && (!beforeId || !beforeCreatedAt)) ||
    (hasAfterCursor && hasBeforeCursor)
  ) {
    return c.json({ error: 'INVALID_MESSAGE_CURSOR' }, 400);
  }

  const after =
    afterId && afterCreatedAt
      ? { id: afterId, createdAt: afterCreatedAt }
      : null;
  const before =
    beforeId && beforeCreatedAt
      ? { id: beforeId, createdAt: beforeCreatedAt }
      : null;
  const conversation = await assignedConversation(
    c.env.DB,
    c.req.param('id'),
    agent.id,
  );
  if (!conversation) return c.json({ error: 'NOT_FOUND' }, 404);

  const readStateRequest = after
    ? c.env.DB.prepare(
        `SELECT m.id,
         COALESCE(
           m.read_by_visitor_at,
           CASE
             WHEN m.sender_type = 'agent'
               AND c.visitor_read_through_at IS NOT NULL
               AND (
                 m.created_at < c.visitor_read_through_at
                 OR (
                   m.created_at = c.visitor_read_through_at
                   AND m.id <= c.visitor_read_through_id
                 )
               )
               THEN c.visitor_read_at
           END
         ) AS read_by_visitor_at,
         COALESCE(
           m.read_by_agent_at,
           CASE
             WHEN m.sender_type = 'visitor'
               AND c.agent_read_through_at IS NOT NULL
               AND (
                 m.created_at < c.agent_read_through_at
                 OR (
                   m.created_at = c.agent_read_through_at
                   AND m.id <= c.agent_read_through_id
                 )
               )
               THEN c.agent_read_at
           END
         ) AS read_by_agent_at
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE m.conversation_id = ?1
           AND (
             m.read_by_visitor_at IS NOT NULL
             OR m.read_by_agent_at IS NOT NULL
             OR (
               m.sender_type = 'agent'
               AND c.visitor_read_through_at IS NOT NULL
               AND (
                 m.created_at < c.visitor_read_through_at
                 OR (
                   m.created_at = c.visitor_read_through_at
                   AND m.id <= c.visitor_read_through_id
                 )
               )
             )
             OR (
               m.sender_type = 'visitor'
               AND c.agent_read_through_at IS NOT NULL
               AND (
                 m.created_at < c.agent_read_through_at
                 OR (
                   m.created_at = c.agent_read_through_at
                   AND m.id <= c.agent_read_through_id
                 )
               )
             )
           )
         ORDER BY m.created_at ASC, m.id ASC
         LIMIT 500`,
      )
        .bind(c.req.param('id'))
        .all<MessageReadState>()
    : Promise.resolve({ results: [] as MessageReadState[] });

  const pageDirection = after ? 'after' : before ? 'before' : 'latest';
  const pageCursor = after ?? before;
  const pageSize = after ? 500 : 100;
  const queryLimit = after ? pageSize : pageSize + 1;
  const cursorOperator = after ? '>' : '<';
  const sortOrder = after ? 'ASC' : 'DESC';
  const cursorClause = pageCursor
    ? `AND (
         m.created_at ${cursorOperator} ?2
         OR (m.created_at = ?2 AND m.id ${cursorOperator} ?3)
       )`
    : '';
  const limitParameter = pageCursor ? '?4' : '?2';
  const messageRequest = c.env.DB.prepare(
    `SELECT m.id, m.conversation_id, m.sender_type, m.sender_id, m.body,
       m.client_message_id,
       COALESCE(
         m.read_by_visitor_at,
         CASE
           WHEN m.sender_type = 'agent'
             AND c.visitor_read_through_at IS NOT NULL
             AND (
               m.created_at < c.visitor_read_through_at
               OR (
                 m.created_at = c.visitor_read_through_at
                 AND m.id <= c.visitor_read_through_id
               )
             )
             THEN c.visitor_read_at
         END
       ) AS read_by_visitor_at,
       COALESCE(
         m.read_by_agent_at,
         CASE
           WHEN m.sender_type = 'visitor'
             AND c.agent_read_through_at IS NOT NULL
             AND (
               m.created_at < c.agent_read_through_at
               OR (
                 m.created_at = c.agent_read_through_at
                 AND m.id <= c.agent_read_through_id
               )
             )
             THEN c.agent_read_at
         END
       ) AS read_by_agent_at,
       m.created_at
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE m.conversation_id = ?1
       ${cursorClause}
     ORDER BY m.created_at ${sortOrder}, m.id ${sortOrder}
     LIMIT ${limitParameter}`,
  );
  const messageBindings = pageCursor
    ? [c.req.param('id'), pageCursor.createdAt, pageCursor.id, queryLimit]
    : [c.req.param('id'), queryLimit];
  const attachmentPage: ConversationAttachmentPage =
    pageDirection === 'latest'
      ? { direction: pageDirection, limit: pageSize }
      : {
          direction: pageDirection,
          cursor: pageCursor!,
          limit: pageSize,
        };
  const signer = await createDownloadSigningContext(
    c.env,
    conversation.expires_at as string | null,
  );

  const [messages, media, readState] = await Promise.all([
    messageRequest.bind(...messageBindings).all<MessageRow>(),
    listConversationAttachments(
      c.env.DB,
      c.req.param('id'),
      attachmentPage,
      signer ? (objectKey) => presignGet(signer, objectKey) : undefined,
    ),
    readStateRequest,
  ]);
  const rawMessages = messages.results ?? [];
  const hasMoreBefore = !after && rawMessages.length > pageSize;
  const pageMessages = after
    ? rawMessages
    : rawMessages.slice(0, pageSize).reverse();
  const oldestMessage = pageMessages[0] ?? null;

  return c.json({
    conversation,
    messages: pageMessages,
    media,
    readState: readState.results ?? [],
    page: {
      hasMoreBefore,
      before:
        hasMoreBefore && oldestMessage
          ? {
              id: oldestMessage.id,
              createdAt: oldestMessage.created_at,
            }
          : null,
    },
  });
});

agentApi.post('/api/agent/conversations/:id/read', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return unauthorized(c);
  const id = c.req.param('id');
  const body = await readJson<{ lastMessageId?: string | null }>(c.req.raw);
  const requestedLastMessageId = normalizeMessageId(body?.lastMessageId);
  const [conversation, boundary] = await Promise.all([
    c.env.DB.prepare(
      `SELECT c.id, c.site_id, c.visitor_id, c.status, c.assigned_agent,
         a.name AS agent_name, a.avatar_version AS agent_avatar_version, c.subject,
         c.product_id, c.section_id, c.section_name, c.category_id,
         c.category_name, c.product_title, c.product_cover_url, c.product_href,
         c.expires_at, c.visitor_unread_count, c.agent_unread_count,
         c.last_message_at, c.created_at, c.last_message_preview AS last_message,
         v.external_id, v.display_name AS visitor_name
       FROM conversations c
       JOIN visitors v ON v.id = c.visitor_id
       LEFT JOIN agents a ON a.id = c.assigned_agent AND a.site_id = c.site_id
       WHERE c.id = ?1 AND c.assigned_agent = ?2
         AND c.expires_at > CURRENT_TIMESTAMP
       LIMIT 1`,
    )
      .bind(id, agent.id)
      .first<ConversationEventSnapshot>(),
    c.env.DB.prepare(
      `SELECT id, created_at
       FROM messages
       WHERE conversation_id = ?1 AND sender_type = 'visitor'
       ORDER BY CASE WHEN id = ?2 THEN 0 ELSE 1 END,
         created_at DESC, id DESC
       LIMIT 1`,
    )
      .bind(id, requestedLastMessageId)
      .first<ReadBoundary>(),
  ]);

  if (!conversation) {
    return c.json({ error: 'NOT_FOUND' }, 404);
  }

  const readResult = boundary
    ? await c.env.DB.prepare(
        `UPDATE conversations
         SET agent_read_through_at = ?2,
             agent_read_through_id = ?3,
             agent_read_at = CURRENT_TIMESTAMP,
             agent_unread_count = (
               SELECT COUNT(*)
               FROM messages
               WHERE conversation_id = ?1
                 AND sender_type = 'visitor'
                 AND read_by_agent_at IS NULL
                 AND (
                   created_at > ?2
                   OR (created_at = ?2 AND id > ?3)
                 )
             ),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?1
           AND (
             agent_read_through_at IS NULL
             OR agent_read_through_at < ?2
             OR (
               agent_read_through_at = ?2
               AND agent_read_through_id < ?3
             )
           )
         RETURNING agent_unread_count`,
      )
        .bind(id, boundary.created_at, boundary.id)
        .first<{ agent_unread_count: number }>()
    : null;

  if (readResult) {
    const conversationSnapshot: ConversationEventSnapshot = {
      ...conversation,
      agent_unread_count: Number(readResult.agent_unread_count || 0),
    };
    await deferAgentRealtime(
      c,
      Promise.allSettled([
        broadcastConversationRoom(c.env, id, {
          type: 'message.read',
          reader: 'agent',
          lastMessageId: boundary?.id ?? null,
        }),
        broadcastClientConversationEvent(
          c.env,
          id,
          'message.read',
          {
            reader: 'agent',
            lastMessageId: boundary?.id ?? null,
          },
          { conversationSnapshot },
        ),
      ]).then((results) => {
        for (const result of results) {
          if (result.status === 'rejected') {
            console.warn('agent read realtime delivery failed', result.reason);
          }
        }
      }),
    );
  }
  return c.json({ ok: true });
});

agentApi.post('/api/agent/conversations/:id/messages', async (c) => {
  const agent = await requireAgentSession(c);
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

  const updatedConversation = await c.env.DB.prepare(
    `UPDATE conversations
     SET status = CASE WHEN status = 'open' THEN 'pending' ELSE status END,
         visitor_unread_count = visitor_unread_count + 1,
         agent_unread_count = 0,
         last_message_at = ?1,
         last_message_preview = ?2,
         updated_at = ?1
     WHERE id = ?3 AND assigned_agent = ?4
       AND expires_at > CURRENT_TIMESTAMP
     RETURNING id, site_id, visitor_id, status, assigned_agent, subject,
       product_id, section_id, section_name, category_id, category_name,
       product_title, product_cover_url, product_href, expires_at,
       visitor_unread_count, agent_unread_count, last_message_at, created_at,
       last_message_preview AS last_message`,
  )
    .bind(now, text, id, agent.id)
    .first<UpdatedConversationSnapshot>();
  const conversationSnapshot: ConversationEventSnapshot | undefined =
    updatedConversation
      ? {
          ...updatedConversation,
          external_id: conversation.external_id,
          visitor_name: conversation.visitor_name,
          agent_name: conversation.agent_name,
          agent_avatar_version: conversation.agent_avatar_version,
        }
      : undefined;
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
  await deferAgentRealtime(
    c,
    Promise.allSettled([
      broadcastConversationRoom(c.env, id, { type: 'message', message }),
      broadcastClientConversationEvent(
        c.env,
        id,
        'message.created',
        { message: clientRealtimeMessage(message) },
        {
          includeOverview: conversation.status === 'open',
          conversationSnapshot,
        },
      ),
    ]),
  );
  return c.json({ message }, 201);
});

agentApi.post('/api/agent/conversations/:id/status', async (c) => {
  const agent = await requireAgentSession(c);
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
  await Promise.allSettled([
    broadcastConversationRoom(c.env, id, {
      type: 'conversation.status',
      status: body.status,
    }),
    broadcastClientConversationEvent(
      c.env,
      id,
      body.status === 'closed'
        ? 'conversation.closed'
        : 'conversation.assigned',
    ),
  ]);
  return c.json({ ok: true });
});

agentApi.get('/api/agent/realtime/inbox', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return unauthorized(c);
  return room(c.env, agentInboxRoom(agent.id)).fetch(
    authenticatedRealtimeRequest(c.req.raw, agent.id),
  );
});

agentApi.get('/api/agent/realtime/:id', async (c) => {
  const agent = await requireAgentSession(c);
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

async function assignedConversationForMessageWrite(
  db: D1Database,
  id: string,
  agentId: string,
) {
  return db
    .prepare(
      `SELECT c.id, c.status,
         v.external_id,
         v.display_name AS visitor_name,
         a.name AS agent_name,
         a.avatar_version AS agent_avatar_version
       FROM conversations c
       JOIN visitors v ON v.id = c.visitor_id
       LEFT JOIN agents a ON a.id = c.assigned_agent AND a.site_id = c.site_id
       WHERE c.id = ?1 AND c.assigned_agent = ?2
         AND c.expires_at > CURRENT_TIMESTAMP
       LIMIT 1`,
    )
    .bind(id, agentId)
    .first<MessageWriteConversation>();
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

async function activeConversationIdsForAgent(
  db: D1Database,
  agentId: string,
): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT id
       FROM conversations
       WHERE assigned_agent = ?1
         AND status IN ('open', 'pending')
         AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP`,
    )
    .bind(agentId)
    .all<{ id: string }>();
  return (result.results ?? []).map((conversation) => conversation.id);
}

async function disconnectAgentRealtime(
  env: Bindings,
  agentId: string,
  conversationIds: string[],
): Promise<void> {
  const roomIds = [`agent-inbox:${agentId}`, ...conversationIds];
  await Promise.all(
    roomIds.map((roomId) =>
      room(env, roomId).fetch('https://conversation-room/disconnect-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      }),
    ),
  );
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

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toHex(bytes);
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

async function deferAgentRealtime(
  c: Context<Env>,
  task: Promise<unknown>,
): Promise<void> {
  try {
    c.executionCtx.waitUntil(task);
  } catch {
    await task;
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

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}
