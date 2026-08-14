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

type RoutingCatalogCategory = {
  id: string;
  name: string;
};

type RoutingCatalogSection = {
  id: string;
  name: string;
  categories: RoutingCatalogCategory[];
};

type RoutingCatalogInput = {
  sections: RoutingCatalogSection[];
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
 *
 * Site may include its current section/category catalog. That catalog is only
 * control-plane metadata used by the customer-service admin when configuring
 * demand routing; conversation traffic still goes browser -> customer-service.
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

  const body = await readJson<{ routingCatalog?: unknown }>(c.req.raw);
  let catalogCounts = { sectionCount: 0, categoryCount: 0 };
  if (body?.routingCatalog !== undefined) {
    const catalog = normalizeRoutingCatalog(body.routingCatalog);
    if (!catalog) {
      return integrationError(
        c,
        400,
        'INVALID_ROUTING_CATALOG',
        'Routing catalog is invalid.',
      );
    }
    catalogCounts = await replaceRoutingCatalog(c.env.DB, site.id, catalog);
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
    routingCatalog: catalogCounts,
    groups: (groups.results ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      isEnabled: group.is_enabled === 1,
    })),
  });
});

function normalizeRoutingCatalog(value: unknown): RoutingCatalogInput | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.sections) ||
    value.sections.length > 200
  ) {
    return null;
  }

  const sections: RoutingCatalogSection[] = [];
  let categoryCount = 0;
  for (const rawSection of value.sections) {
    if (!isRecord(rawSection) || !Array.isArray(rawSection.categories))
      return null;
    const id = normalizeText(rawSection.id, 100);
    const name = normalizeText(rawSection.name, 120);
    if (!id || !name || rawSection.categories.length > 500) return null;

    const categories: RoutingCatalogCategory[] = [];
    for (const rawCategory of rawSection.categories) {
      if (!isRecord(rawCategory)) return null;
      const categoryId = normalizeText(rawCategory.id, 100);
      const categoryName = normalizeText(rawCategory.name, 120);
      if (!categoryId || !categoryName) return null;
      categories.push({ id: categoryId, name: categoryName });
      categoryCount += 1;
      if (categoryCount > 2000) return null;
    }
    sections.push({ id, name, categories });
  }
  return { sections };
}

async function replaceRoutingCatalog(
  db: D1Database,
  siteId: string,
  catalog: RoutingCatalogInput,
): Promise<{ sectionCount: number; categoryCount: number }> {
  const statements: D1PreparedStatement[] = [
    db
      .prepare('DELETE FROM routing_catalog_categories WHERE site_id = ?1')
      .bind(siteId),
    db
      .prepare('DELETE FROM routing_catalog_sections WHERE site_id = ?1')
      .bind(siteId),
  ];
  let categoryCount = 0;

  for (const section of catalog.sections) {
    statements.push(
      db
        .prepare(
          `INSERT INTO routing_catalog_sections (site_id, id, name, updated_at)
           VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)`,
        )
        .bind(siteId, section.id, section.name),
    );
    for (const category of section.categories) {
      statements.push(
        db
          .prepare(
            `INSERT INTO routing_catalog_categories (
               site_id, id, section_id, name, updated_at
             ) VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)`,
          )
          .bind(siteId, category.id, section.id, category.name),
      );
      categoryCount += 1;
    }
  }

  await db.batch(statements);
  return { sectionCount: catalog.sections.length, categoryCount };
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function integrationError(
  c: Context<IntegrationEnv>,
  status: 400 | 401 | 503,
  code: string,
  message: string,
) {
  return c.json({ error: { code, message } }, status);
}
