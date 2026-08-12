import { DurableObject } from 'cloudflare:workers';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { deleteCookie, setCookie } from 'hono/cookie';

interface Bindings {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  CONVERSATION_ROOMS: DurableObjectNamespace;
  ADMIN_PASSWORD?: string;
  ENVIRONMENT: string;
  APP_VERSION: string;
}

type AppEnv = { Bindings: Bindings };
type Status = 'open' | 'pending' | 'closed';
type SenderType = 'visitor' | 'agent' | 'system';

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_type: SenderType;
  sender_id: string | null;
  body: string;
  created_at: string;
};

const app = new Hono<AppEnv>();
const SESSION_COOKIE = 'cs_session';
const SESSION_TTL = 60 * 60 * 24 * 7;

app.use(
  '/api/public/*',
  cors({
    origin: '*',
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    maxAge: 86400,
  }),
);

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    service: 'customer-service',
    version: c.env.APP_VERSION,
    environment: c.env.ENVIRONMENT,
    time: new Date().toISOString(),
  }),
);

app.get('/api/auth/session', async (c) => {
  if (!c.env.ADMIN_PASSWORD) return c.json({ authenticated: false, configured: false });
  const authenticated = await verifyAdminSession(c.req.raw, c.env.ADMIN_PASSWORD);
  return c.json({ authenticated, configured: true });
});

app.post('/api/auth/login', async (c) => {
  if (!c.env.ADMIN_PASSWORD) {
    return c.json(
      {
        error: 'ADMIN_NOT_CONFIGURED',
        message: 'Set the ADMIN_PASSWORD repository secret and redeploy.',
      },
      503,
    );
  }

  const body = await readJson<{ password?: string }>(c.req.raw);
  if (!body?.password || !timingSafeEqual(body.password, c.env.ADMIN_PASSWORD)) {
    return c.json({ error: 'INVALID_CREDENTIALS' }, 401);
  }

  setCookie(c, SESSION_COOKIE, await createAdminSession(c.env.ADMIN_PASSWORD), {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL,
  });
  return c.json({ ok: true });
});

app.post('/api/auth/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

app.use('/api/admin/*', async (c, next) => {
  if (!c.env.ADMIN_PASSWORD) return c.json({ error: 'ADMIN_NOT_CONFIGURED' }, 503);
  if (!(await verifyAdminSession(c.req.raw, c.env.ADMIN_PASSWORD))) {
    return c.json({ error: 'UNAUTHORIZED' }, 401);
  }
  await next();
});

app.get('/api/admin/overview', async (c) => {
  const [open, pending, closed, visitors, messages] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM conversations WHERE status = 'open'"),
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM conversations WHERE status = 'pending'"),
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM conversations WHERE status = 'closed'"),
    c.env.DB.prepare('SELECT COUNT(*) AS count FROM visitors'),
    c.env.DB.prepare('SELECT COUNT(*) AS count FROM messages'),
  ]);
  return c.json({
    open: count(open),
    pending: count(pending),
    closed: count(closed),
    visitors: count(visitors),
    messages: count(messages),
  });
});

app.get('/api/admin/conversations', async (c) => {
  const status = c.req.query('status');
  const filtered = status === 'open' || status === 'pending' || status === 'closed';
  let query = c.env.DB.prepare(`
    SELECT c.id, c.site_id, c.visitor_id, c.status, c.subject, c.assigned_agent,
      c.last_message_at, c.created_at, v.display_name AS visitor_name,
      (SELECT body FROM messages m WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC LIMIT 1) AS last_message
    FROM conversations c
    JOIN visitors v ON v.id = c.visitor_id
    ${filtered ? 'WHERE c.status = ?1' : ''}
    ORDER BY c.last_message_at DESC
    LIMIT 100
  `);
  if (filtered) query = query.bind(status);
  const result = await query.all();
  return c.json({ conversations: result.results ?? [] });
});

