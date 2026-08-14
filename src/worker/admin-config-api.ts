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

type GroupRow = {
  id: string;
  name: string;
  is_enabled: number;
  routing_strategy: string;
};

type RoutingRuleRow = {
  group_id: string;
  section_id: string;
  category_id: string;
  is_default: number;
  section_name: string | null;
  category_name: string | null;
};

type RoutingSelection = {
  sectionId: string;
  categoryId: string | null;
};

const SESSION_COOKIE = 'cs_session';

export const adminConfigApi = new Hono<Env>();

adminConfigApi.get('/api/admin/agents', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);

  const [agentsResult, membershipsResult] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, name, username, status, is_enabled, max_active_conversations,
         last_login_at, last_seen_at, password_hash, password_salt, password_iterations
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
  for (const groupId of groupIds) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO group_agents (site_id, group_id, agent_id, is_enabled)
         VALUES ('default', ?1, ?2, 1)`,
      ).bind(groupId, id),
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
    groupIds?: string[];
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
      c.env.DB.prepare('DELETE FROM agent_sessions WHERE agent_id = ?1').bind(
        id,
      ),
    );
  }
  await c.env.DB.batch(statements);
  return c.json({ ok: true });
});

adminConfigApi.get('/api/admin/groups', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const [groupsResult, membershipsResult, routingResult] = await Promise.all([
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
    c.env.DB.prepare(
      `SELECT r.group_id, r.section_id, r.category_id, r.is_default,
         s.name AS section_name, cat.name AS category_name
       FROM group_routing_rules r
       LEFT JOIN routing_catalog_sections s
         ON s.site_id = r.site_id AND s.id = r.section_id
       LEFT JOIN routing_catalog_categories cat
         ON cat.site_id = r.site_id AND cat.id = r.category_id
       WHERE r.site_id = 'default' AND r.is_enabled = 1
       ORDER BY r.is_default DESC, s.name ASC, cat.name ASC, r.id ASC`,
    ).all<RoutingRuleRow>(),
  ]);

  const agentIdsByGroup = new Map<string, string[]>();
  for (const membership of membershipsResult.results ?? []) {
    if (membership.agent_id === 'admin') continue;
    const current = agentIdsByGroup.get(membership.group_id) ?? [];
    current.push(membership.agent_id);
    agentIdsByGroup.set(membership.group_id, current);
  }

  const routingRulesByGroup = new Map<string, RoutingRuleRow[]>();
  for (const rule of routingResult.results ?? []) {
    const current = routingRulesByGroup.get(rule.group_id) ?? [];
    current.push(rule);
    routingRulesByGroup.set(rule.group_id, current);
  }

  return c.json({
    groups: (groupsResult.results ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      isEnabled: group.is_enabled === 1,
      routingStrategy: 'round_robin',
      agentIds: agentIdsByGroup.get(group.id) ?? [],
      routingRules: (routingRulesByGroup.get(group.id) ?? []).map((rule) => ({
        isDefault: rule.is_default === 1,
        sectionId: rule.section_id || null,
        sectionName: rule.section_name,
        categoryId: rule.category_id || null,
        categoryName: rule.category_name,
      })),
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
  const name =
    body.name === undefined ? current.name : normalizeName(body.name);
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

adminConfigApi.get('/api/admin/routing/catalog', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const [sectionsResult, categoriesResult] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, name
       FROM routing_catalog_sections
       WHERE site_id = 'default'
       ORDER BY name COLLATE NOCASE ASC, id ASC`,
    ).all<{ id: string; name: string }>(),
    c.env.DB.prepare(
      `SELECT id, section_id, name
       FROM routing_catalog_categories
       WHERE site_id = 'default'
       ORDER BY name COLLATE NOCASE ASC, id ASC`,
    ).all<{ id: string; section_id: string; name: string }>(),
  ]);

  const categoriesBySection = new Map<
    string,
    Array<{ id: string; name: string }>
  >();
  for (const category of categoriesResult.results ?? []) {
    const current = categoriesBySection.get(category.section_id) ?? [];
    current.push({ id: category.id, name: category.name });
    categoriesBySection.set(category.section_id, current);
  }

  return c.json({
    sections: (sectionsResult.results ?? []).map((section) => ({
      id: section.id,
      name: section.name,
      categories: categoriesBySection.get(section.id) ?? [],
    })),
  });
});

