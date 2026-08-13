import { Hono, type Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { assignConversationAgent } from './routing';
import { broadcastClientConversationEvent } from './client-api';

type Bindings = {
  DB: D1Database;
  CONVERSATION_ROOMS: DurableObjectNamespace;
};

type Env = { Bindings: Bindings };
type ConversationStatus = 'open' | 'pending' | 'closed';

type AgentSession = {
  id: string;
  name: string;
  username: string;
  status: 'online' | 'busy' | 'offline';
};

type AgentCredentialRow = AgentSession & {
  password_hash: string;
  password_salt: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_type: 'visitor' | 'agent' | 'system';
  sender_id: string | null;
  body: string;
  created_at: string;
};

const COOKIE = 'cs_agent_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const PASSWORD_ITERATIONS = 120_000;
const MESSAGE_LIMIT = 8000;

export const agentApi = new Hono<Env>();

agentApi.get('/api/agent/auth/session', async (c) => {
  const agent = await authenticateAgent(c);
  return c.json({ authenticated: Boolean(agent), agent: agent ?? null });
});

agentApi.post('/api/agent/auth/login', async (c) => {
  const body = await readJson<{ username?: string; password?: string }>(c.req.raw);
  const username = body?.username?.trim() ?? '';
  const password = body?.password ?? '';
  if (!username || !password) return c.json({ error: 'INVALID_CREDENTIALS' }, 401);

  const agent = await c.env.DB.prepare(
    `SELECT id, name, username, status, password_hash, password_salt
     FROM agents
     WHERE lower(username) = lower(?1)
       AND is_enabled = 1
       AND password_hash IS NOT NULL
       AND password_salt IS NOT NULL
     LIMIT 1`,
  )
    .bind(username)
    .first<AgentCredentialRow>();
  if (!agent || !(await verifyPassword(password, agent.password_hash, agent.password_salt))) {
    return c.json({ error: 'INVALID_CREDENTIALS' }, 401);
  }

  const token = randomToken();
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
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
  await assignWaitingConversations(c.env, agent.id);
  return c.json({
    ok: true,
    agent: { id: agent.id, name: agent.name, username: agent.username, status: 'online' },
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
  await c.env.DB.prepare(
    `UPDATE agents
     SET status = 'online', last_seen_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?1`,
  )
    .bind(agent.id)
    .run();
  await assignWaitingConversations(c.env, agent.id);
  return c.json({ ok: true });
});

agentApi.get('/api/agent/overview', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);
  const result = await c.env.DB.prepare(
    `SELECT status, COUNT(*) AS count
     FROM conversations
     WHERE assigned_agent = ?1
     GROUP BY status`,
  )
    .bind(agent.id)
    .all<{ status: ConversationStatus; count: number }>();
  const counts = { open: 0, pending: 0, closed: 0 };
  for (const row of result.results ?? []) counts[row.status] = Number(row.count ?? 0);
  return c.json({ ...counts, total: counts.open + counts.pending + counts.closed });
});

agentApi.get('/api/agent/conversations', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);
  const status = c.req.query('status');
  const filtered = status === 'open' || status === 'pending' || status === 'closed';
  let statement = c.env.DB.prepare(
    `SELECT c.id, c.site_id, c.visitor_id, c.status, c.subject, c.group_id,
       c.product_id, c.product_title, c.product_cover_url, c.product_href,
       c.assigned_agent, c.last_message_at, c.created_at,
       v.display_name AS visitor_name,
       (SELECT body FROM messages m WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message
     FROM conversations c
     JOIN visitors v ON v.id = c.visitor_id
     WHERE c.assigned_agent = ?1
       ${filtered ? 'AND c.status = ?2' : ''}
     ORDER BY CASE WHEN c.status = 'closed' THEN 1 ELSE 0 END,
       c.last_message_at DESC, c.id DESC
     LIMIT 100`,
  );
  statement = filtered ? statement.bind(agent.id, status) : statement.bind(agent.id);
  const result = await statement.all();
  return c.json({ conversations: result.results ?? [] });
});

agentApi.get('/api/agent/conversations/:id/messages', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);
  const conversation = await assignedConversation(c.env.DB, c.req.param('id'), agent.id);
  if (!conversation) return c.json({ error: 'NOT_FOUND' }, 404);
  const messages = await c.env.DB.prepare(
    `SELECT id, conversation_id, sender_type, sender_id, body, created_at
     FROM messages
     WHERE conversation_id = ?1
     ORDER BY created_at ASC, id ASC
     LIMIT 500`,
  )
    .bind(c.req.param('id'))
    .all<MessageRow>();
  return c.json({ conversation, messages: messages.results ?? [] });
});