app.get('/api/admin/conversations/:id/messages', async (c) => {
  const id = c.req.param('id');
  const conversation = await c.env.DB.prepare(
    `SELECT c.*, v.display_name AS visitor_name
     FROM conversations c JOIN visitors v ON v.id = c.visitor_id
     WHERE c.id = ?1`,
  )
    .bind(id)
    .first();
  if (!conversation) return c.json({ error: 'NOT_FOUND' }, 404);

  const messages = await c.env.DB.prepare(
    `SELECT id, conversation_id, sender_type, sender_id, body, created_at
     FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC LIMIT 500`,
  )
    .bind(id)
    .all<MessageRow>();
  return c.json({ conversation, messages: messages.results ?? [] });
});

app.post('/api/admin/conversations/:id/messages', async (c) => {
  const id = c.req.param('id');
  const body = await readJson<{ body?: string }>(c.req.raw);
  const text = body?.body?.trim();
  if (!validMessage(text)) return c.json({ error: 'INVALID_MESSAGE' }, 400);

  const exists = await c.env.DB.prepare('SELECT id FROM conversations WHERE id = ?1')
    .bind(id)
    .first();
  if (!exists) return c.json({ error: 'NOT_FOUND' }, 404);

  const message = await persistMessage(c.env, id, 'agent', 'admin', text!);
  await broadcast(c.env, id, { type: 'message', message });
  return c.json({ message }, 201);
});

app.post('/api/admin/conversations/:id/status', async (c) => {
  const id = c.req.param('id');
  const body = await readJson<{ status?: Status }>(c.req.raw);
  if (!body || !['open', 'pending', 'closed'].includes(body.status ?? '')) {
    return c.json({ error: 'INVALID_STATUS' }, 400);
  }
  const result = await c.env.DB.prepare(
    'UPDATE conversations SET status = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2',
  )
    .bind(body.status, id)
    .run();
  if (!result.meta.changes) return c.json({ error: 'NOT_FOUND' }, 404);
  await broadcast(c.env, id, { type: 'conversation.status', status: body.status });
  return c.json({ ok: true });
});

app.get('/api/admin/realtime/:id', (c) => room(c.env, c.req.param('id')).fetch(c.req.raw));

app.get('/api/public/sites/:publicKey', async (c) => {
  const site = await c.env.DB.prepare(
    'SELECT id, name FROM sites WHERE public_key = ?1 AND is_enabled = 1',
  )
    .bind(c.req.param('publicKey'))
    .first();
  return site ? c.json({ site }) : c.json({ error: 'SITE_NOT_FOUND' }, 404);
});

app.post('/api/public/conversations', async (c) => {
  const body = await readJson<{
    siteKey?: string;
    displayName?: string;
    message?: string;
    metadata?: Record<string, unknown>;
  }>(c.req.raw);
  if (!body?.siteKey) return c.json({ error: 'SITE_KEY_REQUIRED' }, 400);
  if (body.message?.trim() && !validMessage(body.message.trim())) {
    return c.json({ error: 'INVALID_MESSAGE' }, 400);
  }

  const site = await c.env.DB.prepare(
    'SELECT id FROM sites WHERE public_key = ?1 AND is_enabled = 1',
  )
    .bind(body.siteKey)
    .first<{ id: string }>();
  if (!site) return c.json({ error: 'SITE_NOT_FOUND' }, 404);

  const visitorId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
  const tokenHash = await sha256(token);
  const displayName = body.displayName?.trim().slice(0, 80) || 'Visitor';
  const metadata = body.metadata ? JSON.stringify(body.metadata).slice(0, 10000) : null;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO visitors (id, site_id, token_hash, display_name, metadata_json)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    ).bind(visitorId, site.id, tokenHash, displayName, metadata),
    c.env.DB.prepare(
      `INSERT INTO conversations (id, site_id, visitor_id, subject)
       VALUES (?1, ?2, ?3, ?4)`,
    ).bind(conversationId, site.id, visitorId, body.message?.trim().slice(0, 80) || null),
  ]);

  let message: MessageRow | null = null;
  if (body.message?.trim()) {
    message = await persistMessage(
      c.env,
      conversationId,
      'visitor',
      visitorId,
      body.message.trim(),
    );
    await broadcast(c.env, conversationId, { type: 'message', message });
  }
  return c.json({ conversationId, visitorId, token, message }, 201);
});

