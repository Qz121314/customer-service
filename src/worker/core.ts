import { DurableObject } from 'cloudflare:workers';
import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';

type RealtimeParticipantRole = 'visitor' | 'agent';

type RealtimeSocketAttachment = {
  connectedAt: number;
  agentId: string | null;
  participantId: string | null;
  participantRole: RealtimeParticipantRole | null;
};

interface Bindings {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_PASSWORD?: string;
  ENVIRONMENT: string;
  APP_VERSION: string;
}

type AppEnv = { Bindings: Bindings };

const SESSION_COOKIE = 'cs_session';
const SESSION_TTL = 60 * 60 * 24 * 7;

export const coreApp = new Hono<AppEnv>();

coreApp.get('/api/health', (c) =>
  c.json({
    ok: true,
    service: 'customer-service',
    version: c.env.APP_VERSION,
    environment: c.env.ENVIRONMENT,
    time: new Date().toISOString(),
  }),
);

coreApp.get('/api/auth/session', async (c) => {
  if (!c.env.ADMIN_PASSWORD) {
    return c.json({ authenticated: false, configured: false });
  }
  const authenticated = await verifyAdminSession(
    c.req.raw,
    c.env.ADMIN_PASSWORD,
  );
  return c.json({ authenticated, configured: true });
});

coreApp.post('/api/auth/login', async (c) => {
  if (!c.env.ADMIN_PASSWORD) {
    return c.json(
      {
        error: 'ADMIN_NOT_CONFIGURED',
        message: 'Set ADMIN_PASSWORD and redeploy.',
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

coreApp.post('/api/auth/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

// Unknown API paths must never fall through to the SPA. This also guarantees
// that removed legacy chat protocols stay unreachable after deployment.
coreApp.all('/api/*', (c) => c.json({ error: 'NOT_FOUND' }, 404));
coreApp.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export class ConversationRoom extends DurableObject<Bindings> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.method === 'POST' &&
      url.pathname.endsWith('/disconnect-agent')
    ) {
      const body = await readJson<{ agentId?: string }>(request);
      const agentId = body?.agentId?.trim();
      if (!agentId) return new Response('Agent ID required', { status: 400 });
      for (const socket of this.ctx.getWebSockets()) {
        const attachment =
          socket.deserializeAttachment() as RealtimeSocketAttachment | null;
        if (attachment?.agentId === agentId) {
          socket.close(1008, 'Agent access revoked');
        }
      }
      return new Response(null, { status: 204 });
    }

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
    const agentId = request.headers.get('X-CS-Agent-ID')?.trim() || null;
    const participantRole = normalizeRealtimeParticipantRole(
      request.headers.get('X-CS-Participant-Role'),
    );
    const participantId =
      request.headers.get('X-CS-Participant-ID')?.trim().slice(0, 200) || null;
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      connectedAt: Date.now(),
      agentId,
      participantId,
      participantRole,
    } satisfies RealtimeSocketAttachment);
    if (agentId) await this.touchAgent(agentId);
    server.send(
      JSON.stringify({ type: 'ready', time: new Date().toISOString() }),
    );
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const attachment =
      socket.deserializeAttachment() as RealtimeSocketAttachment | null;
    if (message === 'ping') {
      if (attachment?.agentId) await this.touchAgent(attachment.agentId);
      socket.send(
        JSON.stringify({ type: 'pong', time: new Date().toISOString() }),
      );
      return;
    }

    if (
      typeof message !== 'string' ||
      message.length > 512 ||
      !attachment?.participantRole ||
      !attachment.participantId
    ) {
      return;
    }
    const signal = parseTypingSignal(message);
    if (!signal) return;

    const payload = JSON.stringify({
      type: 'typing',
      actor: attachment.participantRole,
      active: signal.active,
      sentAt: new Date().toISOString(),
    });
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === socket) continue;
      try {
        peer.send(payload);
      } catch {
        // Dead sockets are cleaned up by the runtime.
      }
    }
  }

  private async touchAgent(agentId: string): Promise<void> {
    await this.env.DB.prepare(
      `UPDATE agents
       SET status = CASE WHEN status = 'busy' THEN 'busy' ELSE 'online' END,
           last_seen_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND is_enabled = 1`,
    )
      .bind(agentId)
      .run();
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    socket.close(code, reason);
  }
}

function normalizeRealtimeParticipantRole(
  value: string | null,
): RealtimeParticipantRole | null {
  return value === 'visitor' || value === 'agent' ? value : null;
}

function parseTypingSignal(value: string): { active: boolean } | null {
  try {
    const parsed = JSON.parse(value) as { type?: unknown; active?: unknown };
    if (parsed.type !== 'typing' || typeof parsed.active !== 'boolean') {
      return null;
    }
    return { active: parsed.active };
  } catch {
    return null;
  }
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
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

async function createAdminSession(password: string): Promise<string> {
  const payload = encode(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_TTL }),
  );
  return `${payload}.${await hmac(password, payload)}`;
}

async function verifyAdminSession(
  request: Request,
  password: string,
): Promise<boolean> {
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
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(value),
  );
  return toBase64Url(new Uint8Array(signature));
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
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
