import { Hono, type Context } from 'hono';

type Bindings = {
  DB: D1Database;
  ADMIN_PASSWORD?: string;
};

type Env = { Bindings: Bindings };

type AgentRow = {
  id: string;
  name: string;
  username: string | null;
  status: 'online' | 'busy' | 'offline';
  is_enabled: number;
  max_active_conversations: number;
  last_login_at: string | null;
  last_seen_at: string | null;
  password_hash: string | null;
  password_salt: string | null;
};

type GroupRow = {
  id: string;
  name: string;
  is_enabled: number;
  routing_strategy: string;
};

const SESSION_COOKIE = 'cs_session';
const PASSWORD_ITERATIONS = 120_000;

export const adminConfigApi = new Hono<Env>();

adminConfigApi.get('/api/admin/agents', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);

  const [agentsResult, membershipsResult] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, name, username, status, is_enabled, max_active_conversations,
         last_login_at, last_seen_at, password_hash, password_salt
       FROM agents
       WHERE id <> 'admin'
       ORDER BY is_enabled DESC, name ASC, id ASC`,
    ).all<AgentRow>(),
    c.env.DB.prepare(
      `SELECT ga.agent_id, ga.group_id
       FROM group_agents ga
       JOIN support_groups sg
         ON sg.site_id = ga.site_id AND sg.id = ga.group_id
       WHERE ga.site_id = 'default' AND ga.is_enabled = 1
       ORDER BY sg.name ASC, ga.group_id ASC`,
    ).all<{ agent_id: string; group_id: string }>(),
  ]);

  const groupIdsByAgent = new Map<string, string[]>();
  for (const membership of membershipsResult.results ?? []) {
    const current = groupIdsByAgent.get(membership.agent_id) ?? [];
    current.push(membership.group_id);
    groupIdsByAgent.set(membership.agent_id, current);
  }

  return c.json({
    agents: (agentsResult.results ?? []).map((agent) => ({
      id: agent.id,
      name: agent.name,
      username: agent.username,
      status: agent.status,
      isEnabled: agent.is_enabled === 1,
      maxActiveConversations: agent.max_active_conversations,
      lastLoginAt: agent.last_login_at,
      lastSeenAt: agent.last_seen_at,
      hasPassword: Boolean(agent.password_hash && agent.password_salt),
      groupIds: groupIdsByAgent.get(agent.id) ?? [],
    })),
  });
});

adminConfigApi.post('/api/admin/agents', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const body = await readJson<{
    name?: string;
    username?: string;
    password?: string;
    groupIds?: string[];
    maxActiveConversations?: number;
    isEnabled?: boolean;
  }>(c.req.raw);

  const name = normalizeName(body?.name);
  const username = normalizeUsername(body?.username);
  const password = normalizePassword(body?.password);
  if (!name || !username || !password) {
    return c.json({ error: 'INVALID_AGENT' }, 400);
  }
  if (await usernameExists(c.env.DB, username)) {
    return c.json({ error: 'USERNAME_EXISTS' }, 409);
  }

  const groupIds = await validGroupIds(c.env.DB, body?.groupIds ?? []);
  const maxActive = normalizeCapacity(body?.maxActiveConversations);
  const credentials = await hashPassword(password);
  const id = crypto.randomUUID();
  const enabled = body?.isEnabled === false ? 0 : 1;

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, password_salt,
         status, is_enabled, max_active_conversations
       ) VALUES (?1, 'default', ?2, ?3, ?4, ?5, 'offline', ?6, ?7)`,
    ).bind(
      id,
      name,
      username,
      credentials.hash,
      credentials.salt,
      enabled,
      maxActive,
    ),
  ];
  for (const groupId of groupIds) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO group_agents (site_id, group_id, agent_id, is_enabled)
         VALUES ('default', ?1, ?2, 1)`,
      ).bind(groupId, id),
    );
  }
  await c.env.DB.batch(statements);
  return c.json({ ok: true, id }, 201);
});

adminConfigApi.patch('/api/admin/agents/:id', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const id = c.req.param('id');
  if (id === 'admin') return c.json({ error: 'NOT_FOUND' }, 404);

  const current = await c.env.DB.prepare(
    `SELECT id, name, username, status, is_enabled, max_active_conversations,
       last_login_at, last_seen_at, password_hash, password_salt
     FROM agents WHERE id = ?1 AND site_id = 'default'`,
  )
    .bind(id)
    .first<AgentRow>();
  if (!current) return c.json({ error: 'NOT_FOUND' }, 404);

  const body = await readJson<{
    name?: string;
    username?: string;
    password?: string;
    groupIds?: string[];
    maxActiveConversations?: number;
    isEnabled?: boolean;
  }>(c.req.raw);
  if (!body) return c.json({ error: 'INVALID_AGENT' }, 400);

  const name = body.name === undefined ? current.name : normalizeName(body.name);
  const username =
    body.username === undefined
      ? current.username
      : normalizeUsername(body.username);
  if (!name || !username) return c.json({ error: 'INVALID_AGENT' }, 400);
  if (await usernameExists(c.env.DB, username, id)) {
    return c.json({ error: 'USERNAME_EXISTS' }, 409);
  }

  let passwordHash = current.password_hash;
  let passwordSalt = current.password_salt;
  if (body.password !== undefined && body.password !== '') {
    const password = normalizePassword(body.password);
    if (!password) return c.json({ error: 'INVALID_PASSWORD' }, 400);
    const credentials = await hashPassword(password);
    passwordHash = credentials.hash;
    passwordSalt = credentials.salt;
  }
  if (!passwordHash || !passwordSalt) {
    return c.json({ error: 'PASSWORD_REQUIRED' }, 400);
  }

  const enabled =
    body.isEnabled === undefined ? current.is_enabled : body.isEnabled ? 1 : 0;
  const maxActive =
    body.maxActiveConversations === undefined
      ? current.max_active_conversations
      : normalizeCapacity(body.maxActiveConversations);
  const groupIds =
    body.groupIds === undefined
      ? await currentGroupIds(c.env.DB, id)
      : await validGroupIds(c.env.DB, body.groupIds);

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE agents
       SET name = ?1,
           username = ?2,
           password_hash = ?3,
           password_salt = ?4,
           is_enabled = ?5,
           max_active_conversations = ?6,
           status = CASE WHEN ?5 = 0 THEN 'offline' ELSE status END,
           last_seen_at = CASE WHEN ?5 = 0 THEN NULL ELSE last_seen_at END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?7 AND site_id = 'default'`,
    ).bind(
      name,
      username,
      passwordHash,
      passwordSalt,
      enabled,
      maxActive,
      id,
    ),
    c.env.DB.prepare(
      `DELETE FROM group_agents
       WHERE site_id = 'default' AND agent_id = ?1`,
    ).bind(id),
  ];
  for (const groupId of groupIds) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO group_agents (site_id, group_id, agent_id, is_enabled)
         VALUES ('default', ?1, ?2, 1)`,
      ).bind(groupId, id),
    );
  }
  if (enabled === 0) {
    statements.push(
      c.env.DB.prepare('DELETE FROM agent_sessions WHERE agent_id = ?1').bind(id),
    );
  }
  await c.env.DB.batch(statements);
  return c.json({ ok: true });
});

adminConfigApi.get('/api/admin/groups', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const [groupsResult, membershipsResult] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, name, is_enabled, routing_strategy
       FROM support_groups
       WHERE site_id = 'default'
       ORDER BY is_enabled DESC, name ASC, id ASC`,
    ).all<GroupRow>(),
    c.env.DB.prepare(
      `SELECT group_id, agent_id
       FROM group_agents
       WHERE site_id = 'default' AND is_enabled = 1`,
    ).all<{ group_id: string; agent_id: string }>(),
  ]);

  const agentIdsByGroup = new Map<string, string[]>();
  for (const membership of membershipsResult.results ?? []) {
    if (membership.agent_id === 'admin') continue;
    const current = agentIdsByGroup.get(membership.group_id) ?? [];
    current.push(membership.agent_id);
    agentIdsByGroup.set(membership.group_id, current);
  }

  return c.json({
    groups: (groupsResult.results ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      isEnabled: group.is_enabled === 1,
      routingStrategy: group.routing_strategy,
      agentIds: agentIdsByGroup.get(group.id) ?? [],
    })),
  });
});

