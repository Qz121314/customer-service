import { Hono, type Context } from 'hono';

type Bindings = {
  DB: D1Database;
};

type Env = { Bindings: Bindings };

type AgentSession = {
  id: string;
  site_id: string;
};

type AutoReplyRow = {
  is_enabled: number;
  message_text: string | null;
};

const COOKIE = 'cs_agent_session';
const INITIAL_GREETING = 'initial_greeting';
const MAX_GREETING_LENGTH = 2000;

export const agentAutoReplyApi = new Hono<Env>();

agentAutoReplyApi.get('/api/agent/auto-replies', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);

  const row = await c.env.DB.prepare(
    `SELECT is_enabled, message_text
     FROM agent_auto_replies
     WHERE agent_id = ?1 AND site_id = ?2 AND reply_type = ?3
     LIMIT 1`,
  )
    .bind(agent.id, agent.site_id, INITIAL_GREETING)
    .first<AutoReplyRow>();

  return c.json({ initialGreeting: publicInitialGreeting(row) });
});

agentAutoReplyApi.put('/api/agent/auto-replies/initial-greeting', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);

  const body = await readJson<{ enabled?: unknown; text?: unknown }>(c.req.raw);
  if (!body || typeof body.enabled !== 'boolean' || typeof body.text !== 'string') {
    return c.json({ error: 'INVALID_AUTO_REPLY' }, 400);
  }

  const text = body.text.trim();
  if (text.length > MAX_GREETING_LENGTH) {
    return c.json({ error: 'AUTO_REPLY_TOO_LONG' }, 400);
  }

  // An empty greeting is always inactive. This keeps auto reply optional even if
  // a stale client submits enabled=true with no usable message.
  const enabled = body.enabled && text.length > 0;

  await c.env.DB.prepare(
    `INSERT INTO agent_auto_replies (
       agent_id, site_id, reply_type, is_enabled, message_text, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP)
     ON CONFLICT(agent_id, reply_type) DO UPDATE SET
       site_id = excluded.site_id,
       is_enabled = excluded.is_enabled,
       message_text = excluded.message_text,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(agent.id, agent.site_id, INITIAL_GREETING, enabled ? 1 : 0, text || null)
    .run();

  return c.json({
    ok: true,
    initialGreeting: { enabled, text },
  });
});

function publicInitialGreeting(row: AutoReplyRow | null) {
  const text = row?.message_text?.trim() ?? '';
  return {
    enabled: row?.is_enabled === 1 && text.length > 0,
    text,
  };
}

async function authenticateAgent(c: Context<Env>): Promise<AgentSession | null> {
  const token = cookieValue(c.req.header('Cookie'), COOKIE);
  if (!token) return null;

  return c.env.DB.prepare(
    `SELECT a.id, a.site_id
     FROM agent_sessions session
     JOIN agents a ON a.id = session.agent_id
     WHERE session.token_hash = ?1
       AND datetime(session.expires_at) > CURRENT_TIMESTAMP
       AND a.is_enabled = 1
       AND a.username IS NOT NULL
     LIMIT 1`,
  )
    .bind(await sha256(token))
    .first<AgentSession>();
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

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function unauthorized(c: Context<Env>) {
  return c.json({ error: 'UNAUTHORIZED' }, 401);
}
