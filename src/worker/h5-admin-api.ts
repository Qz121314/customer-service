import { Hono } from 'hono';
import { verifyAdminSession } from './admin-session.ts';
import {
  h5ContentStatus,
  h5PageAssetKey,
  H5_HTML_MAX_BYTES,
  type H5PageContentRow,
  validateH5Html,
} from './h5-page-content.ts';
import {
  buildH5PublicUrl,
  normalizeExternalUrl,
  normalizeH5Slug,
  normalizeH5Text,
  normalizePublicOrigin,
} from './h5-public-url.ts';

type Bindings = {
  DB: D1Database;
  H5_PAGES: R2Bucket;
  ADMIN_PASSWORD?: string;
};

type Env = { Bindings: Bindings };

type H5PoolRow = {
  site_id: string;
  id: string;
  name: string;
  is_enabled: number;
  action_type: 'chat' | 'external';
  cta_label: string;
  external_url: string | null;
  used_by: number;
  created_at: string;
  updated_at: string;
};

type H5PageRow = {
  site_id: string;
  id: string;
  title: string;
  slug: string;
  conversion_pool_id: string | null;
  is_enabled: number;
  section_id: string;
  section_name: string;
  category_id: string | null;
  category_name: string | null;
  created_at: string;
  updated_at: string;
  public_origin: string | null;
  pool_name: string | null;
  pool_is_enabled: number | null;
  draft_asset_id: string | null;
  draft_byte_size: number | null;
  draft_uploaded_at: string | null;
  published_asset_id: string | null;
  published_byte_size: number | null;
  published_at: string | null;
};

type H5Page = {
  id: string;
  title: string;
  slug: string;
  conversionPoolId: string | null;
  conversionPoolName: string | null;
  conversionPoolEnabled: boolean | null;
  isEnabled: boolean;
  sectionId: string;
  sectionName: string;
  categoryId: string | null;
  categoryName: string | null;
  publicUrl: string | null;
  contentStatus: 'unuploaded' | 'pending' | 'published' | 'updated';
  draftByteSize: number | null;
  draftUploadedAt: string | null;
  publishedByteSize: number | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type H5SettingsRow = {
  public_origin: string | null;
  chat_public_origin: string | null;
};

type H5Pool = {
  id: string;
  name: string;
  isEnabled: boolean;
  actionType: 'chat' | 'external';
  ctaLabel: string;
  externalUrl: string | null;
  usedBy: number;
  createdAt: string;
  updatedAt: string;
};

const SITE_ID = 'default';
const SECTION_ID = 'h5:section:pages';
const SECTION_NAME = 'H5 页面';

export const h5AdminApi = new Hono<Env>();

h5AdminApi.get('/api/admin/h5/pages', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  return c.json({ pages: await loadPages(c.env.DB) });
});

