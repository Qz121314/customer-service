import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';

type IntegrationBindings = {
  DB: D1Database;
  INTEGRATION_VERIFY_TOKEN?: string;
};

type IntegrationEnv = { Bindings: IntegrationBindings };

type ProductCatalogItem = {
  id: string;
  title: string;
  href: string | null;
  coverUrl: string | null;
  sectionId: string | null;
  sectionName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  isEnabled: boolean;
};

type ProductCatalogInput = {
  products: ProductCatalogItem[];
};

const PRODUCT_SYNC_CHUNK_SIZE = 250;

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
 * Control-plane verification used by Site admin. Site may include the current
 * product catalog so this customer-service admin can assign products to agents.
 * The catalog is never used as a proxy for visitor conversation traffic.
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

  const body = await readJson<{ productCatalog?: unknown }>(c.req.raw);
  let productCount = 0;
  if (body?.productCatalog !== undefined) {
    const catalog = normalizeProductCatalog(body.productCatalog);
    if (!catalog) {
      return integrationError(
        c,
        400,
        'INVALID_PRODUCT_CATALOG',
        'Product catalog is invalid.',
      );
    }
    productCount = await syncProductCatalog(c.env.DB, site.id, catalog);
  }

  const requestUrl = new URL(c.req.url);
  const origin = requestUrl.origin;
  const realtimeUrl = new URL('/client/v1/realtime', origin);
  realtimeUrl.protocol = realtimeUrl.protocol === 'https:' ? 'wss:' : 'ws:';

  return c.json({
    ok: true,
    protocolVersion: 'v1',
    clientApiUrl: new URL('/client/v1', origin).toString().replace(/\/$/u, ''),
    realtimeUrl: realtimeUrl.toString(),
    productCatalog: { productCount },
  });
});

function normalizeProductCatalog(value: unknown): ProductCatalogInput | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.products) ||
    value.products.length > 5000
  ) {
    return null;
  }

  const products: ProductCatalogItem[] = [];
  const seen = new Set<string>();
  for (const rawProduct of value.products) {
    if (!isRecord(rawProduct)) return null;
    const id = normalizeText(rawProduct.id, 100);
    const title = normalizeText(rawProduct.title, 300);
    if (!id || !title || seen.has(id)) return null;
    seen.add(id);

    const href = normalizeNullableText(rawProduct.href, 1000);
    const coverUrl = normalizeNullableText(rawProduct.coverUrl, 2000);
    const sectionId = normalizeNullableText(rawProduct.sectionId, 100);
    const sectionName = normalizeNullableText(rawProduct.sectionName, 120);
    const categoryId = normalizeNullableText(rawProduct.categoryId, 100);
    const categoryName = normalizeNullableText(rawProduct.categoryName, 120);
    if (
      href === undefined ||
      coverUrl === undefined ||
      sectionId === undefined ||
      sectionName === undefined ||
      categoryId === undefined ||
      categoryName === undefined
    ) {
      return null;
    }

    products.push({
      id,
      title,
      href,
      coverUrl,
      sectionId,
      sectionName,
      categoryId,
      categoryName,
      isEnabled: rawProduct.isEnabled !== false,
    });
  }
  return { products };
}

/**
 * Synchronize the catalog with a bounded number of D1 queries.
 *
 * D1 exposes SQLite JSON functions, so each chunk is expanded inside SQLite
 * instead of generating one prepared statement per product. At the protocol
 * maximum of 5,000 products this is 20 upserts plus one disable pass, keeping
 * the operation below the Workers Free per-invocation D1 query ceiling.
 */
export async function syncProductCatalog(
  db: D1Database,
  siteId: string,
  catalog: ProductCatalogInput,
): Promise<number> {
  const statements: D1PreparedStatement[] = [];

  for (
    let offset = 0;
    offset < catalog.products.length;
    offset += PRODUCT_SYNC_CHUNK_SIZE
  ) {
    const chunk = catalog.products.slice(
      offset,
      offset + PRODUCT_SYNC_CHUNK_SIZE,
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO product_catalog (
             site_id, id, title, href, cover_url,
             section_id, section_name, category_id, category_name,
             is_enabled, updated_at
           )
           SELECT
             ?1,
             json_extract(value, '$.id'),
             json_extract(value, '$.title'),
             json_extract(value, '$.href'),
             json_extract(value, '$.coverUrl'),
             json_extract(value, '$.sectionId'),
             json_extract(value, '$.sectionName'),
             json_extract(value, '$.categoryId'),
             json_extract(value, '$.categoryName'),
             CASE WHEN json_extract(value, '$.isEnabled') THEN 1 ELSE 0 END,
             CURRENT_TIMESTAMP
           FROM json_each(?2)
           WHERE json_type(value) = 'object'
           ON CONFLICT(site_id, id) DO UPDATE SET
             title = excluded.title,
             href = excluded.href,
             cover_url = excluded.cover_url,
             section_id = excluded.section_id,
             section_name = excluded.section_name,
             category_id = excluded.category_id,
             category_name = excluded.category_name,
             is_enabled = excluded.is_enabled,
             updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(siteId, JSON.stringify(chunk)),
    );
  }

  const activeIds = catalog.products.map((product) => product.id);
  statements.push(
    db
      .prepare(
        `UPDATE product_catalog
         SET is_enabled = 0, updated_at = CURRENT_TIMESTAMP
         WHERE site_id = ?1
           AND id NOT IN (
             SELECT CAST(value AS TEXT)
             FROM json_each(?2)
           )`,
      )
      .bind(siteId, JSON.stringify(activeIds)),
  );

  await db.batch(statements);
  return catalog.products.length;
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

function normalizeNullableText(
  value: unknown,
  maxLength: number,
): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : undefined;
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
