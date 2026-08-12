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
  if (!c.env.ADMIN_PASSWORD)
    return c.json({ authenticated: false, configured: false });
  const authenticated = await verifyAdminSession(
    c.req.raw,
    c.env.ADMIN_PASSWORD,
  );
  return c.json({ authenticated, configured: true });
});

app.post('/api/auth/login', async (c) => {
  if (!c.env.ADMIN_PASSWORD) {
    return c.json(
      {
        error: 'ADMIN_NOT_CONFIGURED',
        message:
          'Set the ADMIN_PASSWORD Worker Secret on customer-service-app.',
      },
      503,
    );
  }

  const body = await readJson<{ password?: string }>(c.req.raw);
  if (
    !body?.password ||
    !timingSafeEqual(body.password, c.env.ADMIN_PASSWORD)
  ) {
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
  if (!c.env.ADMIN_PASSWORD)
    return c.json({ error: 'ADMIN_NOT_CONFIGURED' }, 503);
  if (!(await verifyAdminSession(c.req.raw, c.env.ADMIN_PASSWORD))) {
    return c.json({ error: 'UNAUTHORIZED' }, 401);
  }
  await next();
});

app.get('/api/admin/overview', async (c) => {
  const [open, pending, closed, visitors, messages] = await c.env.DB.batch([
    c.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM conversations WHERE status = 'open'",
    ),
    c.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM conversations WHERE status = 'pending'",
    ),
    c.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM conversations WHERE status = 'closed'",
    ),
    c.env.DB.prepare('SELECT COUNT(*) AS count FROM visitors'),
    c.env.DB.prepare('SELECT COUNT(*) AS count FROM messages'),
  ]);
  return c.json({
    open: countFrom(open),
    pending: countFrom(pending),
    closed: countFrom(closed),
    visitors: countFrom(visitors),
    messages: countFrom(messages),
  });
});

app.get('/api/admin/conversations', async (c) => {
  const status = c.req.query('status');
  const where =
    status && ['open', 'pending', 'closed'].includes(status)
      ? 'WHERE c.status = ?'
      : '';
  const statement = c.env.DB.prepare(`
    SELECT
      c.id,
      c.status,
      c.subject,
      c.assigned_to,
      c.last_message_at,
      c.created_at,
      v.id AS visitor_id,
      v.name AS visitor_name,
      v.email AS visitor_email,
      v.external_id AS visitor_external_id,
      s.id AS site_id,
      s.name AS site_name,
      (
        SELECT body FROM messages m
        WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC LIMIT 1
      ) AS last_message
    FROM conversations c
    JOIN visitors v ON v.id = c.visitor_id
    JOIN sites s ON s.id = c.site_id
    ${where}
    ORDER BY c.last_message_at DESC
    LIMIT 100
  `);
  const result = where
    ? await statement.bind(status).all()
    : await statement.all();
  return c.json({ conversations: result.results });
});

app.get('/api/admin/conversations/:id/messages', async (c) => {
  const conversationId = c.req.param('id');
  const conversation = await getConversation(c.env.DB, conversationId);
  if (!conversation) return c.json({ error: 'NOT_FOUND' }, 404);
  const messages = await listMessages(c.env.DB, conversationId);
  return c.json({ conversation, messages });
});

app.post('/api/admin/conversations/:id/messages', async (c) => {
  const conversationId = c.req.param('id');
  const conversation = await getConversation(c.env.DB, conversationId);
  if (!conversation) return c.json({ error: 'NOT_FOUND' }, 404);
  const body = await readJson<{ body?: string }>(c.req.raw);
  const messageBody = normalizeMessageBody(body?.body);
  if (!messageBody) return c.json({ error: 'MESSAGE_REQUIRED' }, 400);
  const message = await insertMessage(c.env.DB, {
    conversationId,
    senderType: 'agent',
    senderId: 'admin',
    body: messageBody,
  });
  await publishRealtime(c.env.CONVERSATION_ROOMS, conversationId, {
    type: 'message.created',
    message,
  });
  return c.json({ message }, 201);
});

app.post('/api/admin/conversations/:id/status', async (c) => {
  const conversationId = c.req.param('id');
  const body = await readJson<{ status?: Status }>(c.req.raw);
  if (!body?.status || !['open', 'pending', 'closed'].includes(body.status)) {
    return c.json({ error: 'INVALID_STATUS' }, 400);
  }
  const now = new Date().toISOString();
  const result = await c.env.DB.prepare(
    'UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?',
  )
    .bind(body.status, now, conversationId)
    .run();
  if (!result.meta.changes) return c.json({ error: 'NOT_FOUND' }, 404);
  await publishRealtime(c.env.CONVERSATION_ROOMS, conversationId, {
    type: 'conversation.status',
    status: body.status,
  });
  return c.json({ ok: true, status: body.status });
});

