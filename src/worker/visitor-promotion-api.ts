import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { verifyAdminSession } from './admin-session';

type Bindings = {
  DB: D1Database;
  ADMIN_PASSWORD?: string;
};

type Env = { Bindings: Bindings };

type PromotionRow = {
  site_id: string;
  id: string;
  is_enabled: number;
  title: string;
  summary: string;
  cover_url: string | null;
  body_markdown: string;
  cta_label: string | null;
  cta_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
};

type PublicPromotionLookupRow = {
  site_id: string;
  promotion_id: string | null;
  title: string | null;
  summary: string | null;
  cover_url: string | null;
  body_markdown: string | null;
  cta_label: string | null;
  cta_url: string | null;
  updated_at: string | null;
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

type NormalizedPromotion = {
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

export const visitorPromotionApi = new Hono<Env>();

visitorPromotionApi.use(
  '/client/v1/promotion',
  cors({
    origin: '*',
    allowMethods: ['GET', 'OPTIONS'],
    maxAge: 86400,
  }),
);

visitorPromotionApi.get('/api/admin/visitor-promotion', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const promotion = await loadPromotion(c.env.DB, 'default');
  return c.json({
    promotion: promotion ? serializeAdminPromotion(promotion) : null,
  });
});

visitorPromotionApi.put('/api/admin/visitor-promotion', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const normalized = normalizePromotionInput(
    await readJson<PromotionInput>(c.req.raw),
  );
  if (!normalized.ok) return c.json({ error: normalized.error }, 400);

  const existing = await loadPromotion(c.env.DB, 'default');
  const id = existing?.id ?? crypto.randomUUID();
  const updatedAt = nextUpdatedAt(existing?.updated_at ?? null);
  const value = normalized.value;

  await c.env.DB.prepare(
    `INSERT INTO visitor_promotions (
       site_id, id, is_enabled, title, summary, cover_url, body_markdown,
       cta_label, cta_url, starts_at, ends_at, updated_at
     ) VALUES ('default', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
     ON CONFLICT(site_id) DO UPDATE SET
       is_enabled = excluded.is_enabled,
       title = excluded.title,
       summary = excluded.summary,
       cover_url = excluded.cover_url,
       body_markdown = excluded.body_markdown,
       cta_label = excluded.cta_label,
       cta_url = excluded.cta_url,
       starts_at = excluded.starts_at,
       ends_at = excluded.ends_at,
       updated_at = excluded.updated_at`,
  )
    .bind(
      id,
      value.isEnabled ? 1 : 0,
      value.title,
      value.summary,
      value.coverUrl,
      value.bodyMarkdown,
      value.ctaLabel,
      value.ctaUrl,
      value.startsAt,
      value.endsAt,
      updatedAt,
    )
    .run();

  return c.json({
    promotion: {
      id,
      ...value,
      createdAt: existing?.created_at ?? updatedAt,
      updatedAt,
    },
  });
});

visitorPromotionApi.get('/client/v1/promotion', async (c) => {
  const projectId = normalizeProjectId(c.req.query('projectId'));
  const row = await c.env.DB.prepare(
    `SELECT
       s.id AS site_id,
       p.id AS promotion_id,
       p.title,
       p.summary,
       p.cover_url,
       p.body_markdown,
       p.cta_label,
       p.cta_url,
       p.updated_at
     FROM sites s
     LEFT JOIN visitor_promotions p
       ON p.site_id = s.id
      AND p.is_enabled = 1
      AND (p.starts_at IS NULL OR datetime(p.starts_at) <= CURRENT_TIMESTAMP)
      AND (p.ends_at IS NULL OR datetime(p.ends_at) > CURRENT_TIMESTAMP)
     WHERE (s.id = ?1 OR s.public_key = ?1)
       AND s.is_enabled = 1
     LIMIT 1`,
  )
    .bind(projectId)
    .first<PublicPromotionLookupRow>();

  if (!row) {
    return c.json(
      { error: 'PROJECT_NOT_FOUND', message: 'Project was not found.' },
      404,
    );
  }
  if (!row.promotion_id) return c.json({ promotion: null });

  return c.json({
    promotion: {
      id: row.promotion_id,
      title: row.title,
      summary: row.summary,
      coverUrl: row.cover_url,
      bodyMarkdown: row.body_markdown,
      ctaLabel: row.cta_label,
      ctaUrl: row.cta_url,
      updatedAt: row.updated_at,
    },
  });
});

async function adminAuthorized(c: Context<Env>): Promise<boolean> {
  const password = c.env.ADMIN_PASSWORD;
  return Boolean(
    password && (await verifyAdminSession(c.req.raw, password)),
  );
}

function unauthorized(c: Context<Env>) {
  return c.json({ error: 'UNAUTHORIZED' }, 401);
}

async function loadPromotion(
  db: D1Database,
  siteId: string,
): Promise<PromotionRow | null> {
  return db
    .prepare(
      `SELECT site_id, id, is_enabled, title, summary, cover_url,
              body_markdown, cta_label, cta_url, starts_at, ends_at,
              created_at, updated_at
       FROM visitor_promotions
       WHERE site_id = ?1
       LIMIT 1`,
    )
    .bind(siteId)
    .first<PromotionRow>();
}

function serializeAdminPromotion(row: PromotionRow) {
  return {
    id: row.id,
    isEnabled: row.is_enabled === 1,
    title: row.title,
    summary: row.summary,
    coverUrl: row.cover_url,
    bodyMarkdown: row.body_markdown,
    ctaLabel: row.cta_label,
    ctaUrl: row.cta_url,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizePromotionInput(body: PromotionInput | null):
  | { ok: true; value: NormalizedPromotion }
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
  if (coverUrl === undefined) {
    return { ok: false, error: 'INVALID_PROMOTION_URL' };
  }

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

function requiredText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function optionalText(
  value: unknown,
  maxLength: number,
): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.length <= maxLength ? normalized : undefined;
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
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? undefined : timestamp.toISOString();
}

function normalizeProjectId(value: unknown): string {
  return typeof value === 'string' && value.trim() && value.trim().length <= 200
    ? value.trim()
    : 'default';
}

function nextUpdatedAt(previous: string | null, now = new Date()): string {
  if (!previous) return now.toISOString();
  const previousTime = new Date(previous).getTime();
  if (!Number.isFinite(previousTime) || now.getTime() > previousTime) {
    return now.toISOString();
  }
  return new Date(previousTime + 1).toISOString();
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