adminConfigApi.post('/api/admin/groups', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const body = await readJson<{ name?: string }>(c.req.raw);
  const name = normalizeName(body?.name);
  if (!name) return c.json({ error: 'INVALID_GROUP' }, 400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO support_groups (site_id, id, name, is_enabled, routing_strategy)
     VALUES ('default', ?1, ?2, 1, 'least_active')`,
  )
    .bind(id, name)
    .run();
  return c.json({ ok: true, id }, 201);
});

adminConfigApi.patch('/api/admin/groups/:id', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const id = c.req.param('id');
  const current = await c.env.DB.prepare(
    `SELECT id, name, is_enabled, routing_strategy
     FROM support_groups WHERE site_id = 'default' AND id = ?1`,
  )
    .bind(id)
    .first<GroupRow>();
  if (!current) return c.json({ error: 'NOT_FOUND' }, 404);

  const body = await readJson<{ name?: string; isEnabled?: boolean }>(
    c.req.raw,
  );
  if (!body) return c.json({ error: 'INVALID_GROUP' }, 400);
  const name = body.name === undefined ? current.name : normalizeName(body.name);
  if (!name) return c.json({ error: 'INVALID_GROUP' }, 400);
  const enabled =
    body.isEnabled === undefined ? current.is_enabled : body.isEnabled ? 1 : 0;
  await c.env.DB.prepare(
    `UPDATE support_groups
     SET name = ?1, is_enabled = ?2, updated_at = CURRENT_TIMESTAMP
     WHERE site_id = 'default' AND id = ?3`,
  )
    .bind(name, enabled, id)
    .run();
  return c.json({ ok: true });
});

async function adminAuthorized(c: Context<Env>): Promise<boolean> {
  const password = c.env.ADMIN_PASSWORD;
  if (!password) return false;
  const header = c.req.header('Cookie') ?? '';
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

function unauthorized(c: Context<Env>) {
  return c.json({ error: 'UNAUTHORIZED' }, 401);
}

async function usernameExists(
  db: D1Database,
  username: string,
  excludingId?: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id FROM agents
       WHERE lower(username) = lower(?1)
         AND (?2 IS NULL OR id <> ?2)
       LIMIT 1`,
    )
    .bind(username, excludingId ?? null)
    .first<{ id: string }>();
  return Boolean(row);
}

