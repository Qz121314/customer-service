import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const worker = readFileSync('src/worker/admin-site-logo-api.ts', 'utf8');
const entry = readFileSync('src/worker/entry.ts', 'utf8');
const client = readFileSync('src/dashboard/site-logo-client.ts', 'utf8');

test('site logo reuses the existing MEDIA R2 binding without D1 persistence', () => {
  assert.match(worker, /MEDIA: R2Bucket/u);
  assert.match(worker, /site-branding\/default\/logo/u);
  assert.match(worker, /c\.env\.MEDIA\.put/u);
  assert.match(worker, /c\.env\.MEDIA\.delete/u);
  assert.match(worker, /c\.env\.MEDIA\.get/u);
  assert.doesNotMatch(worker, /D1Database/u);
  assert.doesNotMatch(worker, /c\.env\.DB/u);
  assert.match(entry, /app\.route\('\/', adminSiteLogoApi\);/u);
});

test('site logo mutations stay explicit and bounded', () => {
  assert.match(worker, /put\('\/api\/admin\/site-logo'/u);
  assert.match(worker, /delete\('\/api\/admin\/site-logo'/u);
  assert.match(worker, /get\('\/client\/v1\/site-logo'/u);
  assert.match(worker, /512 \* 1024/u);
  assert.match(worker, /image\/jpeg/u);
  assert.match(worker, /image\/png/u);
  assert.match(worker, /image\/webp/u);
  assert.match(client, /method: 'PUT'/u);
  assert.match(client, /method: 'DELETE'/u);
  assert.doesNotMatch(client, /setInterval|setTimeout/u);
});
