import { Hono, type Context } from 'hono';
import { hashAgentPassword } from './agent-password';
import { broadcastClientConversationEvent } from './client-api';
import { assignConversationAgent } from './routing';

type Bindings = {
  DB: D1Database;
  CONVERSATION_ROOMS: DurableObjectNamespace;
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
  daily_conversation_limit: number;
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

type ScopeType = 'section' | 'category' | 'product';

type ScopeRow = {
  agent_id: string;
  scope_type: ScopeType;
  section_id: string;
  category_id: string;
  product_id: string;
};

type AgentRoutingScope =
  | { type: 'none' }
  | { type: 'section'; sectionIds: string[] }
  | { type: 'category'; sectionId: string; categoryIds: string[] }
  | { type: 'product'; productIds: string[] };

const SESSION_COOKIE = 'cs_session';
const REPORTING_TIME_ZONE = 'America/Los_Angeles';

export const adminConfigApi = new Hono<Env>();

adminConfigApi.get('/api/admin/bootstrap', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const [agents, products] = await Promise.all([
    loadAgents(c.env.DB),
    loadProducts(c.env.DB),
  ]);
  return c.json({ agents, products });
});

adminConfigApi.get('/api/admin/agents', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  return c.json({ agents: await loadAgents(c.env.DB) });
});

adminConfigApi.get('/api/admin/agent-stats', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const month = normalizeMonth(c.req.query('month'));
  if (!month) return c.json({ error: 'INVALID_MONTH' }, 400);
  const retainedFrom = reportingRetentionCutoff();
  const result = await c.env.DB.prepare(
    `SELECT agent_id,
       CAST(substr(business_date, 9, 2) AS INTEGER) AS day,
       conversation_count AS count
     FROM agent_daily_stats
     WHERE site_id = 'default'
       AND business_date >= ?1
       AND business_date <= ?2
       AND business_date >= ?3
       AND CAST(substr(business_date, 9, 2) AS INTEGER) BETWEEN 1 AND 30
     ORDER BY agent_id ASC, business_date ASC`,
  )
    .bind(`${month}-01`, `${month}-30`, retainedFrom)
    .all<{ agent_id: string; day: number; count: number }>();
  return c.json({
    month,
    days: Array.from({ length: 30 }, (_, index) => index + 1),
    counts: (result.results ?? []).map((row) => ({
      agentId: row.agent_id,
      day: Number(row.day),
      count: Number(row.count),
    })),
    retainedFrom,
  });
});

