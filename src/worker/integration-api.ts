import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';

type IntegrationBindings = {
  DB: D1Database;
  INTEGRATION_VERIFY_TOKEN?: string;
};

type IntegrationEnv = { Bindings: IntegrationBindings };

type SupportGroupRow = {
  id: string;
  name: string;
  is_enabled: number;
};

export const integrationApi = new Hono<IntegrationEnv>();

integrationApi.use(
  '/integration/v1/*',
  cors({
    origin: '*',
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    maxAge: 86400,
  }),
);

integrationApi.get('/integration/v1/status', (c) =>
  c.json({
    ok: true,
    protocolVersion: 'v1',
  }),
);

/**
 * Public control-plane endpoint used when an external Site admin connects this
 * customer-service installation. The caller may be hosted in any Cloudflare
 * account or on any other HTTPS origin. The verification token is never
 * returned and is never part of visitor conversation traffic.
 */
integrationApi.post('/integration/v1/verify', async (c) => {
  c.header('Cache-Control', 'no-store');
  const configuredToken = c.env.INTEGRATION_VERIFY_TOKEN?.trim();
  if (!configuredToken) {
    return integrationError(
      c,
      503,
      'INTEGRATION_NOT_CONFIGURED',
      'Integration verification is not configured.',
    );
  }

  const suppliedToken = bearerToken(c.req.header('Authorization'));
  if (!suppliedToken || !timingSafeEqual(suppliedToken, configuredToken)) {
    return integrationError(
      c,
      401,
      'INVALID_VERIFY_TOKEN',
      'Integration verification token is invalid.',
    );
  }

  const site = await c.env.DB.prepare(
    `SELECT id
     FROM sites
     WHERE id = 'default' AND is_enabled = 1
     LIMIT 1`,
  ).first<{ id: string }>();
  if (!site) {
    return integrationError(
      c,
      503,
      'INTEGRATION_SITE_UNAVAILABLE',
      'Customer-service integration site is unavailable.',
    );
  }

  const groups = await c.env.DB.prepare(
    `SELECT id, name, is_enabled
     FROM support_groups
     WHERE site_id = ?1
     ORDER BY name COLLATE NOCASE ASC, id ASC`,
  )
    .bind(site.id)
    .all<SupportGroupRow>();

  const requestUrl = new URL(c.req.url);
  const origin = requestUrl.origin;
  const realtimeUrl = new URL('/client/v1/realtime', origin);
  realtimeUrl.protocol = realtimeUrl.protocol === 'https:' ? 'wss:' : 'ws:';

  return c.json({
    ok: true,
    protocolVersion: 'v1',
    clientApiUrl: new URL('/client/v1', origin).toString().replace(/\/$/u, ''),
    realtimeUrl: realtimeUrl.toString(),
    groups: (groups.results ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      isEnabled: group.is_enabled === 1,
    })),
  });
});

function bearerToken(authorization?: string): string | null {
  const match = authorization?.match(/^Bearer\s+(.+)$/iu);
  const token = match?.[1]?.trim();
  return token || null;
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let result = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    result |= leftBytes[index] ^ rightBytes[index];
  }
  return result === 0;
}

function integrationError(
  c: Context<IntegrationEnv>,
  status: 401 | 503,
  code: string,
  message: string,
) {
  return c.json({ error: { code, message } }, status);
}
