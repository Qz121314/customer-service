import { Hono, type Context } from 'hono';
import { hashAgentPassword } from './agent-password';

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
  password_iterations: number;
};

type ProductRow = {
  id: string;
  title: string;
  href: string | null;
  cover_url: string | null;
  section_id: string | null;
  section_name: string | null;
  category_id: string | null;
  category_name: string | null;
  is_enabled: number;
};

const SESSION_COOKIE = 'cs_session';

export const adminConfigApi = new Hono<Env>();

adminConfigApi.get('/api/admin/agents', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);

  const [agentsResult, assignmentsResult] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, name, username, status, is_enabled, max_active_conversations,
         last_login_at, last_seen_at, password_hash, password_salt, password_iterations
       FROM agents
       WHERE id <> 'admin'
       ORDER BY is_enabled DESC, name ASC, id ASC`,
    ).all<AgentRow>(),
    c.env.DB.prepare(
      `SELECT ap.agent_id, ap.product_id
       FROM agent_products ap
       JOIN product_catalog p
         ON p.site_id = ap.site_id AND p.id = ap.product_id
       WHERE ap.site_id = 'default'
         AND ap.is_enabled = 1
         AND p.is_enabled = 1
       ORDER BY p.title COLLATE NOCASE ASC, ap.product_id ASC`,
    ).all<{ agent_id: string; product_id: string }>(),
  ]);

  const productIdsByAgent = new Map<string, string[]>();
  for (const assignment of assignmentsResult.results ?? []) {
    const current = productIdsByAgent.get(assignment.agent_id) ?? [];
    current.push(assignment.product_id);
    productIdsByAgent.set(assignment.agent_id, current);
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
      productIds: productIdsByAgent.get(agent.id) ?? [],
    })),
  });
});

adminConfigApi.post('/api/admin/agents', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const body = await readJson<{
    name?: string;
    username?: string;
    password?: string;
    productIds?: string[];
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

  const productIds = await validProductIds(c.env.DB, body?.productIds ?? []);
  const maxActive = normalizeCapacity(body?.maxActiveConversations);
  const credentials = await hashAgentPassword(password);
  const id = crypto.randomUUID();
  const enabled = body?.isEnabled === false ? 0 : 1;
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, password_salt,
         password_iterations, status, is_enabled, max_active_conversations
       ) VALUES (?1, 'default', ?2, ?3, ?4, ?5, ?6, 'offline', ?7, ?8)`,
    ).bind(
      id,
      name,
      username,
      credentials.hash,
      credentials.salt,
      credentials.iterations,
      enabled,
      maxActive,
    ),
  ];
  for (const productId of productIds) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO agent_products (site_id, agent_id, product_id, is_enabled)
         VALUES ('default', ?1, ?2, 1)`,
      ).bind(id, productId),
    );
  }
  try {
    await c.env.DB.batch(statements);
  } catch (error) {
    console.error('agent.create.failed', error);
    if (String(error).includes('idx_agents_username')) {
      return c.json({ error: 'USERNAME_EXISTS' }, 409);
    }
    return c.json({ error: 'AGENT_CREATE_FAILED' }, 500);
  }
  return c.json({ ok: true, id }, 201);
});

adminConfigApi.patch('/api/admin/agents/:id', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const id = c.req.param('id');
  if (id === 'admin') return c.json({ error: 'NOT_FOUND' }, 404);

  const current = await c.env.DB.prepare(
    `SELECT id, name, username, status, is_enabled, max_active_conversations,
       last_login_at, last_seen_at, password_hash, password_salt, password_iterations
     FROM agents WHERE id = ?1 AND site_id = 'default'`,
  )
    .bind(id)
    .first<AgentRow>();
  if (!current) return c.json({ error: 'NOT_FOUND' }, 404);

  const body = await readJson<{
    name?: string;
    username?: string;
    password?: string;
    productIds?: string[];
    maxActiveConversations?: number;
    isEnabled?: boolean;
  }>(c.req.raw);
  if (!body) return c.json({ error: 'INVALID_AGENT' }, 400);

  const name =
    body.name === undefined ? current.name : normalizeName(body.name);
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
  let passwordIterations = current.password_iterations;
  if (body.password !== undefined && body.password !== '') {
    const password = normalizePassword(body.password);
    if (!password) return c.json({ error: 'INVALID_PASSWORD' }, 400);
    const credentials = await hashAgentPassword(password);
    passwordHash = credentials.hash;
    passwordSalt = credentials.salt;
    passwordIterations = credentials.iterations;
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
  const productIds =
    body.productIds === undefined
      ? await currentProductIds(c.env.DB, id)
      : await validProductIds(c.env.DB, body.productIds);

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE agents
       SET name = ?1,
           username = ?2,
           password_hash = ?3,
           password_salt = ?4,
           password_iterations = ?5,
           is_enabled = ?6,
           max_active_conversations = ?7,
           status = CASE WHEN ?6 = 0 THEN 'offline' ELSE status END,
           last_seen_at = CASE WHEN ?6 = 0 THEN NULL ELSE last_seen_at END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?8 AND site_id = 'default'`,
    ).bind(
      name,
      username,
      passwordHash,
      passwordSalt,
      passwordIterations,
      enabled,
      maxActive,
      id,
    ),
    c.env.DB.prepare(
      `DELETE FROM agent_products
       WHERE site_id = 'default' AND agent_id = ?1`,
    ).bind(id),
  ];
  for (const productId of productIds) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO agent_products (site_id, agent_id, product_id, is_enabled)
         VALUES ('default', ?1, ?2, 1)`,
      ).bind(id, productId),
    );
  }
  if (enabled === 0) {
    statements.push(
      c.env.DB.prepare('DELETE FROM agent_sessions WHERE agent_id = ?1').bind(
        id,
      ),
    );
  }
  await c.env.DB.batch(statements);
  return c.json({ ok: true });
});

adminConfigApi.get('/api/admin/products', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const result = await c.env.DB.prepare(
    `SELECT id, title, href, cover_url, section_id, section_name,
       category_id, category_name, is_enabled
     FROM product_catalog
     WHERE site_id = 'default'
     ORDER BY is_enabled DESC,
       COALESCE(section_name, '') COLLATE NOCASE ASC,
       COALESCE(category_name, '') COLLATE NOCASE ASC,
       title COLLATE NOCASE ASC,
       id ASC`,
  ).all<ProductRow>();

  return c.json({
    products: (result.results ?? []).map((product) => ({
      id: product.id,
      title: product.title,
      href: product.href,
      coverUrl: product.cover_url,
      sectionId: product.section_id,
      sectionName: product.section_name,
      categoryId: product.category_id,
      categoryName: product.category_name,
      isEnabled: product.is_enabled === 1,
    })),
  });
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

async function currentProductIds(
  db: D1Database,
  agentId: string,
): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT ap.product_id
       FROM agent_products ap
       JOIN product_catalog p
         ON p.site_id = ap.site_id AND p.id = ap.product_id
       WHERE ap.site_id = 'default'
         AND ap.agent_id = ?1
         AND ap.is_enabled = 1
         AND p.is_enabled = 1
       ORDER BY p.title COLLATE NOCASE ASC, ap.product_id ASC`,
    )
    .bind(agentId)
    .all<{ product_id: string }>();
  return (result.results ?? []).map((item) => item.product_id);
}

async function validProductIds(
  db: D1Database,
  values: string[],
): Promise<string[]> {
  const requested = [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ];
  if (!requested.length) return [];
  const result = await db
    .prepare(
      `SELECT id FROM product_catalog
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
  if (trimmed.length < 2 || trimmed.length > 40 || /\s/u.test(trimmed))
    return null;
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
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(value),
  );
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
