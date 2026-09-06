import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { resolveVisitor } from './client-api';

type Bindings = { DB: D1Database; ADMIN_PASSWORD?: string };
type Env = { Bindings: Bindings };
type PromotionRow = {
  site_id: string;
  id: string;
  revision: number;
  is_enabled: number;
  title: string;
  summary: string;
  cover_url: string | null;
  body_markdown: string;
  cta_label: string | null;
  cta_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  updated_at: string;
};
type PromotionInput = {
  isEnabled?: unknown;
  title?: unknown;
  summary?: unknown;
  coverUrl?: unknown;
  bodyMarkdown?: unknown;
  ctaLabel?: unknown;
  ctaUrl?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
};

const SESSION_COOKIE = 'cs_session';
export const visitorPromotionApi = new Hono<Env>();

visitorPromotionApi.use(
  '/client/v1/promotion*',
  cors({
    origin: '*',
    allowHeaders: ['Content-Type', 'X-CS-Visitor-Token'],
    allowMethods: ['GET', 'PUT', 'OPTIONS'],
    maxAge: 86400,
  }),
);

visitorPromotionApi.get('/api/admin/visitor-promotion', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const promotion = await loadPromotion(c.env.DB, 'default');
  return c.json({ promotion: promotion ? serializePromotion(promotion, false) : null });
});

visitorPromotionApi.put('/api/admin/visitor-promotion', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const normalized = normalizePromotionInput(
    await readJson<PromotionInput>(c.req.raw),
  );
  if (!normalized.ok) return c.json({ error: normalized.error }, 400);

  const existing = await loadPromotion(c.env.DB, 'default');
  const id = existing?.id ?? crypto.randomUUID();
  const revision = (existing?.revision ?? 0) + 1;
  const value = normalized.value;

  if (existing) {
    await c.env.DB.prepare(
      `UPDATE visitor_promotions
       SET revision = ?1, is_enabled = ?2, title = ?3, summary = ?4,
           cover_url = ?5, body_markdown = ?6, cta_label = ?7, cta_url = ?8,
           starts_at = ?9, ends_at = ?10, updated_at = CURRENT_TIMESTAMP
       WHERE site_id = 'default' AND id = ?11`,
    )
      .bind(
        revision,
        value.isEnabled ? 1 : 0,
        value.title,
        value.summary,
        value.coverUrl,
        value.bodyMarkdown,
        value.ctaLabel,
        value.ctaUrl,
        value.startsAt,
        value.endsAt,
        id,
      )
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO visitor_promotions (
         site_id, id, revision, is_enabled, title, summary, cover_url,
         body_markdown, cta_label, cta_url, starts_at, ends_at
       ) VALUES ('default', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
      .bind(
        id,
        revision,
        value.isEnabled ? 1 : 0,
        value.title,
        value.summary,
        value.coverUrl,
        value.bodyMarkdown,
        value.ctaLabel,
        value.ctaUrl,
        value.startsAt,
        value.endsAt,
      )
      .run();
  }

  const promotion = await loadPromotion(c.env.DB, 'default');
  return c.json({ promotion: promotion ? serializePromotion(promotion, false) : null });
});

visitorPromotionApi.get('/client/v1/promotion', async (c) => {
  const site = await findSite(
    c.env.DB,
    normalizeProjectId(c.req.query('projectId')),
  );
  if (!site)
    return clientError(c, 404, 'PROJECT_NOT_FOUND', 'Project was not found.');

  const visitorId = normalizeVisitorId(c.req.query('visitorId'));
  const visitorToken = normalizeVisitorToken(
    c.req.query('visitorToken') ?? c.req.header('X-CS-Visitor-Token'),
  );
  if (!visitorId && !visitorToken) {
    return clientError(c, 400, 'INVALID_VISITOR_ID', 'Visitor ID is invalid.');
  }

  const promotion = await loadActivePromotion(c.env.DB, site.id);
  if (!promotion) return c.json({ promotion: null });

  const visitor = await resolveVisitor(c.env.DB, site.id, {
    externalId: visitorId,
    accessToken: visitorToken,
  });
  if (!visitor && visitorToken) {
    return clientError(
      c,
      401,
      'INVALID_VISITOR_TOKEN',
      'Visitor access token is invalid.',
    );
  }

  const viewed = visitor
    ? Boolean(
        await c.env.DB.prepare(
          `SELECT 1 AS viewed
           FROM visitor_promotion_views
           WHERE site_id = ?1 AND promotion_id = ?2
             AND revision = ?3 AND visitor_id = ?4
           LIMIT 1`,
        )
          .bind(site.id, promotion.id, promotion.revision, visitor.id)
          .first<{ viewed: number }>(),
      )
    : false;

  return c.json({ promotion: serializePromotion(promotion, !viewed) });
});

