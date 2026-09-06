import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';
import {
  DatabaseSync,
  applyMigrations,
  createInstrumentedD1,
} from './helpers/performance-runtime.mjs';
import { visitorPromotionApi } from './helpers/visitor-promotion-runtime.mjs';

function setup() {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  return { database, d1: createInstrumentedD1(database).db };
}

function adminCookie(password = 'secret') {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600 }),
  ).toString('base64url');
  const signature = createHmac('sha256', password)
    .update(payload)
    .digest('base64url');
  return `cs_session=${payload}.${signature}`;
}

async function savePromotion(d1, overrides = {}) {
  const response = await visitorPromotionApi.request(
    '/api/admin/visitor-promotion',
    {
      method: 'PUT',
      headers: {
        cookie: adminCookie(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        isEnabled: true,
        title: 'New Customer Offer',
        summary: 'Get 10% off first order',
        coverUrl: null,
        bodyMarkdown: '# Welcome\n\nSafe **Markdown** article.',
        ctaLabel: 'Shop now',
        ctaUrl: 'https://example.com/offer',
        startsAt: null,
        endsAt: null,
        ...overrides,
      }),
    },
    { DB: d1, ADMIN_PASSWORD: 'secret' },
  );
  return { response, body: await response.json() };
}

test('promotion migration creates independent site-scoped tables and unique views', () => {
  const { database } = setup();
  const tables = database
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name IN ('visitor_promotions', 'visitor_promotion_views')
       ORDER BY name`,
    )
    .all()
    .map((row) => row.name);
  assert.deepEqual(tables, ['visitor_promotion_views', 'visitor_promotions']);

  database.exec(`
    INSERT INTO visitor_promotions (
      site_id, id, revision, is_enabled, title, summary, body_markdown
    ) VALUES ('default', 'promo-1', 1, 1, 'Title', 'Summary', 'Body');
    INSERT INTO visitors (
      id, site_id, token_hash, access_token_hash, display_name, external_id, expires_at
    ) VALUES (
      'visitor-1', 'default', 'token-hash-1', 'access-hash-1', 'ABC123', 'ABC123',
      datetime('now', '+1 day')
    );
    INSERT INTO visitor_promotion_views (
      site_id, promotion_id, revision, visitor_id
    ) VALUES ('default', 'promo-1', 1, 'visitor-1');
  `);
  assert.throws(() =>
    database.exec(`
      INSERT INTO visitor_promotion_views (
        site_id, promotion_id, revision, visitor_id
      ) VALUES ('default', 'promo-1', 1, 'visitor-1');
    `),
  );
});

test('admin promotion API requires auth and validates safe CTA URLs', async () => {
  const { d1 } = setup();
  const unauthorized = await visitorPromotionApi.request(
    '/api/admin/visitor-promotion',
    undefined,
    { DB: d1, ADMIN_PASSWORD: 'secret' },
  );
  assert.equal(unauthorized.status, 401);

  const invalid = await savePromotion(d1, { ctaUrl: 'javascript:alert(1)' });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error, 'INVALID_PROMOTION_CTA');

  const valid = await savePromotion(d1);
  assert.equal(valid.response.status, 200);
  assert.equal(valid.body.promotion.revision, 1);
  assert.equal(valid.body.promotion.ctaUrl, 'https://example.com/offer');
});

test('active promotion is NEW until an idempotent article view and new revision is NEW again', async () => {
  const { database, d1 } = setup();
  const saved = await savePromotion(d1);
  assert.equal(saved.response.status, 200);
  const promotionId = saved.body.promotion.id;

  const beforeConversationCount = database
    .prepare('SELECT COUNT(*) AS count FROM conversations')
    .get().count;
  const beforeMessageCount = database
    .prepare('SELECT COUNT(*) AS count FROM messages')
    .get().count;

  const first = await visitorPromotionApi.request(
    '/client/v1/promotion?visitorId=ABC123',
    undefined,
    { DB: d1 },
  );
  assert.equal(first.status, 200);
  assert.equal((await first.json()).promotion.isNew, true);

  const view = await visitorPromotionApi.request(
    `/client/v1/promotion/${encodeURIComponent(promotionId)}/view`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visitorId: 'ABC123', revision: 1 }),
    },
    { DB: d1 },
  );
  assert.equal(view.status, 200);
  assert.equal((await view.json()).revision, 1);

  const repeated = await visitorPromotionApi.request(
    `/client/v1/promotion/${encodeURIComponent(promotionId)}/view`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visitorId: 'ABC123', revision: 1 }),
    },
    { DB: d1 },
  );
  assert.equal(repeated.status, 200);
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM visitor_promotion_views')
      .get().count,
    1,
  );

  const afterView = await visitorPromotionApi.request(
    '/client/v1/promotion?visitorId=ABC123',
    undefined,
    { DB: d1 },
  );
  assert.equal((await afterView.json()).promotion.isNew, false);

  const updated = await savePromotion(d1, { title: 'Second offer' });
  assert.equal(updated.body.promotion.revision, 2);
  const afterRevision = await visitorPromotionApi.request(
    '/client/v1/promotion?visitorId=ABC123',
    undefined,
    { DB: d1 },
  );
  assert.equal((await afterRevision.json()).promotion.isNew, true);

  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM conversations').get().count,
    beforeConversationCount,
  );
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM messages').get().count,
    beforeMessageCount,
  );
});

test('active rule excludes disabled, future and expired promotion', async () => {
  const { d1 } = setup();
  await savePromotion(d1, { isEnabled: false });
  let response = await visitorPromotionApi.request(
    '/client/v1/promotion?visitorId=ABC123',
    undefined,
    { DB: d1 },
  );
  assert.equal((await response.json()).promotion, null);

  await savePromotion(d1, {
    startsAt: new Date(Date.now() + 60_000).toISOString(),
    endsAt: null,
  });
  response = await visitorPromotionApi.request(
    '/client/v1/promotion?visitorId=ABC123',
    undefined,
    { DB: d1 },
  );
  assert.equal((await response.json()).promotion, null);

  await savePromotion(d1, {
    startsAt: new Date(Date.now() - 120_000).toISOString(),
    endsAt: new Date(Date.now() - 60_000).toISOString(),
  });
  response = await visitorPromotionApi.request(
    '/client/v1/promotion?visitorId=ABC123',
    undefined,
    { DB: d1 },
  );
  assert.equal((await response.json()).promotion, null);
});

test('public promotion lookup is isolated by site', async () => {
  const { database, d1 } = setup();
  await savePromotion(d1);
  database.exec(`
    INSERT INTO sites (id, name, public_key, is_enabled)
    VALUES ('site-b', 'Site B', 'pk_site_b', 1);
    INSERT INTO visitor_promotions (
      site_id, id, revision, is_enabled, title, summary, body_markdown
    ) VALUES (
      'site-b', 'promo-b', 1, 1, 'Site B Offer', 'Only B', '# Site B'
    );
  `);

  const defaultResponse = await visitorPromotionApi.request(
    '/client/v1/promotion?visitorId=ABC123&projectId=default',
    undefined,
    { DB: d1 },
  );
  assert.equal((await defaultResponse.json()).promotion.title, 'New Customer Offer');

  const siteBResponse = await visitorPromotionApi.request(
    '/client/v1/promotion?visitorId=ABC123&projectId=pk_site_b',
    undefined,
    { DB: d1 },
  );
  assert.equal((await siteBResponse.json()).promotion.title, 'Site B Offer');
});

test('promotion source stays outside chat, routing, quota and statistics owners', () => {
  const promotionSource = readFileSync(
    fileURLToPath(
      new URL('../src/worker/visitor-promotion-api.ts', import.meta.url),
    ),
    'utf8',
  );
  const clientSource = readFileSync(
    fileURLToPath(new URL('../src/worker/client-api.ts', import.meta.url)),
    'utf8',
  );
  assert.doesNotMatch(
    promotionSource,
    /INSERT\s+INTO\s+(?:conversations|messages)\b/iu,
  );
  assert.doesNotMatch(
    promotionSource,
    /conversation_traffic_receipts|traffic_daily_rollups/iu,
  );
  assert.doesNotMatch(promotionSource, /from ['"]\.\/routing/iu);
  assert.doesNotMatch(clientSource, /visitor_promotions|visitor_promotion_views/iu);
});