h5AdminApi.post('/api/admin/h5/pages', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const body = await readJson<{
    title?: unknown;
    slug?: unknown;
    conversionPoolId?: unknown;
    isEnabled?: unknown;
  }>(c.req.raw);
  const title = normalizeH5Text(body?.title);
  const slug = normalizeH5Slug(body?.slug);
  if (!title || !slug) return c.json({ error: 'INVALID_H5_PAGE' }, 400);
  const poolId = await validatePoolSelection(c.env.DB, body?.conversionPoolId);
  if (poolId === 'INVALID') {
    return c.json({ error: 'INVALID_CONVERSION_POOL' }, 400);
  }
  const id = `h5:product:${crypto.randomUUID()}`;
  try {
    await c.env.DB.prepare(
      `INSERT INTO h5_product_catalog (
         site_id, id, title, section_id, section_name, slug,
         conversion_pool_id, is_enabled
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
      .bind(
        SITE_ID,
        id,
        title,
        SECTION_ID,
        SECTION_NAME,
        slug,
        poolId,
        body?.isEnabled === false ? 0 : 1,
      )
      .run();
  } catch (error) {
    if (isUniqueConstraint(error)) return c.json({ error: 'SLUG_EXISTS' }, 409);
    console.error('h5.page.create.failed', error);
    return c.json({ error: 'H5_PAGE_CREATE_FAILED' }, 500);
  }
  return c.json({ page: await loadPage(c.env.DB, id) }, 201);
});

h5AdminApi.post('/api/admin/h5/pages/:id/duplicate', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const source = await loadPageRow(c.env.DB, c.req.param('id'));
  if (!source) return c.json({ error: 'NOT_FOUND' }, 404);
  const slug = await duplicateSlug(c.env.DB, source.slug);
  const id = `h5:product:${crypto.randomUUID()}`;
  const conversionPoolId =
    source.conversion_pool_id && source.pool_is_enabled === 1
      ? source.conversion_pool_id
      : null;
  try {
    await c.env.DB.prepare(
      `INSERT INTO h5_product_catalog (
         site_id, id, title, section_id, section_name, category_id,
         category_name, slug, conversion_pool_id, is_enabled
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0)`,
    )
      .bind(
        SITE_ID,
        id,
        `${source.title} 副本`,
        SECTION_ID,
        SECTION_NAME,
        source.category_id,
        source.category_name,
        slug,
        conversionPoolId,
      )
      .run();
  } catch (error) {
    if (isUniqueConstraint(error)) return c.json({ error: 'SLUG_EXISTS' }, 409);
    console.error('h5.page.duplicate.failed', error);
    return c.json({ error: 'H5_PAGE_CREATE_FAILED' }, 500);
  }
  return c.json({ page: await loadPage(c.env.DB, id) }, 201);
});

h5AdminApi.put('/api/admin/h5/pages/:id/html', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const id = c.req.param('id');
  const page = await loadPageRow(c.env.DB, id);
  if (!page) return c.json({ error: 'NOT_FOUND' }, 404);
  const contentLength = Number(c.req.header('content-length'));
  if (Number.isFinite(contentLength) && contentLength > H5_HTML_MAX_BYTES) {
    return c.json({ error: 'H5_HTML_TOO_LARGE' }, 413);
  }
  const bytes = new Uint8Array(await c.req.raw.arrayBuffer());
  const validated = validateH5Html(c.req.header('content-type') ?? null, bytes);
  if (!validated.ok) {
    return c.json(
      { error: validated.code },
      validated.code === 'H5_HTML_TOO_LARGE' ? 413 : 400,
    );
  }

  const current = await loadPageContent(c.env.DB, id);
  const assetId = crypto.randomUUID();
  const key = h5PageAssetKey(SITE_ID, id, assetId);
  try {
    await c.env.H5_PAGES.put(key, validated.bytes, {
      httpMetadata: {
        contentType: 'text/html; charset=utf-8',
        cacheControl: 'no-store',
      },
      customMetadata: { owner: 'h5-page-html', siteId: SITE_ID, pageId: id },
    });
  } catch (error) {
    console.error('h5.page.html.upload.failed', error);
    return c.json({ error: 'H5_HTML_UPLOAD_FAILED' }, 500);
  }

  try {
    await c.env.DB.prepare(
      `INSERT INTO h5_page_content (
         site_id, page_id, draft_asset_id, draft_byte_size, draft_uploaded_at
       ) VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)
       ON CONFLICT(site_id, page_id) DO UPDATE SET
         draft_asset_id = excluded.draft_asset_id,
         draft_byte_size = excluded.draft_byte_size,
         draft_uploaded_at = excluded.draft_uploaded_at`,
    )
      .bind(SITE_ID, id, assetId, validated.bytes.byteLength)
      .run();
  } catch (error) {
    await deleteH5Object(c.env.H5_PAGES, key);
    console.error('h5.page.html.persist.failed', error);
    return c.json({ error: 'H5_HTML_PERSIST_FAILED' }, 500);
  }
  if (
    current?.draft_asset_id &&
    current.draft_asset_id !== current.published_asset_id
  ) {
    await deleteH5Object(
      c.env.H5_PAGES,
      h5PageAssetKey(SITE_ID, id, current.draft_asset_id),
    );
  }
  return c.json({ page: await loadPage(c.env.DB, id) });
});

h5AdminApi.post('/api/admin/h5/pages/:id/publish', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const id = c.req.param('id');
  const page = await loadPageRow(c.env.DB, id);
  if (!page) return c.json({ error: 'NOT_FOUND' }, 404);
  const content = await loadPageContent(c.env.DB, id);
  if (!content?.draft_asset_id) return c.json({ error: 'H5_NO_DRAFT' }, 400);
  const draftKey = h5PageAssetKey(SITE_ID, id, content.draft_asset_id);
  if (!(await c.env.H5_PAGES.head(draftKey))) {
    return c.json({ error: 'H5_DRAFT_NOT_FOUND' }, 409);
  }
  await c.env.DB.prepare(
    `UPDATE h5_page_content
     SET published_asset_id = ?1, published_byte_size = ?2,
         published_at = CURRENT_TIMESTAMP
     WHERE site_id = ?3 AND page_id = ?4`,
  )
    .bind(content.draft_asset_id, content.draft_byte_size, SITE_ID, id)
    .run();

  const oldKeys = new Set<string>();
  if (
    content.published_asset_id &&
    content.published_asset_id !== content.draft_asset_id
  ) {
    oldKeys.add(h5PageAssetKey(SITE_ID, id, content.published_asset_id));
  }
  await Promise.all(
    [...oldKeys].map((oldKey) => deleteH5Object(c.env.H5_PAGES, oldKey)),
  );
  return c.json({ page: await loadPage(c.env.DB, id) });
});

h5AdminApi.patch('/api/admin/h5/pages/:id', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const id = c.req.param('id');
  const current = await loadPageRow(c.env.DB, id);
  if (!current) return c.json({ error: 'NOT_FOUND' }, 404);
  const body = await readJson<{
    title?: unknown;
    slug?: unknown;
    conversionPoolId?: unknown;
    isEnabled?: unknown;
  }>(c.req.raw);
  const title =
    body && Object.hasOwn(body, 'title')
      ? normalizeH5Text(body.title)
      : current.title;
  const slug =
    body && Object.hasOwn(body, 'slug')
      ? normalizeH5Slug(body.slug)
      : current.slug;
  if (!title || !slug) return c.json({ error: 'INVALID_H5_PAGE' }, 400);
  const hasPoolChange = Object.hasOwn(body ?? {}, 'conversionPoolId');
  const requestedPoolId = body?.conversionPoolId;
  const poolId = hasPoolChange
    ? requestedPoolId === current.conversion_pool_id
      ? current.conversion_pool_id
      : await validatePoolSelection(c.env.DB, requestedPoolId)
    : current.conversion_pool_id;
  if (poolId === 'INVALID') {
    return c.json({ error: 'INVALID_CONVERSION_POOL' }, 400);
  }
  const isEnabled =
    body && Object.hasOwn(body, 'isEnabled')
      ? body.isEnabled === true
        ? 1
        : 0
      : current.is_enabled;
  try {
    await c.env.DB.prepare(
      `UPDATE h5_product_catalog
       SET title = ?1, slug = ?2, conversion_pool_id = ?3,
           is_enabled = ?4, updated_at = CURRENT_TIMESTAMP
       WHERE site_id = ?5 AND id = ?6`,
    )
      .bind(title, slug, poolId, isEnabled, SITE_ID, id)
      .run();
  } catch (error) {
    if (isUniqueConstraint(error)) return c.json({ error: 'SLUG_EXISTS' }, 409);
    console.error('h5.page.update.failed', error);
    return c.json({ error: 'H5_PAGE_UPDATE_FAILED' }, 500);
  }
  return c.json({ page: await loadPage(c.env.DB, id) });
});

h5AdminApi.delete('/api/admin/h5/pages/:id', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const id = c.req.param('id');
  const current = await loadPageRow(c.env.DB, id);
  if (!current) return c.json({ error: 'NOT_FOUND' }, 404);
  const references = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM agent_routing_scopes
     WHERE site_id = ?1 AND scope_type = 'product' AND product_id = ?2`,
  )
    .bind(SITE_ID, id)
    .first<{ count: number }>();
  if (Number(references?.count ?? 0) > 0) {
    return c.json(
      {
        error: 'H5_PAGE_ROUTING_SCOPE_IN_USE',
        count: Number(references?.count ?? 0),
      },
      409,
    );
  }
  const content = await loadPageContent(c.env.DB, id);
  await c.env.DB.prepare(
    'DELETE FROM h5_product_catalog WHERE site_id = ?1 AND id = ?2',
  )
    .bind(SITE_ID, id)
    .run();
  const assets = new Set<string>();
  if (content?.draft_asset_id) assets.add(content.draft_asset_id);
  if (content?.published_asset_id) assets.add(content.published_asset_id);
  await Promise.all(
    [...assets].map((assetId) =>
      deleteH5Object(c.env.H5_PAGES, h5PageAssetKey(SITE_ID, id, assetId)),
    ),
  );
  return c.json({ ok: true });
});