visitorPromotionApi.put('/client/v1/promotion/:id/view', async (c) => {
  const id = normalizeIdentifier(c.req.param('id'));
  const body = await readJson<{
    revision?: unknown;
    visitorId?: unknown;
    visitorToken?: unknown;
    projectId?: unknown;
  }>(c.req.raw);
  const revision = normalizeRevision(body?.revision);
  const visitorId = normalizeVisitorId(body?.visitorId);
  const visitorToken = normalizeVisitorToken(
    body?.visitorToken ?? c.req.header('X-CS-Visitor-Token'),
  );
  if (!id || !revision || !visitorId) {
    return clientError(
      c,
      400,
      'INVALID_PROMOTION_VIEW',
      'Promotion view is invalid.',
    );
  }

  const site = await findSite(c.env.DB, normalizeProjectId(body?.projectId));
  if (!site)
    return clientError(c, 404, 'PROJECT_NOT_FOUND', 'Project was not found.');
  const promotion = await loadActivePromotion(c.env.DB, site.id);
  if (!promotion || promotion.id !== id) {
    return clientError(c, 404, 'PROMOTION_NOT_FOUND', 'Promotion was not found.');
  }
  if (promotion.revision !== revision) {
    return clientError(
      c,
      409,
      'PROMOTION_REVISION_CHANGED',
      'Promotion content has changed.',
    );
  }

  let visitor = await resolveVisitor(c.env.DB, site.id, {
    externalId: visitorId,
    accessToken: visitorToken,
  });
  if (!visitor && visitorToken) {
    return clientError(
      c,
      401,
      'INVALID_VISITOR_TOKEN',
      'Visitor access token is invalid.',
    );
  }
  if (!visitor) visitor = await createPromotionVisitor(c.env.DB, site.id, visitorId);

  await c.env.DB.prepare(
    `INSERT INTO visitor_promotion_views (
       site_id, promotion_id, revision, visitor_id, viewed_at
     ) VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)
     ON CONFLICT(site_id, promotion_id, revision, visitor_id) DO NOTHING`,
  )
    .bind(site.id, promotion.id, promotion.revision, visitor.id)
    .run();

  return c.json({
    ok: true,
    promotionId: promotion.id,
    revision: promotion.revision,
  });
});

async function loadPromotion(
  db: D1Database,
  siteId: string,
): Promise<PromotionRow | null> {
  return db
    .prepare(
      `SELECT site_id, id, revision, is_enabled, title, summary, cover_url,
              body_markdown, cta_label, cta_url, starts_at, ends_at, updated_at
       FROM visitor_promotions WHERE site_id = ?1 LIMIT 1`,
    )
    .bind(siteId)
    .first<PromotionRow>();
}

async function loadActivePromotion(
  db: D1Database,
  siteId: string,
): Promise<PromotionRow | null> {
  return db
    .prepare(
      `SELECT site_id, id, revision, is_enabled, title, summary, cover_url,
              body_markdown, cta_label, cta_url, starts_at, ends_at, updated_at
       FROM visitor_promotions
       WHERE site_id = ?1 AND is_enabled = 1
         AND (starts_at IS NULL OR datetime(starts_at) <= CURRENT_TIMESTAMP)
         AND (ends_at IS NULL OR datetime(ends_at) > CURRENT_TIMESTAMP)
       LIMIT 1`,
    )
    .bind(siteId)
    .first<PromotionRow>();
}

function serializePromotion(row: PromotionRow, isNew: boolean) {
  return {
    id: row.id,
    revision: Number(row.revision),
    isEnabled: Boolean(row.is_enabled),
    title: row.title,
    summary: row.summary,
    coverUrl: row.cover_url,
    bodyMarkdown: row.body_markdown,
    ctaLabel: row.cta_label,
    ctaUrl: row.cta_url,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    isNew,
    updatedAt: row.updated_at,
  };
}