app.get('/api/admin/realtime/:id', async (c) => {
  const conversationId = c.req.param('id');
  return proxyRealtime(c.env.CONVERSATION_ROOMS, conversationId, c.req.raw);
});

app.get('/api/public/sites/:publicKey', async (c) => {
  const publicKey = c.req.param('publicKey');
  const site = await c.env.DB.prepare(
    'SELECT id, name, public_key, status FROM sites WHERE public_key = ?',
  )
    .bind(publicKey)
    .first();
  if (!site || site.status !== 'active') return c.json({ error: 'NOT_FOUND' }, 404);
  return c.json({ site });
});

app.post('/api/public/conversations', async (c) => {
  const body = await readJson<{
    siteKey?: string;
    visitorId?: string;
    name?: string;
    email?: string;
    subject?: string;
    message?: string;
  }>(c.req.raw);
  if (!body?.siteKey) return c.json({ error: 'SITE_KEY_REQUIRED' }, 400);
  const site = await c.env.DB.prepare(
    'SELECT id, name, public_key, status FROM sites WHERE public_key = ?',
  )
    .bind(body.siteKey)
    .first<{ id: string; name: string; public_key: string; status: string }>();
  if (!site || site.status !== 'active') return c.json({ error: 'SITE_NOT_FOUND' }, 404);

  const visitor = await upsertVisitor(c.env.DB, {
    siteId: site.id,
    externalId: normalizeOptional(body.visitorId),
    name: normalizeOptional(body.name),
    email: normalizeOptional(body.email),
  });
  const conversationId = crypto.randomUUID();
  const visitorToken = createVisitorToken();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO conversations
      (id, site_id, visitor_id, status, subject, visitor_token, last_message_at, created_at, updated_at)
     VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
  )
    .bind(
      conversationId,
      site.id,
      visitor.id,
      normalizeOptional(body.subject),
      visitorToken,
      now,
      now,
      now,
    )
    .run();

  let message: MessageRow | null = null;
  const initialMessage = normalizeMessageBody(body.message);
  if (initialMessage) {
    message = await insertMessage(c.env.DB, {
      conversationId,
      senderType: 'visitor',
      senderId: visitor.id,
      body: initialMessage,
    });
  }

  return c.json(
    {
      conversation: {
        id: conversationId,
        siteId: site.id,
        visitorId: visitor.id,
        visitorToken,
        status: 'open',
      },
      message,
    },
    201,
  );
});

app.post('/api/public/conversations/:id/messages', async (c) => {
  const conversationId = c.req.param('id');
  const token = extractBearer(c.req.raw);
  if (!(await verifyVisitorToken(c.env.DB, conversationId, token))) {
    return c.json({ error: 'UNAUTHORIZED' }, 401);
  }
  const body = await readJson<{ body?: string }>(c.req.raw);
  const messageBody = normalizeMessageBody(body?.body);
  if (!messageBody) return c.json({ error: 'MESSAGE_REQUIRED' }, 400);
  const conversation = await getConversation(c.env.DB, conversationId);
  if (!conversation) return c.json({ error: 'NOT_FOUND' }, 404);
  const message = await insertMessage(c.env.DB, {
    conversationId,
    senderType: 'visitor',
    senderId: String(conversation.visitor_id),
    body: messageBody,
  });
  await publishRealtime(c.env.CONVERSATION_ROOMS, conversationId, {
    type: 'message.created',
    message,
  });
  return c.json({ message }, 201);
});

app.get('/api/public/realtime/:id', async (c) => {
  const conversationId = c.req.param('id');
  const token = c.req.query('token');
  if (!(await verifyVisitorToken(c.env.DB, conversationId, token))) {
    return c.json({ error: 'UNAUTHORIZED' }, 401);
  }
  return proxyRealtime(c.env.CONVERSATION_ROOMS, conversationId, c.req.raw);
});

app.notFound(async (c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ error: 'NOT_FOUND' }, 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

export class ConversationRoom extends DurableObject {
  fetch(request: Request): Response {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(_webSocket: WebSocket, message: string | ArrayBuffer): void {
    const payload =
      typeof message === 'string'
        ? message
        : new TextDecoder().decode(new Uint8Array(message));
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(payload);
      } catch {
        // A stale socket will be cleaned up by the runtime.
      }
    }
  }

  webSocketClose(
    webSocket: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ): void {
    webSocket.close(code, reason);
    void wasClean;
  }

  webSocketError(webSocket: WebSocket): void {
    webSocket.close(1011, 'WebSocket error');
  }
}

