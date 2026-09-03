import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDownloadSigningContext,
  presignGet,
} from '../src/worker/media-signing.ts';

test('presigned GET reuses one signing context for a page of images', async () => {
  let importKeyCalls = 0;
  const originalImportKey = crypto.subtle.importKey.bind(crypto.subtle);
  crypto.subtle.importKey = async (...args) => {
    importKeyCalls += 1;
    return originalImportKey(...args);
  };

  try {
    const context = await createDownloadSigningContext(
      {
        R2_ACCOUNT_ID: 'account',
        R2_ACCESS_KEY_ID: 'access-key',
        R2_SECRET_ACCESS_KEY: 'secret-key',
        R2_BUCKET_NAME: 'media',
      },
      new Date(Date.now() + 60_000).toISOString(),
    );
    assert.ok(context);
    const urls = await Promise.all(
      ['one.png', 'two.png', 'three.png'].map((key) =>
        presignGet(context, key),
      ),
    );
    assert.equal(
      importKeyCalls,
      7,
      'one four-step key derivation plus one signature per object',
    );
    for (const url of urls) {
      assert.match(url, /X-Amz-SignedHeaders=host/u);
      assert.match(url, /X-Amz-Algorithm=AWS4-HMAC-SHA256/u);
      assert.match(url, /X-Amz-Expires=60/u);
      assert.doesNotMatch(url, /secret-key/u);
    }
    assert.match(urls[0], /\/media\/one\.png\?/u);
  } finally {
    crypto.subtle.importKey = originalImportKey;
  }
});

test('missing R2 signing credentials select the authenticated proxy fallback', async () => {
  assert.equal(
    await createDownloadSigningContext(
      { R2_ACCOUNT_ID: 'account', R2_ACCESS_KEY_ID: 'access-key' },
      new Date(Date.now() + 60_000).toISOString(),
    ),
    null,
  );
});