h5AdminApi.get('/api/admin/h5/conversion-pools', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  return c.json({ pools: await loadPools(c.env.DB) });
});

h5AdminApi.post('/api/admin/h5/conversion-pools', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const body = await readJson<PoolInput>(c.req.raw);
  const input = normalizePoolInput(body);
  if ('error' in input) return c.json({ error: input.error }, 400);
  const id = `h5:pool:${crypto.randomUUID()}`;
  try {
    await c.env.DB.prepare(
      `INSERT INTO h5_conversion_pools (
         site_id, id, name, is_enabled, action_type, cta_label, external_url
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
      .bind(
        SITE_ID,
        id,
        input.name,
        input.isEnabled ? 1 : 0,
        input.actionType,
        input.ctaLabel,
        input.externalUrl,
      )
      .run();
  } catch (error) {
    console.error('h5.pool.create.failed', error);
    return c.json({ error: 'CONVERSION_POOL_CREATE_FAILED' }, 500);
  }
  return c.json({ pool: await loadPool(c.env.DB, id) }, 201);
});

h5AdminApi.patch('/api/admin/h5/conversion-pools/:id', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const id = c.req.param('id');
  const current = await loadPoolRow(c.env.DB, id);
  if (!current) return c.json({ error: 'NOT_FOUND' }, 404);
  const body = await readJson<PoolInput>(c.req.raw);
  const input = normalizePoolInput({
    name: body?.name ?? current.name,
    actionType: body?.actionType ?? current.action_type,
    ctaLabel: body?.ctaLabel ?? current.cta_label,
    externalUrl:
      body && Object.hasOwn(body, 'externalUrl')
        ? body.externalUrl
        : current.external_url,
    isEnabled:
      body && Object.hasOwn(body, 'isEnabled')
        ? body.isEnabled
        : current.is_enabled === 1,
  });
  if ('error' in input) return c.json({ error: input.error }, 400);
  try {
    await c.env.DB.prepare(
      `UPDATE h5_conversion_pools
       SET name = ?1, is_enabled = ?2, action_type = ?3,
           cta_label = ?4, external_url = ?5, updated_at = CURRENT_TIMESTAMP
       WHERE site_id = ?6 AND id = ?7`,
    )
      .bind(
        input.name,
        input.isEnabled ? 1 : 0,
        input.actionType,
        input.ctaLabel,
        input.externalUrl,
        SITE_ID,
        id,
      )
      .run();
  } catch (error) {
    console.error('h5.pool.update.failed', error);
    return c.json({ error: 'CONVERSION_POOL_UPDATE_FAILED' }, 500);
  }
  return c.json({ pool: await loadPool(c.env.DB, id) });
});

h5AdminApi.delete('/api/admin/h5/conversion-pools/:id', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const id = c.req.param('id');
  const current = await loadPoolRow(c.env.DB, id);
  if (!current) return c.json({ error: 'NOT_FOUND' }, 404);
  const references = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM h5_product_catalog
     WHERE site_id = ?1 AND conversion_pool_id = ?2`,
  )
    .bind(SITE_ID, id)
    .first<{ count: number }>();
  const count = Number(references?.count ?? 0);
  if (count > 0) {
    return c.json({ error: 'CONVERSION_POOL_IN_USE', count }, 409);
  }
  await c.env.DB.prepare(
    'DELETE FROM h5_conversion_pools WHERE site_id = ?1 AND id = ?2',
  )
    .bind(SITE_ID, id)
    .run();
  return c.json({ ok: true });
});

