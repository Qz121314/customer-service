import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SITE_LOGO_MAX_EDGE,
  fitSiteLogoDimensions,
  shouldKeepOriginalSiteLogo,
} from '../src/dashboard/site-logo-image.ts';
import {
  SITE_LOGO_ASSET_PREFIX,
  SITE_LOGO_POINTER_KEY,
  getCurrentSiteLogo,
  isAllowedSiteLogoKey,
  removeSiteLogo,
  replaceSiteLogo,
  siteLogoAssetKey,
} from '../src/worker/site-logo-storage.ts';

class FakeR2 {
  objects = new Map();
  failPointerPut = false;
  failDelete = new Set();

  async get(key) {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      ...object,
      async text() {
        return new TextDecoder().decode(object.bytes);
      },
    };
  }

  async put(key, body, options = {}) {
    if (key === SITE_LOGO_POINTER_KEY && this.failPointerPut) {
      throw new Error('pointer write failed');
    }
    const bytes =
      typeof body === 'string'
        ? new TextEncoder().encode(body)
        : body instanceof Uint8Array
          ? body
          : new Uint8Array(body);
    this.objects.set(key, {
      bytes,
      size: bytes.byteLength,
      uploaded: new Date('2026-09-05T00:00:00.000Z'),
      httpMetadata: options.httpMetadata ?? {},
      customMetadata: options.customMetadata ?? {},
    });
  }

  async delete(key) {
    if (this.failDelete.has(key)) throw new Error('delete failed');
    this.objects.delete(key);
  }
}

function bytes(seed = 1) {
  return new Uint8Array([0x52, 0x49, 0x46, 0x46, seed, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
}

function assetKeys(bucket) {
  return [...bucket.objects.keys()].filter((key) =>
    key.startsWith(SITE_LOGO_ASSET_PREFIX),
  );
}

test('site logo resize keeps aspect ratio within 512 square', () => {
  assert.deepEqual(fitSiteLogoDimensions(1200, 600), {
    width: SITE_LOGO_MAX_EDGE,
    height: 256,
  });
  assert.deepEqual(fitSiteLogoDimensions(240, 120), {
    width: 240,
    height: 120,
  });
  assert.throws(() => fitSiteLogoDimensions(0, 200));
});

test('site logo keeps an already-small original only when conversion is larger', () => {
  assert.equal(
    shouldKeepOriginalSiteLogo({
      originalBytes: 80_000,
      originalWidth: 256,
      originalHeight: 128,
      convertedBytes: 90_000,
    }),
    true,
  );
  assert.equal(
    shouldKeepOriginalSiteLogo({
      originalBytes: 80_000,
      originalWidth: 900,
      originalHeight: 300,
      convertedBytes: 90_000,
    }),
    false,
  );
});

test('replace uses a new unique object and deletes the previous object', async () => {
  const bucket = new FakeR2();
  const first = await replaceSiteLogo(bucket, bytes(1), 'image/webp');
  const firstLogo = first.logo;
  assert.ok(firstLogo);
  const firstKey = siteLogoAssetKey(firstLogo.assetId);
  assert.equal(bucket.objects.has(firstKey), true);

  const second = await replaceSiteLogo(bucket, bytes(2), 'image/webp');
  assert.ok(second.logo);
  assert.notEqual(second.logo.assetId, firstLogo.assetId);
  assert.notEqual(second.logo.url, firstLogo.url);
  assert.equal(bucket.objects.has(firstKey), false);
  assert.equal(assetKeys(bucket).length, 1);
  assert.equal(second.cleanupWarning, false);
});

test('remove clears the active pointer before deleting the active logo', async () => {
  const bucket = new FakeR2();
  const saved = await replaceSiteLogo(bucket, bytes(), 'image/webp');
  const key = siteLogoAssetKey(saved.logo.assetId);
  const removed = await removeSiteLogo(bucket);
  assert.equal(removed.logo, null);
  assert.equal(bucket.objects.has(SITE_LOGO_POINTER_KEY), false);
  assert.equal(bucket.objects.has(key), false);
  assert.equal(await getCurrentSiteLogo(bucket), null);
});

test('pointer persistence failure removes the new orphan and preserves old logo', async () => {
  const bucket = new FakeR2();
  const original = await replaceSiteLogo(bucket, bytes(1), 'image/webp');
  bucket.failPointerPut = true;
  await assert.rejects(
    replaceSiteLogo(bucket, bytes(2), 'image/webp'),
    /SITE_LOGO_PERSIST_FAILED/u,
  );
  bucket.failPointerPut = false;
  const current = await getCurrentSiteLogo(bucket);
  assert.equal(current?.assetId, original.logo.assetId);
  assert.equal(assetKeys(bucket).length, 1);
});

test('old-object cleanup failure never rolls back the newly active logo', async () => {
  const bucket = new FakeR2();
  const first = await replaceSiteLogo(bucket, bytes(1), 'image/webp');
  const oldKey = siteLogoAssetKey(first.logo.assetId);
  bucket.failDelete.add(oldKey);
  const second = await replaceSiteLogo(bucket, bytes(2), 'image/webp');
  assert.equal(second.cleanupWarning, true);
  assert.equal((await getCurrentSiteLogo(bucket))?.assetId, second.logo.assetId);
  assert.equal(bucket.objects.has(oldKey), true);
});

test('logo cleanup cannot target arbitrary R2 keys', async () => {
  const bucket = new FakeR2();
  const unrelatedKey = 'conversation-media/private-do-not-delete';
  await bucket.put(unrelatedKey, bytes(9));
  await replaceSiteLogo(bucket, bytes(1), 'image/webp');
  await removeSiteLogo(bucket);
  assert.equal(bucket.objects.has(unrelatedKey), true);
  assert.equal(isAllowedSiteLogoKey(unrelatedKey), false);
  assert.throws(() => siteLogoAssetKey('../../private-object'));
});