app.post('/api/public/conversations/:id/messages', async (c) => {
  const id = c.req.param('id');
  const visitor = await authenticateVisitor(c.env, id, c.req.header('Authorization'));
  if (!visitor) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const body = await readJson<{ body?: string }>(c.req.raw);
  const text = body?.body?.trim();
  if (!validMessage(text)) return c.json({ error: 'INVALID_MESSAGE' }, 400);

  const message = await persistMessage(c.env, id, 'visitor', visitor.id, text!);
  await c.env.DB.prepare('UPDATE visitors SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?1')
    .bind(visitor.id)
    .run();
  await broadcast(c.env, id, { type: 'message', message });
  return c.json({ message }, 201);
});

app.get('/api/public/realtime/:id', async (c) => {
  const id = c.req.param('id');
  const token = c.req.query('token');
  const visitor = await authenticateVisitor(c.env, id, token ? `Bearer ${token}` : undefined);
  if (!visitor) return c.json({ error: 'UNAUTHORIZED' }, 401);
  return room(c.env, id).fetch(c.req.raw);
});

app.all('/api/*', (c) => c.json({ error: 'NOT_FOUND' }, 404));
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;

export class ConversationRoom extends DurableObject<Bindings> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname.endsWith('/broadcast')) {
      const payload = await request.text();
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(payload);
        } catch {
          // Dead sockets are cleaned up by the runtime.
        }
      }
      return new Response(null, { status: 204 });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ connectedAt: Date.now() });
    server.send(JSON.stringify({ type: 'ready', time: new Date().toISOString() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (message === 'ping') {
      socket.send(JSON.stringify({ type: 'pong', time: new Date().toISOString() }));
    }
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    socket.close(code, reason);
  }
}

async function persistMessage(
  env: Bindings,
  conversationId: string,
  senderType: SenderType,
  senderId: string,
  body: string,
): Promise<MessageRow> {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO messages (id, conversation_id, sender_type, sender_id, body)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    ).bind(id, conversationId, senderType, senderId, body),
    env.DB.prepare(
      `UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP WHERE id = ?1`,
    ).bind(conversationId),
  ]);
  const message = await env.DB.prepare(
    `SELECT id, conversation_id, sender_type, sender_id, body, created_at
     FROM messages WHERE id = ?1`,
  )
    .bind(id)
    .first<MessageRow>();
  if (!message) throw new Error('Message persistence failed');
  return message;
}

async function authenticateVisitor(
  env: Bindings,
  conversationId: string,
  authorization?: string,
): Promise<{ id: string } | null> {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  return env.DB.prepare(
    `SELECT v.id FROM visitors v
     JOIN conversations c ON c.visitor_id = v.id
     WHERE c.id = ?1 AND v.token_hash = ?2`,
  )
    .bind(conversationId, await sha256(token))
    .first<{ id: string }>();
}

function room(env: Bindings, conversationId: string): DurableObjectStub {
  return env.CONVERSATION_ROOMS.get(env.CONVERSATION_ROOMS.idFromName(conversationId));
}

async function broadcast(env: Bindings, conversationId: string, payload: unknown): Promise<void> {
  await room(env, conversationId).fetch('https://conversation-room/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function validMessage(value?: string): value is string {
  return Boolean(value && value.length <= 8000);
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function count(result: D1Result): number {
  return Number((result.results?.[0] as { count?: number } | undefined)?.count ?? 0);
}

function timingSafeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

async function createAdminSession(password: string): Promise<string> {
  const payload = encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_TTL }));
  return `${payload}.${await hmac(password, payload)}`;
}

async function verifyAdminSession(request: Request, password: string): Promise<boolean> {
  const header = request.headers.get('Cookie') ?? '';
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

async function hmac(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return toBase64Url(new Uint8Array(signature));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function encode(value: string): string {
  return toBase64Url(new TextEncoder().encode(value));
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
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
