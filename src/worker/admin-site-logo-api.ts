import { Hono, type Context } from 'hono';
import {
  LEGACY_SITE_LOGO_KEY,
  getCurrentSiteLogo,
  isSiteLogoAssetId,
  removeSiteLogo,
  replaceSiteLogo,
  siteLogoAssetKey,
} from './site-logo-storage';

type Bindings = {
  MEDIA: R2Bucket;
  ADMIN_PASSWORD?: string;
};

type Env = { Bindings: Bindings };

const SESSION_COOKIE = 'cs_session';
const SITE_LOGO_MAX_BYTES = 1024 * 1024;
const SITE_LOGO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const adminSiteLogoApi = new Hono<Env>();

adminSiteLogoApi.get('/api/admin/site-logo', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  try {
    return c.json({ siteLogo: await getCurrentSiteLogo(c.env.MEDIA) });
  } catch (error) {
    console.error('site-logo.read.failed', error);
    return c.json({ error: 'SITE_LOGO_READ_FAILED' }, 500);
  }
});

adminSiteLogoApi.put('/api/admin/site-logo', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const contentType = normalizeContentType(c.req.header('Content-Type'));
  if (!contentType) return c.json({ error: 'INVALID_SITE_LOGO' }, 400);

  const declaredLength = Number(c.req.header('Content-Length') ?? 0);
  if (declaredLength > SITE_LOGO_MAX_BYTES) {
    return c.json({ error: 'SITE_LOGO_TOO_LARGE' }, 413);
  }

  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > SITE_LOGO_MAX_BYTES) {
    return c.json({ error: 'SITE_LOGO_TOO_LARGE' }, 413);
  }
  if (!matchesImageSignature(bytes, contentType)) {
    return c.json({ error: 'INVALID_SITE_LOGO' }, 400);
  }

  try {
    const result = await replaceSiteLogo(c.env.MEDIA, bytes, contentType);
    return c.json({
      ok: true,
      siteLogo: result.logo,
      cleanupWarning: result.cleanupWarning,
    });
  } catch (error) {
    console.error('site-logo.replace.failed', error);
    return c.json({ error: 'SITE_LOGO_SAVE_FAILED' }, 500);
  }
});

adminSiteLogoApi.delete('/api/admin/site-logo', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  try {
    const result = await removeSiteLogo(c.env.MEDIA);
    return c.json({
      ok: true,
      siteLogo: null,
      cleanupWarning: result.cleanupWarning,
    });
  } catch (error) {
    console.error('site-logo.remove.failed', error);
    return c.json({ error: 'SITE_LOGO_REMOVE_FAILED' }, 500);
  }
});

adminSiteLogoApi.get('/client/v1/site-logo/:assetId', async (c) => {
  const assetId = c.req.param('assetId');
  if (!isSiteLogoAssetId(assetId)) return new Response(null, { status: 404 });
  const object = await c.env.MEDIA.get(siteLogoAssetKey(assetId));
  if (!object) return new Response(null, { status: 404 });
  return siteLogoResponse(object, 'public, max-age=31536000, immutable');
});

// Backward-compatible entrypoint for the fixed-key logo shipped by the first
// corrective. New configurations always use the immutable unique asset URL.
adminSiteLogoApi.get('/client/v1/site-logo', async (c) => {
  let current;
  try {
    current = await getCurrentSiteLogo(c.env.MEDIA);
  } catch {
    return new Response(null, { status: 404 });
  }
  if (!current) {
    c.header('Cache-Control', 'no-store');
    return c.json({ error: 'SITE_LOGO_NOT_CONFIGURED' }, 404);
  }
  if (current.assetId !== 'legacy') {
    const location = new URL(current.url, c.req.url).toString();
    return new Response(null, {
      status: 302,
      headers: { Location: location, 'Cache-Control': 'no-store' },
    });
  }

  const object = await c.env.MEDIA.get(LEGACY_SITE_LOGO_KEY);
  if (!object) return new Response(null, { status: 404 });
  return siteLogoResponse(object, 'no-store');
});

function siteLogoResponse(object: R2ObjectBody, cacheControl: string): Response {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', cacheControl);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(object.body, { headers });
}

function normalizeContentType(value?: string): string | null {
  const contentType =
    (value ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return SITE_LOGO_TYPES.has(contentType) ? contentType : null;
}

function matchesImageSignature(
  bytes: Uint8Array,
  contentType: string,
): boolean {
  if (contentType === 'image/jpeg') {
    return (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    );
  }
  if (contentType === 'image/png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return (
      bytes.length >= signature.length &&
      signature.every((value, index) => bytes[index] === value)
    );
  }
  return (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  );
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
