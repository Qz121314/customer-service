import { Hono } from 'hono';
import { h5PageAssetKey } from './h5-page-content.ts';
import { normalizeH5Slug } from './h5-public-url.ts';

type Bindings = {
  DB: D1Database;
  MEDIA: R2Bucket;
};

type Env = { Bindings: Bindings };

export const h5PublicApp = new Hono<Env>();

h5PublicApp.get('/api/health', (c) =>
  c.json({ ok: true, service: 'customer-service-h5' }),
);

h5PublicApp.all('*', async (c) => {
  const url = new URL(c.req.url);
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    return new Response('Not Found', { status: 404 });
  }

  const parts = url.pathname.split('/');
  const hasTrailingSlash = url.pathname.endsWith('/');
  if (parts.length === 2 && !hasTrailingSlash && parts[1]) {
    const slug = normalizeH5Slug(decodePathPart(parts[1]));
    if (!slug) return new Response('Not Found', { status: 404 });
    return Response.redirect(`${url.origin}/${slug}/`, 308);
  }
  if (parts.length !== 3 || !hasTrailingSlash || !parts[1] || parts[2]) {
    return new Response('Not Found', { status: 404 });
  }

  const slug = normalizeH5Slug(decodePathPart(parts[1]));
  if (!slug) return new Response('Not Found', { status: 404 });
  const row = await c.env.DB.prepare(
    `SELECT p.id, c.published_asset_id
     FROM h5_product_catalog p
     JOIN h5_page_content c
       ON c.site_id = p.site_id AND c.page_id = p.id
     WHERE p.site_id = ?1
       AND p.slug = ?2
       AND p.is_enabled = 1
       AND c.published_asset_id IS NOT NULL
     LIMIT 1`,
  )
    .bind('default', slug)
    .first<{ id: string; published_asset_id: string }>();
  if (!row) return new Response('Not Found', { status: 404 });

  const object = await c.env.MEDIA.get(
    h5PageAssetKey('default', row.id, row.published_asset_id),
  );
  if (!object) return new Response('Not Found', { status: 404 });
  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  });
  if (object.size !== undefined)
    headers.set('Content-Length', String(object.size));
  return new Response(c.req.method === 'HEAD' ? null : object.body, {
    status: 200,
    headers,
  });
});

function decodePathPart(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export default h5PublicApp;