export default app;

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return await request.json<T>();
  } catch {
    return null;
  }
}

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 300) : null;
}

function normalizeMessageBody(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 8000) : null;
}

function countFrom(result: D1Result): number {
  const value = result.results[0] as { count?: number | string } | undefined;
  return Number(value?.count ?? 0);
}

async function getConversation(db: D1Database, id: string) {
  return db
    .prepare(
      `SELECT
        c.*,
        v.name AS visitor_name,
        v.email AS visitor_email,
        v.external_id AS visitor_external_id,
        s.name AS site_name
       FROM conversations c
       JOIN visitors v ON v.id = c.visitor_id
       JOIN sites s ON s.id = c.site_id
       WHERE c.id = ?`,
    )
    .bind(id)
    .first();
}

async function listMessages(db: D1Database, conversationId: string) {
  const result = await db
    .prepare(
      `SELECT id, conversation_id, sender_type, sender_id, body, created_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC
       LIMIT 500`,
    )
    .bind(conversationId)
    .all<MessageRow>();
  return result.results;
}

async function insertMessage(
  db: D1Database,
  input: {
    conversationId: string;
    senderType: SenderType;
    senderId: string | null;
    body: string;
  },
): Promise<MessageRow> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO messages
          (id, conversation_id, sender_type, sender_id, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.conversationId,
        input.senderType,
        input.senderId,
        input.body,
        now,
      ),
    db
      .prepare(
        'UPDATE conversations SET last_message_at = ?, updated_at = ? WHERE id = ?',
      )
      .bind(now, now, input.conversationId),
  ]);
  return {
    id,
    conversation_id: input.conversationId,
    sender_type: input.senderType,
    sender_id: input.senderId,
    body: input.body,
    created_at: now,
  };
}

async function upsertVisitor(
  db: D1Database,
  input: {
    siteId: string;
    externalId: string | null;
    name: string | null;
    email: string | null;
  },
) {
  if (input.externalId) {
    const existing = await db
      .prepare(
        'SELECT id, external_id, name, email FROM visitors WHERE site_id = ? AND external_id = ?',
      )
      .bind(input.siteId, input.externalId)
      .first<{
        id: string;
        external_id: string;
        name: string | null;
        email: string | null;
      }>();
    if (existing) return existing;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      'INSERT INTO visitors (id, site_id, external_id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      id,
      input.siteId,
      input.externalId,
      input.name,
      input.email,
      now,
      now,
    )
    .run();
  return {
    id,
    external_id: input.externalId,
    name: input.name,
    email: input.email,
  };
}

async function verifyVisitorToken(
  db: D1Database,
  conversationId: string,
  token?: string | null,
): Promise<boolean> {
  if (!token) return false;
  const row = await db
    .prepare('SELECT visitor_token FROM conversations WHERE id = ?')
    .bind(conversationId)
    .first<{ visitor_token: string }>();
  return Boolean(row && timingSafeEqual(row.visitor_token, token));
}

function extractBearer(request: Request): string | null {
  const value = request.headers.get('Authorization');
  if (!value?.startsWith('Bearer ')) return null;
  return value.slice(7).trim() || null;
}

function createVisitorToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return base64UrlEncode(bytes);
}

async function createAdminSession(password: string): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = `${timestamp}.admin`;
  return `${payload}.${await signHmac(password, payload)}`;
}

async function verifyAdminSession(
  request: Request,
  password: string,
): Promise<boolean> {
  const cookie = request.headers.get('Cookie');
  const token = cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!token) return false;
  const [timestampText, identity, signature] = token.split('.');
  if (!timestampText || identity !== 'admin' || !signature) return false;
  const timestamp = Number(timestampText);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.floor(Date.now() / 1000) - timestamp > SESSION_TTL) return false;
  const payload = `${timestampText}.${identity}`;
  const expected = await signHmac(password, payload);
  return timingSafeEqual(signature, expected);
}

async function signHmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(value),
  );
  return base64UrlEncode(new Uint8Array(signature));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function publishRealtime(
  rooms: DurableObjectNamespace,
  conversationId: string,
  payload: unknown,
): Promise<void> {
  const stub = rooms.get(rooms.idFromName(conversationId));
  await stub.fetch('https://conversation-room.internal/broadcast', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function proxyRealtime(
  rooms: DurableObjectNamespace,
  conversationId: string,
  request: Request,
): Promise<Response> {
  const stub = rooms.get(rooms.idFromName(conversationId));
  return stub.fetch(request);
}