adminConfigApi.post('/api/admin/agents', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const body = await readJson<{
    name?: string;
    username?: string;
    password?: string;
    productIds?: string[];
    routingScope?: unknown;
    maxActiveConversations?: number;
    dailyConversationLimit?: number;
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

  const routingScope = await normalizeRoutingScope(
    c.env.DB,
    body?.routingScope,
    body?.productIds ?? [],
  );
  if (!routingScope) {
    return c.json({ error: 'INVALID_ROUTING_SCOPE' }, 400);
  }

  const maxActive = normalizeCapacity(body?.maxActiveConversations);
  const dailyLimit = normalizeDailyLimit(body?.dailyConversationLimit);
  const credentials = await hashAgentPassword(password);
  const id = crypto.randomUUID();
  const enabled = body?.isEnabled === false ? 0 : 1;
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, password_salt,
         password_iterations, status, is_enabled, max_active_conversations,
         daily_conversation_limit
       ) VALUES (?1, 'default', ?2, ?3, ?4, ?5, ?6, 'offline', ?7, ?8, ?9)`,
    ).bind(
      id,
      name,
      username,
      credentials.hash,
      credentials.salt,
      credentials.iterations,
      enabled,
      maxActive,
      dailyLimit,
    ),
    ...routingScopeStatements(c.env.DB, id, routingScope),
  ];

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
       daily_conversation_limit, last_login_at, last_seen_at, password_hash,
       password_salt, password_iterations
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
    routingScope?: unknown;
    maxActiveConversations?: number;
    dailyConversationLimit?: number;
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
  const conversationsToReassign =
    current.is_enabled === 1 && enabled === 0
      ? await assignedActiveConversationIds(c.env.DB, id)
      : [];
  const maxActive =
    body.maxActiveConversations === undefined
      ? current.max_active_conversations
      : normalizeCapacity(body.maxActiveConversations);
  const dailyLimit =
    body.dailyConversationLimit === undefined
      ? current.daily_conversation_limit
      : normalizeDailyLimit(body.dailyConversationLimit);

  const routingScope =
    body.routingScope === undefined && body.productIds === undefined
      ? await currentRoutingScope(c.env.DB, id)
      : await normalizeRoutingScope(
          c.env.DB,
          body.routingScope,
          body.productIds ?? [],
        );
  if (!routingScope) {
    return c.json({ error: 'INVALID_ROUTING_SCOPE' }, 400);
  }

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
           daily_conversation_limit = ?8,
           status = CASE WHEN ?6 = 0 THEN 'offline' ELSE status END,
           last_seen_at = CASE WHEN ?6 = 0 THEN NULL ELSE last_seen_at END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?9 AND site_id = 'default'`,
    ).bind(
      name,
      username,
      passwordHash,
      passwordSalt,
      passwordIterations,
      enabled,
      maxActive,
      dailyLimit,
      id,
    ),
    c.env.DB.prepare(
      `DELETE FROM agent_routing_scopes
       WHERE site_id = 'default' AND agent_id = ?1`,
    ).bind(id),
    ...routingScopeStatements(c.env.DB, id, routingScope),
  ];
  if (enabled === 0) {
    statements.push(
      c.env.DB.prepare('DELETE FROM agent_sessions WHERE agent_id = ?1').bind(
        id,
      ),
      c.env.DB.prepare(
        `UPDATE conversations
           SET assigned_agent = NULL,
               assigned_at = NULL,
               assigned_business_date = NULL,
               status = 'open',
               updated_at = CURRENT_TIMESTAMP
           WHERE assigned_agent = ?1
             AND status IN ('open', 'pending')
             AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP`,
      ).bind(id),
    );
  }
  await c.env.DB.batch(statements);
  if (conversationsToReassign.length) {
    await disconnectAgentRealtime(c.env, id, conversationsToReassign);
    for (const conversationId of conversationsToReassign) {
      await assignConversationAgent(c.env.DB, conversationId);
      await broadcastClientConversationEvent(
        c.env,
        conversationId,
        'conversation.assigned',
      );
    }
  }
  return c.json({ ok: true });
});

adminConfigApi.get('/api/admin/products', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  return c.json({ products: await loadProducts(c.env.DB) });
});

async function loadAgents(db: D1Database) {
  const businessDate = reportingBusinessDate();
  const [agentsResult, assignmentsResult, todayResult] = await Promise.all([
    db
      .prepare(
        `SELECT id, name, username, status, is_enabled, max_active_conversations,
           daily_conversation_limit, last_login_at, last_seen_at, password_hash,
           password_salt, password_iterations
         FROM agents
         WHERE id <> 'admin'
         ORDER BY is_enabled DESC, name ASC, id ASC`,
      )
      .all<AgentRow>(),
    db
      .prepare(
        `SELECT agent_id, scope_type, section_id, category_id, product_id
         FROM agent_routing_scopes
         WHERE site_id = 'default'
           AND is_enabled = 1
         ORDER BY agent_id ASC, scope_type ASC, section_id ASC,
           category_id ASC, product_id ASC`,
      )
      .all<ScopeRow>(),
    db
      .prepare(
        `SELECT agent_id, conversation_count AS count
         FROM agent_daily_stats
         WHERE site_id = 'default'
           AND business_date = ?1`,
      )
      .bind(businessDate)
      .all<{ agent_id: string; count: number }>(),
  ]);

  const todayByAgent = new Map(
    (todayResult.results ?? []).map((row) => [row.agent_id, Number(row.count)]),
  );
  const rowsByAgent = new Map<string, ScopeRow[]>();
  for (const row of assignmentsResult.results ?? []) {
    const current = rowsByAgent.get(row.agent_id) ?? [];
    current.push(row);
    rowsByAgent.set(row.agent_id, current);
  }

  return (agentsResult.results ?? []).map((agent) => {
    const routingScope = scopeFromRows(rowsByAgent.get(agent.id) ?? []);
    return {
      id: agent.id,
      name: agent.name,
      username: agent.username,
      status: agent.status,
      isEnabled: agent.is_enabled === 1,
      maxActiveConversations: agent.max_active_conversations,
      dailyConversationLimit: agent.daily_conversation_limit,
      todayConversationCount: todayByAgent.get(agent.id) ?? 0,
      lastLoginAt: agent.last_login_at,
      lastSeenAt: agent.last_seen_at,
      hasPassword: Boolean(agent.password_hash && agent.password_salt),
      productIds:
        routingScope.type === 'product' ? routingScope.productIds : [],
      routingScope,
    };
  });
}