async function currentGroupIds(db: D1Database, agentId: string): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT group_id FROM group_agents
       WHERE site_id = 'default' AND agent_id = ?1 AND is_enabled = 1
       ORDER BY group_id ASC`,
    )
    .bind(agentId)
    .all<{ group_id: string }>();
  return (result.results ?? []).map((item) => item.group_id);
}

async function validGroupIds(db: D1Database, values: string[]): Promise<string[]> {
  const requested = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (!requested.length) return [];
  const result = await db
    .prepare(
      `SELECT id FROM support_groups
       WHERE site_id = 'default' AND is_enabled = 1`,
    )
    .all<{ id: string }>();
  const allowed = new Set((result.results ?? []).map((item) => item.id));
  return requested.filter((id) => allowed.has(id));
}

function normalizeName(value?: string): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed && trimmed.length <= 80 ? trimmed : null;
}

function normalizeUsername(value?: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length < 2 || trimmed.length > 40 || /\s/u.test(trimmed)) return null;
  return trimmed;
}

function normalizePassword(value?: string | null): string | null {
  if (!value || value.length < 4 || value.length > 128) return null;
  return value;
}

function normalizeCapacity(value?: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(999, Math.trunc(value ?? 0)));
}

async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = toHex(saltBytes);
  return { hash: await derivePassword(password, saltBytes), salt };
}

async function derivePassword(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: PASSWORD_ITERATIONS,
    },
    key,
    256,
  );
  return toHex(new Uint8Array(bits));
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

async function hmac(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return toBase64Url(new Uint8Array(signature));
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

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
