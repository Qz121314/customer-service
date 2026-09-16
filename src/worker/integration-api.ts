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
  /** Canonical public product-detail URL supplied by Site. */
  href: string;
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

integrationApi.get('/integration/v1/phone-collection/summary', async (c) => {
  const authError = integrationAuthError(c);
  if (authError) return authError;

  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM visitor_phone_numbers`,
  ).first<{ count: number | string }>();
  c.header('Cache-Control', 'no-store');
  return c.json({ count: Number(row?.count ?? 0) });
});

integrationApi.get('/integration/v1/phone-collection/export', async (c) => {
  const authError = integrationAuthError(c);
  if (authError) return authError;

  const result = await c.env.DB.prepare(
    `SELECT number, first_collected_at
     FROM visitor_phone_numbers
     ORDER BY first_collected_at ASC, number ASC`,
  ).all<{ number: string; first_collected_at: string }>();
  const rows = result.results ?? [];
  const csv = [
    '时间,号码',
    ...rows.map(
      (row) => `${escapeCsv(row.first_collected_at)},${escapeCsv(row.number)}`,
    ),
  ].join('\r\n');
  await c.env.DB.prepare(
    `INSERT INTO visitor_phone_download_logs
       (id, downloaded_at, row_count)
     VALUES (?1, ?2, ?3)`,
  )
    .bind(crypto.randomUUID(), new Date().toISOString(), rows.length)
    .run();

  return new Response(`\uFEFF${csv}\r\n`, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="visitor-phone-numbers.csv"',
    },
  });
});

integrationApi.get(
  '/integration/v1/phone-collection/download-logs',
  async (c) => {
    const authError = integrationAuthError(c);
    if (authError) return authError;

    const requestedLimit = Number(c.req.query('limit') ?? 20);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), 100)
      : 20;
    const result = await c.env.DB.prepare(
      `SELECT downloaded_at, row_count
     FROM visitor_phone_download_logs
     ORDER BY downloaded_at DESC, id DESC
     LIMIT ?1`,
    )
      .bind(limit)
      .all<{ downloaded_at: string; row_count: number }>();
    c.header('Cache-Control', 'no-store');
    return c.json({
      logs: (result.results ?? []).map((row) => ({
        downloadedAt: row.downloaded_at,
        rowCount: Number(row.row_count),
      })),
    });
  },
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

    const href = normalizePublicProductHref(rawProduct.href);
    const coverUrl = normalizeNullableText(rawProduct.coverUrl, 2000);
    const sectionId = normalizeNullableText(rawProduct.sectionId, 100);
    const sectionName = normalizeNullableText(rawProduct.sectionName, 120);
    const categoryId = normalizeNullableText(rawProduct.categoryId, 100);
    const categoryName = normalizeNullableText(rawProduct.categoryName, 120);
    if (
      !href ||
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

function normalizePublicProductHref(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000)
    return null;
  try {
    const url = new URL(value);
    const localHttp =
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    if (
      (url.protocol !== 'https:' && !localHttp) ||
      url.username ||
      url.password
    ) {
      return null;
    }
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
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

function integrationAuthError(c: Context<IntegrationEnv>) {
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
  return null;
}

function escapeCsv(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;
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
