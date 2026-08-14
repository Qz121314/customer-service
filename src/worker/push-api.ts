import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { getVisitorPushPublicKey } from './visitor-push';

type Bindings = {
  DB: D1Database;
};

type Env = { Bindings: Bindings };

type PushSubscriptionInput = {
  endpoint?: string;
  expirationTime?: number | null;
};

type IdentityRow = {
  site_id: string;
  external_id: string;
};

export const pushApi = new Hono<Env>();

pushApi.use(
  '/client/v1/push/*',
  cors({
    origin: '*',
    allowHeaders: ['Content-Type'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    maxAge: 86400,
  }),
);

pushApi.get('/client/v1/push/config', async (c) => {
  const site = await findSite(
    c.env.DB,
    normalizeProjectId(c.req.query('projectId')),
  );
  if (!site) return clientError(c, 404, 'PROJECT_NOT_FOUND');
  return c.json({
    enabled: true,
    applicationServerKey: await getVisitorPushPublicKey(
      c.env.DB,
      new URL(c.req.url).origin,
    ),
  });
});

pushApi.post('/client/v1/push/subscriptions', async (c) => {
  const body = await readJson<{
    visitorId?: string;
    projectId?: string | null;
    conversationId?: string;
    subscription?: PushSubscriptionInput;
  }>(c.req.raw);
  const visitorId = normalizeVisitorId(body?.visitorId);
  const conversationId = normalizeId(body?.conversationId, 200);
  const endpoint = normalizePushEndpoint(body?.subscription?.endpoint);
  const expirationTime = normalizeExpirationTime(
    body?.subscription?.expirationTime,
  );
  if (!visitorId) return clientError(c, 400, 'INVALID_VISITOR_ID');
  if (!conversationId) return clientError(c, 400, 'INVALID_CONVERSATION_ID');
  if (!endpoint) return clientError(c, 400, 'INVALID_PUSH_SUBSCRIPTION');

  const identity = await resolveConversationIdentity(c.env.DB, conversationId, {
    visitorId,
    projectId: normalizeProjectId(body?.projectId),
  });
  if (!identity) return clientError(c, 404, 'CONVERSATION_NOT_FOUND');

  await c.env.DB.prepare(
    `INSERT INTO visitor_push_subscriptions
       (endpoint, site_id, visitor_external_id, expiration_time, updated_at)
     VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)
     ON CONFLICT(endpoint) DO UPDATE SET
       site_id = excluded.site_id,
       visitor_external_id = excluded.visitor_external_id,
       expiration_time = excluded.expiration_time,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(endpoint, identity.site_id, identity.external_id, expirationTime)
    .run();

  return c.json({ ok: true });
});

pushApi.post('/client/v1/push/subscriptions/remove', async (c) => {
  const body = await readJson<{
    visitorId?: string;
    projectId?: string | null;
    endpoint?: string;
  }>(c.req.raw);
  const visitorId = normalizeVisitorId(body?.visitorId);
  const endpoint = normalizePushEndpoint(body?.endpoint);
  if (!visitorId) return clientError(c, 400, 'INVALID_VISITOR_ID');
  if (!endpoint) return clientError(c, 400, 'INVALID_PUSH_SUBSCRIPTION');

  const site = await findSite(c.env.DB, normalizeProjectId(body?.projectId));
  if (!site) return clientError(c, 404, 'PROJECT_NOT_FOUND');

  await c.env.DB.prepare(
    `DELETE FROM visitor_push_subscriptions
     WHERE endpoint = ?1 AND site_id = ?2 AND visitor_external_id = ?3`,
  )
    .bind(endpoint, site.id, visitorId)
    .run();
  return c.json({ ok: true });
});

async function resolveConversationIdentity(
  db: D1Database,
  conversationId: string,
  input: { visitorId: string; projectId: string },
): Promise<IdentityRow | null> {
  return db
    .prepare(
      `SELECT c.site_id, v.external_id
       FROM conversations c
       JOIN visitors v ON v.id = c.visitor_id
       JOIN sites s ON s.id = c.site_id
       WHERE c.id = ?1
         AND (s.id = ?2 OR s.public_key = ?2)
         AND s.is_enabled = 1
         AND v.external_id = ?3
         AND COALESCE(v.expires_at, datetime(v.created_at, '+1 day')) > CURRENT_TIMESTAMP
         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP
       LIMIT 1`,
    )
    .bind(conversationId, input.projectId, input.visitorId)
    .first<IdentityRow>();
}

async function findSite(db: D1Database, projectId: string) {
  return db
    .prepare(
      `SELECT id FROM sites
       WHERE (id = ?1 OR public_key = ?1) AND is_enabled = 1 LIMIT 1`,
    )
    .bind(projectId)
    .first<{ id: string }>();
}

function normalizeProjectId(value?: string | null): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= 200 ? trimmed : 'default';
}

function normalizeVisitorId(value?: string | null): string | null {
  const visitorId = value?.trim().toUpperCase() ?? '';
  if (!/^[A-Z0-9]{6}$/u.test(visitorId)) return null;
  const letters = [...visitorId].filter((char) => /[A-Z]/u.test(char)).length;
  const digits = [...visitorId].filter((char) => /[0-9]/u.test(char)).length;
  return letters === 3 && digits === 3 ? visitorId : null;
}

function normalizeId(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function normalizePushEndpoint(value: unknown): string | null {
  const endpoint = normalizeId(value, 4096);
  if (!endpoint) return null;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash)
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeExpirationTime(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= Date.now()
  )
    return null;
  return Math.floor(value);
}

function clientError(c: Context<Env>, status: 400 | 404, code: string) {
  return c.json({ error: { code, message: code } }, status);
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
