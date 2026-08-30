import { Hono, type Context } from 'hono';
import { verifyAdminSession } from './core';
import { loadNoAgentMessage, normalizeNoAgentMessage } from './site-settings';

type Bindings = {
  DB: D1Database;
  ADMIN_PASSWORD?: string;
};

type Env = { Bindings: Bindings };

export const siteSettingsApi = new Hono<Env>();

siteSettingsApi.get('/api/admin/settings', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  return c.json({
    settings: {
      noAgentMessage: await loadNoAgentMessage(c.env.DB),
    },
  });
});

siteSettingsApi.patch('/api/admin/settings', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const body = await readJson<{ noAgentMessage?: unknown }>(c.req.raw);
  const noAgentMessage = normalizeNoAgentMessage(body?.noAgentMessage);
  if (!noAgentMessage) {
    return c.json({ error: 'INVALID_NO_AGENT_MESSAGE' }, 400);
  }

  const result = await c.env.DB.prepare(
    `UPDATE sites
     SET no_agent_message = ?1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = 'default'`,
  )
    .bind(noAgentMessage)
    .run();
  if (Number(result.meta?.changes ?? 0) !== 1) {
    return c.json({ error: 'SITE_SETTINGS_UPDATE_FAILED' }, 500);
  }

  return c.json({
    ok: true,
    settings: { noAgentMessage },
  });
});

async function adminAuthorized(c: Context<Env>): Promise<boolean> {
  const password = c.env.ADMIN_PASSWORD;
  return Boolean(password && (await verifyAdminSession(c.req.raw, password)));
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
