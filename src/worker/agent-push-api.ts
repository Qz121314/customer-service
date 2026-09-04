import { Hono } from 'hono';
import { requireAgentSession } from './agent-session';
import { getVisitorPushPublicKey } from './visitor-push';

type Bindings = {
  DB: D1Database;
};

type Env = { Bindings: Bindings };

type PushSubscriptionInput = {
  endpoint?: string;
  expirationTime?: number | null;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
};

export const agentPushApi = new Hono<Env>();

agentPushApi.get('/api/agent/push/config', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);
  return c.json({
    enabled: true,
    applicationServerKey: await getVisitorPushPublicKey(
      c.env.DB,
      new URL(c.req.url).origin,
    ),
  });
});

agentPushApi.post('/api/agent/push/subscriptions', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const body = await readJson<{ subscription?: PushSubscriptionInput }>(
    c.req.raw,
  );
  const endpoint = normalizePushEndpoint(body?.subscription?.endpoint);
  const expirationTime = normalizeExpirationTime(
    body?.subscription?.expirationTime,
  );
  const p256dh = normalizePushKey(body?.subscription?.keys?.p256dh, 65);
  const auth = normalizePushKey(body?.subscription?.keys?.auth, 16);
  if (!endpoint || expirationTime === undefined || !p256dh || !auth) {
    return c.json({ error: 'INVALID_PUSH_SUBSCRIPTION' }, 400);
  }

  await c.env.DB.prepare(
    `INSERT INTO agent_push_subscriptions
       (endpoint, agent_id, expiration_time, p256dh, auth, session_id, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, CURRENT_TIMESTAMP)
     ON CONFLICT(endpoint) DO UPDATE SET
       agent_id = excluded.agent_id,
       expiration_time = excluded.expiration_time,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       session_id = excluded.session_id,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(
      endpoint,
      agent.id,
      expirationTime,
      p256dh,
      auth,
      agent.session_id,
    )
    .run();
  return c.json({ ok: true });
});

agentPushApi.post('/api/agent/push/subscriptions/remove', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const body = await readJson<{ endpoint?: string }>(c.req.raw);
  const endpoint = normalizePushEndpoint(body?.endpoint);
  if (!endpoint) return c.json({ error: 'INVALID_PUSH_SUBSCRIPTION' }, 400);
  await c.env.DB.prepare(
    `DELETE FROM agent_push_subscriptions
     WHERE endpoint = ?1 AND agent_id = ?2`,
  )
    .bind(endpoint, agent.id)
    .run();
  return c.json({ ok: true });
});

function normalizePushEndpoint(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const endpoint = value.trim();
  if (!endpoint || endpoint.length > 4096) return null;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash)
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizePushKey(
  value: unknown,
  expectedBytes: number,
): string | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    return null;
  }
  try {
    const bytes = base64UrlDecode(value);
    return bytes.length === expectedBytes ? value : null;
  } catch {
    return null;
  }
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function normalizeExpirationTime(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= Date.now()
  ) {
    return undefined;
  }
  return Math.floor(value);
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
