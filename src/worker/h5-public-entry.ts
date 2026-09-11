import { Hono } from 'hono';
import { h5PageAssetKey } from './h5-page-content.ts';
import { normalizeH5Slug } from './h5-public-url.ts';

type Bindings = {
  DB: D1Database;
  H5_PAGES: R2Bucket;
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
    `SELECT p.id, c.published_asset_id, pool.action_type, pool.cta_label,
       pool.external_url, settings.chat_public_origin
     FROM h5_product_catalog p
     JOIN h5_page_content c
       ON c.site_id = p.site_id AND c.page_id = p.id
     LEFT JOIN h5_conversion_pools pool
       ON pool.site_id = p.site_id AND pool.id = p.conversion_pool_id
     LEFT JOIN h5_settings settings ON settings.site_id = p.site_id
     WHERE p.site_id = ?1
       AND p.slug = ?2
       AND p.is_enabled = 1
       AND c.published_asset_id IS NOT NULL
     LIMIT 1`,
  )
    .bind('default', slug)
    .first<{
      id: string;
      published_asset_id: string;
      action_type: 'chat' | 'external' | null;
      cta_label: string | null;
      external_url: string | null;
      chat_public_origin: string | null;
    }>();
  if (!row) return new Response('Not Found', { status: 404 });

  const object = await c.env.H5_PAGES.get(
    h5PageAssetKey('default', row.id, row.published_asset_id),
  );
  if (!object) return new Response('Not Found', { status: 404 });
  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "sandbox allow-scripts allow-forms allow-top-navigation-by-user-activation allow-popups allow-popups-to-escape-sandbox; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https:; img-src https: data: blob:; font-src https: data:; media-src https: blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  });
  if (c.req.method === 'HEAD') {
    if (object.size !== undefined)
      headers.set('Content-Length', String(object.size));
    return new Response(null, { status: 200, headers });
  }
  const html =
    object.body instanceof Uint8Array
      ? new TextDecoder().decode(object.body)
      : await new Response(object.body).text();
  if (!/data-h5-cta/iu.test(html)) {
    if (object.size !== undefined)
      headers.set('Content-Length', String(object.size));
    return new Response(html, { status: 200, headers });
  }
  const config = JSON.stringify({
    action: row.action_type,
    label: row.cta_label,
    externalUrl: row.external_url,
    chatOrigin: row.chat_public_origin,
    productId: row.id,
  }).replace(/</gu, '\\u003c');
  const bootstrap = `<script>window.__H5_CTA__=${config};(()=>{const c=window.__H5_CTA__;const target=()=>{if(c.action==='external'&&c.externalUrl)return c.externalUrl;if(c.action==='chat'&&c.chatOrigin){const u=new URL('/chat',c.chatOrigin);u.searchParams.set('productId',c.productId);u.searchParams.set('sourceHandoffId',crypto.randomUUID());return u.toString()}return null};for(const e of document.querySelectorAll('[data-h5-cta]')){const l=e.querySelector('[data-h5-cta-label]');if(l&&c.label)l.textContent=c.label;else if(c.label&&!e.textContent.trim()&&!e.children.length)e.append(document.createTextNode(c.label));if(c.label)e.setAttribute('aria-label',c.label);const initial=target();if(initial)e.setAttribute('href',initial);else e.setAttribute('aria-disabled','true');e.addEventListener('click',t=>{const url=target();if(!url||e.getAttribute('aria-disabled')==='true'){t.preventDefault();return}e.setAttribute('href',url);if(e.tagName!=='A'){t.preventDefault();window.top.location.assign(url)}},{passive:false})}})();</script>`;
  const injectedHtml = /<\/body>/iu.test(html)
    ? html.replace(/<\/body>/iu, `${bootstrap}</body>`)
    : `${html}${bootstrap}`;
  headers.set(
    'Content-Length',
    String(new TextEncoder().encode(injectedHtml).byteLength),
  );
  return new Response(injectedHtml, {
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
