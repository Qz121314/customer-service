import { Hono, type Context } from 'hono';

type Bindings = {
  DB: D1Database;
};

type Env = { Bindings: Bindings };

type AgentAutoReplySettings = {
  enabled: boolean;
  text: string;
};

type AgentSettingsRow = {
  id: string;
  auto_greeting_enabled: number;
  auto_greeting_text: string | null;
};

const COOKIE = 'cs_agent_session';
const AUTO_GREETING_LIMIT = 1000;

export const agentAutoReplyApi = new Hono<Env>();

agentAutoReplyApi.get('/api/agent/settings/auto-reply', async (c) => {
  const agent = await authenticateAgentSettings(c);
  if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);
  return c.json({ settings: settingsPayload(agent) });
});

agentAutoReplyApi.patch('/api/agent/settings/auto-reply', async (c) => {
  const agent = await authenticateAgentSettings(c);
  if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const body = await readJson<{ enabled?: boolean; text?: string }>(c.req.raw);
  if (
    !body ||
    typeof body.enabled !== 'boolean' ||
    typeof body.text !== 'string'
  ) {
    return c.json({ error: 'INVALID_AUTO_REPLY' }, 400);
  }

  const text = body.text.trim();
  if (text.length > AUTO_GREETING_LIMIT || (body.enabled && !text)) {
    return c.json({ error: 'INVALID_AUTO_REPLY' }, 400);
  }

  const result = await c.env.DB.prepare(
    `UPDATE agents
     SET auto_greeting_enabled = ?1,
         auto_greeting_text = ?2,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?3 AND is_enabled = 1
     RETURNING id, auto_greeting_enabled, auto_greeting_text`,
  )
    .bind(body.enabled ? 1 : 0, text || null, agent.id)
    .first<AgentSettingsRow>();
  if (!result) return c.json({ error: 'UNAUTHORIZED' }, 401);

  return c.json({ settings: settingsPayload(result) });
});

function settingsPayload(row: AgentSettingsRow): AgentAutoReplySettings {
  return {
    enabled: row.auto_greeting_enabled === 1,
    text: row.auto_greeting_text ?? '',
  };
}

async function authenticateAgentSettings(
  c: Context<Env>,
): Promise<AgentSettingsRow | null> {
  const token = cookieValue(c.req.header('Cookie'), COOKIE);
  if (!token) return null;
  return c.env.DB.prepare(
    `SELECT a.id, a.auto_greeting_enabled, a.auto_greeting_text
     FROM agent_sessions session
     JOIN agents a ON a.id = session.agent_id
     WHERE session.token_hash = ?1
       AND datetime(session.expires_at) > CURRENT_TIMESTAMP
       AND a.is_enabled = 1
       AND a.username IS NOT NULL
     LIMIT 1`,
  )
    .bind(await sha256(token))
    .first<AgentSettingsRow>();
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

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