adminConfigApi.put('/api/admin/groups/:id/routing', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const groupId = c.req.param('id');
  const group = await c.env.DB.prepare(
    `SELECT id FROM support_groups
     WHERE site_id = 'default' AND id = ?1
     LIMIT 1`,
  )
    .bind(groupId)
    .first<{ id: string }>();
  if (!group) return c.json({ error: 'NOT_FOUND' }, 404);

  const body = await readJson<{
    isDefault?: boolean;
    routes?: Array<{ sectionId?: string; categoryId?: string | null }>;
  }>(c.req.raw);
  if (
    !body ||
    typeof body.isDefault !== 'boolean' ||
    !Array.isArray(body.routes)
  ) {
    return c.json({ error: 'INVALID_ROUTING_RULES' }, 400);
  }

  const routes = await normalizeRoutingSelections(c.env.DB, body.routes);
  if (!routes) return c.json({ error: 'INVALID_ROUTING_RULES' }, 400);

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `DELETE FROM group_routing_rules
       WHERE site_id = 'default' AND group_id = ?1`,
    ).bind(groupId),
  ];

  if (body.isDefault) {
    statements.push(
      c.env.DB.prepare(
        `DELETE FROM group_routing_rules
         WHERE site_id = 'default' AND is_default = 1`,
      ),
      c.env.DB.prepare(
        `INSERT INTO group_routing_rules (
           id, site_id, group_id, section_id, category_id, is_default, is_enabled
         ) VALUES (?1, 'default', ?2, '', '', 1, 1)`,
      ).bind(crypto.randomUUID(), groupId),
    );
  }

  for (const route of routes) {
    const categoryId = route.categoryId ?? '';
    statements.push(
      c.env.DB.prepare(
        `DELETE FROM group_routing_rules
         WHERE site_id = 'default'
           AND is_default = 0
           AND section_id = ?1
           AND category_id = ?2`,
      ).bind(route.sectionId, categoryId),
      c.env.DB.prepare(
        `INSERT INTO group_routing_rules (
           id, site_id, group_id, section_id, category_id, is_default, is_enabled
         ) VALUES (?1, 'default', ?2, ?3, ?4, 0, 1)`,
      ).bind(crypto.randomUUID(), groupId, route.sectionId, categoryId),
    );
  }

  await c.env.DB.batch(statements);
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

async function currentGroupIds(
  db: D1Database,
  agentId: string,
): Promise<string[]> {
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

async function validGroupIds(
  db: D1Database,
  values: string[],
): Promise<string[]> {
  const requested = [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ];
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

async function normalizeRoutingSelections(
  db: D1Database,
  values: Array<{ sectionId?: string; categoryId?: string | null }>,
): Promise<RoutingSelection[] | null> {
  if (values.length > 500) return null;
  const [sectionsResult, categoriesResult] = await Promise.all([
    db
      .prepare(
        `SELECT id FROM routing_catalog_sections WHERE site_id = 'default'`,
      )
      .all<{ id: string }>(),
    db
      .prepare(
        `SELECT id, section_id
         FROM routing_catalog_categories WHERE site_id = 'default'`,
      )
      .all<{ id: string; section_id: string }>(),
  ]);
  const sections = new Set(
    (sectionsResult.results ?? []).map((item) => item.id),
  );
  const categories = new Map(
    (categoriesResult.results ?? []).map((item) => [item.id, item.section_id]),
  );
  const unique = new Map<string, RoutingSelection>();

  for (const value of values) {
    const sectionId = normalizeText(value.sectionId, 100);
    const categoryId = value.categoryId
      ? normalizeText(value.categoryId, 100)
      : null;
    if (!sectionId || !sections.has(sectionId)) return null;
    if (categoryId && categories.get(categoryId) !== sectionId) return null;
    const key = `${sectionId}:${categoryId ?? ''}`;
    unique.set(key, { sectionId, categoryId });
  }
  return [...unique.values()];
}

function normalizeName(value?: string): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed && trimmed.length <= 80 ? trimmed : null;
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
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