async function loadProducts(db: D1Database) {
  const result = await db
    .prepare(
      `SELECT id, title, href, cover_url, section_id, section_name,
         category_id, category_name, is_enabled
       FROM product_catalog
       WHERE site_id = 'default'
       ORDER BY is_enabled DESC,
         COALESCE(section_name, '') COLLATE NOCASE ASC,
         COALESCE(category_name, '') COLLATE NOCASE ASC,
         title COLLATE NOCASE ASC,
         id ASC`,
    )
    .all<ProductRow>();

  return (result.results ?? []).map((product) => ({
    id: product.id,
    title: product.title,
    href: product.href,
    coverUrl: product.cover_url,
    sectionId: product.section_id,
    sectionName: product.section_name,
    categoryId: product.category_id,
    categoryName: product.category_name,
    isEnabled: product.is_enabled === 1,
  }));
}

async function assignedActiveConversationIds(
  db: D1Database,
  agentId: string,
): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT id
       FROM conversations
       WHERE assigned_agent = ?1
         AND status IN ('open', 'pending')
         AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP
       ORDER BY last_message_at ASC, id ASC`,
    )
    .bind(agentId)
    .all<{ id: string }>();
  return (result.results ?? []).map((conversation) => conversation.id);
}

async function disconnectAgentRealtime(
  env: Bindings,
  agentId: string,
  conversationIds: string[],
): Promise<void> {
  const roomIds = [`agent-inbox:${agentId}`, ...conversationIds];
  await Promise.all(
    roomIds.map((roomId) =>
      env.CONVERSATION_ROOMS.get(
        env.CONVERSATION_ROOMS.idFromName(roomId),
      ).fetch('https://conversation-room/disconnect-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      }),
    ),
  );
}

async function currentRoutingScope(
  db: D1Database,
  agentId: string,
): Promise<AgentRoutingScope> {
  const result = await db
    .prepare(
      `SELECT agent_id, scope_type, section_id, category_id, product_id
       FROM agent_routing_scopes
       WHERE site_id = 'default'
         AND agent_id = ?1
         AND is_enabled = 1
       ORDER BY scope_type ASC, section_id ASC, category_id ASC, product_id ASC`,
    )
    .bind(agentId)
    .all<ScopeRow>();
  return scopeFromRows(result.results ?? []);
}

function scopeFromRows(rows: ScopeRow[]): AgentRoutingScope {
  if (!rows.length) return { type: 'none' };

  const sectionRows = rows.filter((row) => row.scope_type === 'section');
  if (sectionRows.length) {
    return {
      type: 'section',
      sectionIds: distinct(sectionRows.map((row) => row.section_id)),
    };
  }

  const categoryRows = rows.filter((row) => row.scope_type === 'category');
  if (categoryRows.length) {
    return {
      type: 'category',
      sectionId: categoryRows[0]?.section_id ?? '',
      categoryIds: distinct(categoryRows.map((row) => row.category_id)),
    };
  }

  return {
    type: 'product',
    productIds: distinct(
      rows
        .filter((row) => row.scope_type === 'product')
        .map((row) => row.product_id),
    ),
  };
}

async function normalizeRoutingScope(
  db: D1Database,
  raw: unknown,
  legacyProductIds: string[],
): Promise<AgentRoutingScope | null> {
  if (raw === undefined) {
    const productIds = normalizedIdentifiers(legacyProductIds);
    if (!productIds.length) return { type: 'none' };
    return (await allEnabledProductsExist(db, productIds))
      ? { type: 'product', productIds }
      : null;
  }
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;

  if (raw.type === 'none') return { type: 'none' };

  if (raw.type === 'section') {
    const legacySectionId = normalizeIdentifier(raw.sectionId);
    const sectionIds = normalizedIdentifiers([
      ...(Array.isArray(raw.sectionIds) ? raw.sectionIds : []),
      legacySectionId,
    ]);
    if (!sectionIds.length) return null;
    const result = await db
      .prepare(
        `SELECT DISTINCT section_id
         FROM product_catalog
         WHERE site_id = 'default'
           AND is_enabled = 1
           AND section_id IS NOT NULL
           AND section_id <> ''`,
      )
      .all<{ section_id: string }>();
    const allowed = new Set(
      (result.results ?? []).map((row) => row.section_id),
    );
    return sectionIds.every((id) => allowed.has(id))
      ? { type: 'section', sectionIds }
      : null;
  }

  if (raw.type === 'category') {
    const sectionId = normalizeIdentifier(raw.sectionId);
    if (!sectionId || !Array.isArray(raw.categoryIds)) return null;
    const categoryIds = normalizedIdentifiers(raw.categoryIds);
    if (!categoryIds.length) return null;
    const result = await db
      .prepare(
        `SELECT DISTINCT category_id
         FROM product_catalog
         WHERE site_id = 'default'
           AND is_enabled = 1
           AND section_id = ?1
           AND category_id IS NOT NULL
           AND category_id <> ''`,
      )
      .bind(sectionId)
      .all<{ category_id: string }>();
    const allowed = new Set(
      (result.results ?? []).map((row) => row.category_id),
    );
    return categoryIds.every((id) => allowed.has(id))
      ? { type: 'category', sectionId, categoryIds }
      : null;
  }

  if (raw.type === 'product') {
    if (!Array.isArray(raw.productIds)) return null;
    const productIds = normalizedIdentifiers(raw.productIds);
    if (!productIds.length) return { type: 'none' };
    return (await allEnabledProductsExist(db, productIds))
      ? { type: 'product', productIds }
      : null;
  }

  return null;
}

function routingScopeStatements(
  db: D1Database,
  agentId: string,
  scope: AgentRoutingScope,
): D1PreparedStatement[] {
  if (scope.type === 'none') return [];

  if (scope.type === 'section') {
    return scope.sectionIds.map((sectionId) =>
      db
        .prepare(
          `INSERT INTO agent_routing_scopes (
             site_id, agent_id, scope_type, section_id,
             category_id, product_id, is_enabled
           ) VALUES ('default', ?1, 'section', ?2, '', '', 1)`,
        )
        .bind(agentId, sectionId),
    );
  }

  if (scope.type === 'category') {
    return scope.categoryIds.map((categoryId) =>
      db
        .prepare(
          `INSERT INTO agent_routing_scopes (
             site_id, agent_id, scope_type, section_id,
             category_id, product_id, is_enabled
           ) VALUES ('default', ?1, 'category', ?2, ?3, '', 1)`,
        )
        .bind(agentId, scope.sectionId, categoryId),
    );
  }

  return scope.productIds.map((productId) =>
    db
      .prepare(
        `INSERT INTO agent_routing_scopes (
           site_id, agent_id, scope_type, section_id,
           category_id, product_id, is_enabled
         ) VALUES ('default', ?1, 'product', '', '', ?2, 1)`,
      )
      .bind(agentId, productId),
  );
}

async function allEnabledProductsExist(
  db: D1Database,
  productIds: string[],
): Promise<boolean> {
  if (!productIds.length) return true;
  const result = await db
    .prepare(
      `SELECT id
       FROM product_catalog
       WHERE site_id = 'default' AND is_enabled = 1`,
    )
    .all<{ id: string }>();
  const allowed = new Set((result.results ?? []).map((item) => item.id));
  return productIds.every((id) => allowed.has(id));
}

function normalizedIdentifiers(values: unknown[]): string[] {
  return distinct(
    values
      .map((value) => normalizeIdentifier(value))
      .filter((value): value is string => Boolean(value)),
  );
}

function normalizeIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 500 ? trimmed : null;
}

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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

function normalizeName(value?: string): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed && trimmed.length <= 80 ? trimmed : null;
}

function normalizeUsername(value?: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length < 2 || trimmed.length > 40 || /\s/u.test(trimmed)) {
    return null;
  }
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

function normalizeDailyLimit(value?: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(9999, Math.trunc(value ?? 0)));
}

function normalizeMonth(value?: string): string | null {
  const month = value?.trim() ?? '';
  return /^\d{4}-(0[1-9]|1[0-2])$/u.test(month) ? month : null;
}

function reportingBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORTING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function reportingRetentionCutoff(now = new Date()): string {
  const today = reportingBusinessDate(now);
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 44);
  return date.toISOString().slice(0, 10);
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
  for (let index = 0; index < a.length; index += 1) {
    diff |= a[index] ^ b[index];
  }
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