function normalizePromotionInput(body: PromotionInput | null):
  | {
      ok: true;
      value: {
        isEnabled: boolean;
        title: string;
        summary: string;
        coverUrl: string | null;
        bodyMarkdown: string;
        ctaLabel: string | null;
        ctaUrl: string | null;
        startsAt: string | null;
        endsAt: string | null;
      };
    }
  | { ok: false; error: string } {
  if (!body || typeof body.isEnabled !== 'boolean') {
    return { ok: false, error: 'INVALID_PROMOTION' };
  }
  const title = requiredText(body.title, 160);
  const summary = requiredText(body.summary, 320);
  const bodyMarkdown = requiredText(body.bodyMarkdown, 100_000);
  if (!title || !summary || !bodyMarkdown) {
    return { ok: false, error: 'INVALID_PROMOTION' };
  }
  const coverUrl = optionalHttpUrl(body.coverUrl);
  if (coverUrl === undefined)
    return { ok: false, error: 'INVALID_PROMOTION_URL' };
  const ctaLabel = optionalText(body.ctaLabel, 80);
  const ctaUrl = optionalHttpUrl(body.ctaUrl);
  if (
    ctaLabel === undefined ||
    ctaUrl === undefined ||
    Boolean(ctaLabel) !== Boolean(ctaUrl)
  ) {
    return { ok: false, error: 'INVALID_PROMOTION_CTA' };
  }
  const startsAt = optionalTimestamp(body.startsAt);
  const endsAt = optionalTimestamp(body.endsAt);
  if (startsAt === undefined || endsAt === undefined) {
    return { ok: false, error: 'INVALID_PROMOTION_TIME' };
  }
  if (
    startsAt &&
    endsAt &&
    new Date(startsAt).getTime() >= new Date(endsAt).getTime()
  ) {
    return { ok: false, error: 'INVALID_PROMOTION_TIME' };
  }
  return {
    ok: true,
    value: {
      isEnabled: body.isEnabled,
      title,
      summary,
      coverUrl,
      bodyMarkdown,
      ctaLabel,
      ctaUrl,
      startsAt,
      endsAt,
    },
  };
}

function requiredText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.length <= max ? normalized : undefined;
}

function optionalHttpUrl(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function optionalTimestamp(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function normalizeRevision(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function normalizeIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 160 ? normalized : null;
}

function normalizeVisitorId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9]{6}$/u.test(normalized) ? normalized : null;
}

function normalizeVisitorToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length >= 32 && normalized.length <= 200 ? normalized : null;
}

function normalizeProjectId(value: unknown): string {
  return typeof value === 'string' &&
    value.trim() &&
    value.trim().length <= 200
    ? value.trim()
    : 'default';
}

async function findSite(
  db: D1Database,
  projectId: string,
): Promise<{ id: string } | null> {
  return db
    .prepare(
      `SELECT id FROM sites
       WHERE (id = ?1 OR public_key = ?1) AND is_enabled = 1 LIMIT 1`,
    )
    .bind(projectId)
    .first<{ id: string }>();
}

async function createPromotionVisitor(
  db: D1Database,
  siteId: string,
  externalId: string,
) {
  const id = crypto.randomUUID();
  const tokenHash = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO visitors (
         id, site_id, token_hash, access_token_hash, display_name, external_id, expires_at
       ) VALUES (?1, ?2, ?3, NULL, ?4, ?4, ?5)
       ON CONFLICT(site_id, external_id) DO NOTHING`,
    )
    .bind(id, siteId, tokenHash, externalId, expiresAt)
    .run();
  const visitor = await resolveVisitor(db, siteId, {
    externalId,
    accessToken: null,
  });
  if (!visitor) throw new Error('PROMOTION_VISITOR_CREATE_FAILED');
  return visitor;
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
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

function clientError(
  c: Context<Env>,
  status: 400 | 401 | 404 | 409,
  code: string,
  message: string,
) {
  return c.json({ error: { code, message } }, status);
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

function timingSafeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
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
    .replace(/=+$/u, '');
}
