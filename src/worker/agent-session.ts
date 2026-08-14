import type { Context } from 'hono';

const COOKIE = 'cs_agent_session';

export type AgentSessionIdentity = {
  id: string;
  name: string;
  username: string;
  status: 'online' | 'busy' | 'offline';
};

export async function authenticateAgentSession(
  db: D1Database,
  cookieHeader?: string,
): Promise<AgentSessionIdentity | null> {
  const token = cookieValue(cookieHeader, COOKIE);
  if (!token) return null;
  return db
    .prepare(
      `SELECT a.id, a.name, a.username, a.status
       FROM agent_sessions s
       JOIN agents a ON a.id = s.agent_id
       WHERE s.token_hash = ?1
         AND datetime(s.expires_at) > CURRENT_TIMESTAMP
         AND a.is_enabled = 1
         AND a.username IS NOT NULL
       LIMIT 1`,
    )
    .bind(await sha256(token))
    .first<AgentSessionIdentity>();
}

export async function requireAgentSession<
  T extends { Bindings: { DB: D1Database } },
>(c: Context<T>): Promise<AgentSessionIdentity | null> {
  return authenticateAgentSession(c.env.DB, c.req.header('Cookie'));
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
