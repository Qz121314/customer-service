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
  const instrumented = createInstrumentedD1(database);
  return { database, ...instrumented };
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

async function savePromotion(db, overrides = {}) {
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
        summary: 'Get 10% off your first order',
        coverUrl: 'https://example.com/cover.webp',
        bodyMarkdown: '# Welcome\n\nSafe **Markdown** article.',
        ctaLabel: 'Shop now',
        ctaUrl: 'https://example.com/offer',
        startsAt: null,
        endsAt: null,
        ...overrides,
      }),
    },
    { DB: db, ADMIN_PASSWORD: 'secret' },
  );
  return { response, body: await response.json() };
}

test('promotion migration creates one site-scoped content table only', () => {
  const { database } = setup();
  const rows = database
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name LIKE 'visitor_promotion%'
       ORDER BY name`,
    )
    .all()
    .map((row) => ({ ...row }));
  assert.deepEqual(rows, [{ name: 'visitor_promotions' }]);

  database.exec(`
    INSERT INTO visitor_promotions (
      site_id, id, is_enabled, title, summary, body_markdown
    ) VALUES ('default', 'promo-1', 1, 'Title', 'Summary', 'Body');
  `);
  assert.throws(() =>
    database.exec(`
      INSERT INTO visitor_promotions (
        site_id, id, is_enabled, title, summary, body_markdown
      ) VALUES ('default', 'promo-2', 1, 'Title 2', 'Summary 2', 'Body 2');
    `),
  );
  assert.throws(() =>
    database.exec(`
      INSERT INTO visitor_promotions (
        site_id, id, is_enabled, title, summary, body_markdown
      ) VALUES ('missing-site', 'promo-3', 1, 'Title 3', 'Summary 3', 'Body 3');
    `),
  );
});

test('admin promotion API reuses admin session and validates content', async () => {
  const { db } = setup();
  const unauthorized = await visitorPromotionApi.request(
    '/api/admin/visitor-promotion',
    undefined,
    { DB: db, ADMIN_PASSWORD: 'secret' },
  );
  assert.equal(unauthorized.status, 401);

  const invalidTitle = await savePromotion(db, { title: ' ' });
  assert.equal(invalidTitle.response.status, 400);
  assert.equal(invalidTitle.body.error, 'INVALID_PROMOTION');

  const invalidBody = await savePromotion(db, { bodyMarkdown: '' });
  assert.equal(invalidBody.response.status, 400);
  assert.equal(invalidBody.body.error, 'INVALID_PROMOTION');

  const invalidCover = await savePromotion(db, {
    coverUrl: 'javascript:alert(1)',
  });
  assert.equal(invalidCover.response.status, 400);
  assert.equal(invalidCover.body.error, 'INVALID_PROMOTION_URL');

  const invalidCta = await savePromotion(db, {
    ctaLabel: 'Shop',
    ctaUrl: null,
  });
  assert.equal(invalidCta.response.status, 400);
  assert.equal(invalidCta.body.error, 'INVALID_PROMOTION_CTA');

  const invalidTime = await savePromotion(db, {
    startsAt: '2026-09-07T00:00:00.000Z',
    endsAt: '2026-09-06T00:00:00.000Z',
  });
  assert.equal(invalidTime.response.status, 400);
  assert.equal(invalidTime.body.error, 'INVALID_PROMOTION_TIME');

  const valid = await savePromotion(db);
  assert.equal(valid.response.status, 200);
  assert.equal(valid.body.promotion.title, 'New Customer Offer');
  assert.equal(valid.body.promotion.ctaUrl, 'https://example.com/offer');
  assert.equal('revision' in valid.body.promotion, false);

  const get = await visitorPromotionApi.request(
    '/api/admin/visitor-promotion',
    { headers: { cookie: adminCookie() } },
    { DB: db, ADMIN_PASSWORD: 'secret' },
  );
  assert.equal(get.status, 200);
  assert.equal((await get.json()).promotion.title, 'New Customer Offer');
});

test('public API returns null for disabled, future and expired promotion', async () => {
  const { db } = setup();
  await savePromotion(db, { isEnabled: false });
  let response = await visitorPromotionApi.request(
    '/client/v1/promotion?projectId=pk_default',
    undefined,
    { DB: db },
  );
  assert.equal((await response.json()).promotion, null);

  await savePromotion(db, {
    startsAt: new Date(Date.now() + 60_000).toISOString(),
    endsAt: null,
  });
  response = await visitorPromotionApi.request(
    '/client/v1/promotion?projectId=pk_default',
    undefined,
    { DB: db },
  );
  assert.equal((await response.json()).promotion, null);

  await savePromotion(db, {
    startsAt: new Date(Date.now() - 120_000).toISOString(),
    endsAt: new Date(Date.now() - 60_000).toISOString(),
  });
  response = await visitorPromotionApi.request(
    '/client/v1/promotion?projectId=pk_default',
    undefined,
    { DB: db },
  );
  assert.equal((await response.json()).promotion, null);
});

test('public active lookup is site-isolated and costs one SELECT', async () => {
  const { database, db, metrics, reset } = setup();
  await savePromotion(db);
  database.exec(`
    INSERT INTO sites (id, name, public_key, is_enabled)
    VALUES ('site-b', 'Site B', 'pk_site_b', 1);
    INSERT INTO visitor_promotions (
      site_id, id, is_enabled, title, summary, body_markdown, updated_at
    ) VALUES (
      'site-b', 'promo-b', 1, 'Site B Offer', 'Only B', '# Site B',
      '2026-09-06T12:00:00.000Z'
    );
  `);

  reset();
  const response = await visitorPromotionApi.request(
    '/client/v1/promotion?projectId=pk_default',
    undefined,
    { DB: db },
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.promotion.title, 'New Customer Offer');
  assert.equal('isNew' in payload.promotion, false);
  assert.equal('revision' in payload.promotion, false);
  assert.equal(metrics().select, 1);
  assert.equal(metrics().insert, 0);
  assert.equal(metrics().update, 0);

  const siteB = await visitorPromotionApi.request(
    '/client/v1/promotion?projectId=pk_site_b',
    undefined,
    { DB: db },
  );
  assert.equal((await siteB.json()).promotion.title, 'Site B Offer');

  const missing = await visitorPromotionApi.request(
    '/client/v1/promotion?projectId=missing',
    undefined,
    { DB: db },
  );
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'PROJECT_NOT_FOUND');
});

test('updating content preserves id and advances updatedAt', async () => {
  const { db } = setup();
  const first = await savePromotion(db);
  const second = await savePromotion(db, { title: 'Updated offer' });
  assert.equal(second.body.promotion.id, first.body.promotion.id);
  assert.notEqual(
    second.body.promotion.updatedAt,
    first.body.promotion.updatedAt,
  );
});

test('promotion source stays outside chat, identity, routing, quota and statistics', () => {
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

  assert.doesNotMatch(promotionSource, /visitor_promotion_views/iu);
  assert.doesNotMatch(
    promotionSource,
    /resolveVisitor|visitorToken|visitorId/iu,
  );
  assert.doesNotMatch(
    promotionSource,
    /INSERT\s+INTO\s+(?:conversations|messages)\b/iu,
  );
  assert.doesNotMatch(
    promotionSource,
    /conversation_traffic_receipts|traffic_daily_rollups/iu,
  );
  assert.doesNotMatch(
    promotionSource,
    /from ['"]\.\/(?:routing|abuse-control)/iu,
  );
  assert.doesNotMatch(clientSource, /visitor_promotions/iu);
});
