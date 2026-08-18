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
  if (!endpoint || expirationTime === undefined) {
    return c.json({ error: 'INVALID_PUSH_SUBSCRIPTION' }, 400);
  }

  await c.env.DB.prepare(
    `INSERT INTO agent_push_subscriptions
       (endpoint, agent_id, expiration_time, updated_at)
     VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
     ON CONFLICT(endpoint) DO UPDATE SET
       agent_id = excluded.agent_id,
       expiration_time = excluded.expiration_time,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(endpoint, agent.id, expirationTime)
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

function normalizeExpirationTime(
  value: unknown,
): number | null | undefined {
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