h5AdminApi.get('/api/admin/h5/settings', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const row = await loadSettings(c.env.DB);
  return c.json({
    settings: {
      publicOrigin: row?.public_origin ?? null,
      chatPublicOrigin: row?.chat_public_origin ?? null,
    },
  });
});

h5AdminApi.put('/api/admin/h5/settings', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const body = await readJson<{
    publicOrigin?: unknown;
    chatPublicOrigin?: unknown;
  }>(c.req.raw);
  const publicOrigin = normalizePublicOrigin(body?.publicOrigin);
  const chatPublicOrigin = normalizePublicOrigin(body?.chatPublicOrigin);
  if (!publicOrigin) return c.json({ error: 'INVALID_PUBLIC_ORIGIN' }, 400);
  await c.env.DB.prepare(
    `INSERT INTO h5_settings (site_id, public_origin, chat_public_origin)
     VALUES (?1, ?2, ?3)
     ON CONFLICT(site_id) DO UPDATE SET
       public_origin = excluded.public_origin,
       chat_public_origin = excluded.chat_public_origin,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(SITE_ID, publicOrigin, chatPublicOrigin)
    .run();
  return c.json({ settings: { publicOrigin, chatPublicOrigin } });
});

async function loadPages(db: D1Database): Promise<H5Page[]> {
  const result = await db
    .prepare(pageSelect(''))
    .bind(SITE_ID)
    .all<H5PageRow>();
  return (result.results ?? []).map(toPage);
}

async function loadPage(db: D1Database, id: string): Promise<H5Page | null> {
  const row = await loadPageRow(db, id);
  return row ? toPage(row) : null;
}

async function loadPageContent(
  db: D1Database,
  pageId: string,
): Promise<H5PageContentRow | null> {
  return db
    .prepare(
      `SELECT site_id, page_id, draft_asset_id, draft_byte_size,
         draft_uploaded_at, published_asset_id, published_byte_size, published_at
       FROM h5_page_content
       WHERE site_id = ?1 AND page_id = ?2`,
    )
    .bind(SITE_ID, pageId)
    .first<H5PageContentRow>();
}

async function loadPageRow(
  db: D1Database,
  id: string,
): Promise<H5PageRow | null> {
  return db
    .prepare(`${pageSelect('AND p.id = ?2')} LIMIT 1`)
    .bind(SITE_ID, id)
    .first<H5PageRow>();
}

function pageSelect(extra: string): string {
  return `SELECT p.site_id, p.id, p.title, p.slug, p.conversion_pool_id,
     p.is_enabled, p.section_id, p.section_name, p.category_id,
     p.category_name, p.created_at, p.updated_at,
     settings.public_origin,
     pool.name AS pool_name, pool.is_enabled AS pool_is_enabled,
     content.draft_asset_id, content.draft_byte_size,
     content.draft_uploaded_at, content.published_asset_id,
     content.published_byte_size, content.published_at
   FROM h5_product_catalog p
   LEFT JOIN h5_conversion_pools pool
     ON pool.site_id = p.site_id AND pool.id = p.conversion_pool_id
   LEFT JOIN h5_settings settings ON settings.site_id = p.site_id
   LEFT JOIN h5_page_content content
     ON content.site_id = p.site_id AND content.page_id = p.id
   WHERE p.site_id = ?1 ${extra}
   ORDER BY p.is_enabled DESC, p.title COLLATE NOCASE ASC, p.id ASC`;
}

function toPage(row: H5PageRow): H5Page {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    conversionPoolId: row.conversion_pool_id,
    conversionPoolName: row.pool_name,
    conversionPoolEnabled:
      row.pool_is_enabled === null ? null : row.pool_is_enabled === 1,
    isEnabled: row.is_enabled === 1,
    sectionId: row.section_id,
    sectionName: row.section_name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    publicUrl: buildH5PublicUrl(row.public_origin, row.slug),
    contentStatus: h5ContentStatus(row),
    draftByteSize: row.draft_byte_size,
    draftUploadedAt: row.draft_uploaded_at,
    publishedByteSize: row.published_byte_size,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadPools(db: D1Database): Promise<H5Pool[]> {
  const result = await db
    .prepare(
      `SELECT pool.site_id, pool.id, pool.name, pool.is_enabled,
         pool.action_type, pool.cta_label, pool.external_url,
         COUNT(page.id) AS used_by, pool.created_at, pool.updated_at
       FROM h5_conversion_pools pool
       LEFT JOIN h5_product_catalog page
         ON page.site_id = pool.site_id
        AND page.conversion_pool_id = pool.id
       WHERE pool.site_id = ?1
       GROUP BY pool.site_id, pool.id, pool.name, pool.is_enabled,
         pool.action_type, pool.cta_label, pool.external_url,
         pool.created_at, pool.updated_at
       ORDER BY pool.is_enabled DESC, pool.name COLLATE NOCASE ASC, pool.id ASC`,
    )
    .bind(SITE_ID)
    .all<H5PoolRow>();
  return (result.results ?? []).map(toPool);
}

async function loadPool(db: D1Database, id: string): Promise<H5Pool | null> {
  const row = await loadPoolRow(db, id);
  return row ? toPool(row) : null;
}

async function loadPoolRow(
  db: D1Database,
  id: string,
): Promise<H5PoolRow | null> {
  return db
    .prepare(
      `SELECT pool.site_id, pool.id, pool.name, pool.is_enabled,
         pool.action_type, pool.cta_label, pool.external_url,
         COUNT(page.id) AS used_by, pool.created_at, pool.updated_at
       FROM h5_conversion_pools pool
       LEFT JOIN h5_product_catalog page
         ON page.site_id = pool.site_id
        AND page.conversion_pool_id = pool.id
       WHERE pool.site_id = ?1 AND pool.id = ?2
       GROUP BY pool.site_id, pool.id, pool.name, pool.is_enabled,
         pool.action_type, pool.cta_label, pool.external_url,
         pool.created_at, pool.updated_at
       LIMIT 1`,
    )
    .bind(SITE_ID, id)
    .first<H5PoolRow>();
}

function toPool(row: H5PoolRow): H5Pool {
  return {
    id: row.id,
    name: row.name,
    isEnabled: row.is_enabled === 1,
    actionType: row.action_type,
    ctaLabel: row.cta_label,
    externalUrl: row.external_url,
    usedBy: Number(row.used_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadSettings(db: D1Database) {
  return db
    .prepare(
      `SELECT public_origin, chat_public_origin, updated_at
       FROM h5_settings WHERE site_id = ?1`,
    )
    .bind(SITE_ID)
    .first<H5SettingsRow & { updated_at: string }>();
}

type PoolInput = {
  name?: unknown;
  actionType?: unknown;
  ctaLabel?: unknown;
  externalUrl?: unknown;
  isEnabled?: unknown;
};

function normalizePoolInput(body: PoolInput | null):
  | {
      name: string;
      actionType: 'chat' | 'external';
      ctaLabel: string;
      externalUrl: string | null;
      isEnabled: boolean;
    }
  | { error: string } {
  const name = normalizeH5Text(body?.name, 100);
  const ctaLabel = normalizeH5Text(body?.ctaLabel, 80);
  const actionType = body?.actionType;
  if (!name || !ctaLabel) return { error: 'INVALID_CONVERSION_POOL' };
  if (actionType !== 'chat' && actionType !== 'external') {
    return { error: 'INVALID_ACTION_TYPE' };
  }
  if (actionType === 'chat') {
    if (
      body &&
      Object.hasOwn(body, 'externalUrl') &&
      body.externalUrl !== null &&
      String(body.externalUrl).trim() !== ''
    ) {
      return { error: 'CHAT_EXTERNAL_URL_FORBIDDEN' };
    }
    return {
      name,
      actionType,
      ctaLabel,
      externalUrl: null,
      isEnabled: body?.isEnabled !== false,
    };
  }
  const externalUrl = normalizeExternalUrl(body?.externalUrl);
  if (!externalUrl) return { error: 'EXTERNAL_URL_REQUIRED' };
  return {
    name,
    actionType,
    ctaLabel,
    externalUrl,
    isEnabled: body?.isEnabled !== false,
  };
}

async function validatePoolSelection(
  db: D1Database,
  value: unknown,
): Promise<string | null | 'INVALID'> {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !value.startsWith('h5:pool:'))
    return 'INVALID';
  const row = await db
    .prepare(
      `SELECT id FROM h5_conversion_pools
       WHERE site_id = ?1 AND id = ?2 AND is_enabled = 1`,
    )
    .bind(SITE_ID, value)
    .first<{ id: string }>();
  return row ? row.id : 'INVALID';
}

async function deleteH5Object(bucket: R2Bucket, key: string): Promise<void> {
  try {
    await bucket.delete(key);
  } catch (error) {
    console.warn('h5.page.html.cleanup.failed', { key, error });
  }
}

async function duplicateSlug(
  db: D1Database,
  original: string,
): Promise<string> {
  const base = `${original}-copy`;
  const result = await db
    .prepare(
      `SELECT slug FROM h5_product_catalog
       WHERE site_id = ?1 AND (slug = ?2 OR slug LIKE ?3)`,
    )
    .bind(SITE_ID, base, `${base}-%`)
    .all<{ slug: string }>();
  const used = new Set((result.results ?? []).map((row) => row.slug));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

async function adminAuthorized(c: {
  req: { raw: Request };
  env: Env['Bindings'];
}) {
  return Boolean(
    c.env.ADMIN_PASSWORD &&
    (await verifyAdminSession(c.req.raw, c.env.ADMIN_PASSWORD)),
  );
}

function unauthorized(c: { json: (value: unknown, status: 401) => Response }) {
  return c.json({ error: 'UNAUTHORIZED' }, 401);
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function isUniqueConstraint(error: unknown): boolean {
  return String(error).toLowerCase().includes('unique');
}