agentApi.post('/api/agent/conversations/:id/messages', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);
  const id = c.req.param('id');
  const conversation = await assignedConversation(c.env.DB, id, agent.id);
  if (!conversation) return c.json({ error: 'NOT_FOUND' }, 404);
  if (conversation.status === 'closed') return c.json({ error: 'CONVERSATION_CLOSED' }, 409);

  const body = await readJson<{ body?: string }>(c.req.raw);
  const text = body?.body?.trim() ?? '';
  if (!text || text.length > MESSAGE_LIMIT) return c.json({ error: 'INVALID_MESSAGE' }, 400);

  const messageId = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO messages (id, conversation_id, sender_type, sender_id, body)
       VALUES (?1, ?2, 'agent', ?3, ?4)`,
    ).bind(messageId, id, agent.id, text),
    c.env.DB.prepare(
      `UPDATE conversations
       SET status = CASE WHEN status = 'open' THEN 'pending' ELSE status END,
           visitor_unread_count = visitor_unread_count + 1,
           last_message_at = ?1,
           updated_at = ?1
       WHERE id = ?2 AND assigned_agent = ?3`,
    ).bind(now, id, agent.id),
  ]);
  const message = await c.env.DB.prepare(
    `SELECT id, conversation_id, sender_type, sender_id, body, created_at
     FROM messages WHERE id = ?1`,
  )
    .bind(messageId)
    .first<MessageRow>();
  await broadcastConversationRoom(c.env, id, { type: 'message', message });
  await broadcastClientConversationEvent(c.env, id, 'message.created');
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
     WHERE id = ?2 AND assigned_agent = ?3`,
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
  return c.json({ ok: true });
});

agentApi.get('/api/agent/realtime/inbox', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);
  return room(c.env, 'admin-inbox').fetch(c.req.raw);
});

agentApi.get('/api/agent/realtime/:id', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);
  const conversation = await assignedConversation(c.env.DB, c.req.param('id'), agent.id);
  if (!conversation) return c.json({ error: 'NOT_FOUND' }, 404);
  return room(c.env, c.req.param('id')).fetch(c.req.raw);
});

async function authenticateAgent(c: Context<Env>): Promise<AgentSession | null> {
  const token = cookieValue(c.req.header('Cookie'), COOKIE);
  if (!token) return null;
  return authenticateAgentToken(c.env.DB, token);
}

async function authenticateAgentToken(db: D1Database, token: string): Promise<AgentSession | null> {
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

async function assignedConversation(db: D1Database, id: string, agentId: string) {
  return db
    .prepare(
      `SELECT c.*, v.display_name AS visitor_name
       FROM conversations c
       JOIN visitors v ON v.id = c.visitor_id
       WHERE c.id = ?1 AND c.assigned_agent = ?2
       LIMIT 1`,
    )
    .bind(id, agentId)
    .first<Record<string, unknown> & { status: ConversationStatus }>();
}

async function assignWaitingConversations(env: Bindings, agentId: string): Promise<void> {
  const waiting = await env.DB.prepare(
    `SELECT DISTINCT c.id
     FROM conversations c
     JOIN group_agents ga
       ON ga.site_id = c.site_id AND ga.group_id = c.group_id
     JOIN support_groups sg
       ON sg.site_id = c.site_id AND sg.id = c.group_id
     WHERE c.assigned_agent IS NULL
       AND c.status IN ('open', 'pending')
       AND ga.agent_id = ?1
       AND ga.is_enabled = 1
       AND sg.is_enabled = 1
     ORDER BY c.last_message_at ASC
     LIMIT 20`,
  )
    .bind(agentId)
    .all<{ id: string }>();

  for (const conversation of waiting.results ?? []) {
    const assignment = await assignConversationAgent(env.DB, conversation.id);
    if (!assignment) continue;
    await broadcastClientConversationEvent(env, conversation.id, 'conversation.assigned');
    await broadcastConversationRoom(env, 'admin-inbox', {
      type: 'conversation.changed',
      conversationId: conversation.id,
    });
  }
}

async function verifyPassword(password: string, expectedHash: string, saltHex: string): Promise<boolean> {
  const salt = fromHex(saltHex);
  const actual = await derivePassword(password, salt);
  return timingSafeEqual(actual, expectedHash);
}

async function derivePassword(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_ITERATIONS },
    key,
    256,
  );
  return toHex(new Uint8Array(bits));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
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

function room(env: Bindings, id: string): DurableObjectStub {
  return env.CONVERSATION_ROOMS.get(env.CONVERSATION_ROOMS.idFromName(id));
}

async function broadcastConversationRoom(env: Bindings, id: string, payload: unknown): Promise<void> {
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

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function fromHex(value: string): Uint8Array {
  if (!/^[0-9a-f]+$/iu.test(value) || value.length % 2 !== 0) return new Uint8Array();
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
