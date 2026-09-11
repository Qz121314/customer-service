import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

const { h5AdminApi } = await import('../src/worker/h5-admin-api.ts');
const { h5PublicApp } = await import('../src/worker/h5-public-entry.ts');
const { h5PageAssetKey } = await import('../src/worker/h5-page-content.ts');

function applyMigrations(database) {
  const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
  for (const name of readdirSync(directory)
    .filter((value) => /^\d+.*\.sql$/u.test(value))
    .sort()) {
    database.exec(readFileSync(`${directory}/${name}`, 'utf8'));
  }
}

function d1(database, counter = null) {
  function statement(sql) {
    let bindings = [];
    return {
      bind(...values) {
        bindings = values;
        return this;
      },
      async first(column) {
        counter?.push(sql);
        const row = database.prepare(sql).get(...bindings) ?? null;
        if (column === undefined || row === null) return row;
        return row[column] ?? null;
      },
      async all() {
        counter?.push(sql);
        return { results: database.prepare(sql).all(...bindings) };
      },
      async run() {
        counter?.push(sql);
        const result = database.prepare(sql).run(...bindings);
        return { meta: { changes: Number(result.changes) } };
      },
    };
  }
  return { prepare: statement };
}

class FakeR2 {
  objects = new Map();
  getCount = 0;
  headCount = 0;
  deleteCount = 0;

  async put(key, body, options = {}) {
    const bytes =
      body instanceof Uint8Array
        ? new Uint8Array(body)
        : new Uint8Array(await new Response(body).arrayBuffer());
    this.objects.set(key, {
      bytes,
      size: bytes.byteLength,
      httpMetadata: options.httpMetadata ?? {},
    });
  }

  async get(key) {
    this.getCount += 1;
    const object = this.objects.get(key);
    if (!object) return null;
    return { body: object.bytes, size: object.size };
  }

  async head(key) {
    this.headCount += 1;
    const object = this.objects.get(key);
    return object ? { size: object.size } : null;
  }

  async delete(key) {
    this.deleteCount += 1;
    this.objects.delete(key);
  }
}

function adminCookie(password) {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url');
  const signature = createHmac('sha256', password)
    .update(payload)
    .digest('base64url');
  return `cs_session=${payload}.${signature}`;
}

function request(api, path, database, media, options = {}) {
  return api.request(
    path,
    {
      ...options,
      headers: {
        cookie: adminCookie('admin-password'),
        ...options.headers,
      },
    },
    {
      DB: d1(database),
      MEDIA: media,
      ADMIN_PASSWORD: 'admin-password',
    },
  );
}

function json(response) {
  return response.json();
}

test('H5 HTML upload, publish, replacement and public runtime lifecycle', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  const media = new FakeR2();
  const create = await request(
    h5AdminApi,
    '/api/admin/h5/pages',
    database,
    media,
    {
      method: 'POST',
      body: JSON.stringify({ title: 'Runtime page', slug: 'runtime-page' }),
      headers: { 'content-type': 'application/json' },
    },
  );
  assert.equal(create.status, 201);
  const pageId = (await json(create)).page.id;

  const unauthorized = await h5AdminApi.request(
    `/api/admin/h5/pages/${encodeURIComponent(pageId)}/html`,
    {
      method: 'PUT',
      body: '<html></html>',
      headers: { 'content-type': 'text/html' },
    },
    { DB: d1(database), MEDIA: media, ADMIN_PASSWORD: 'admin-password' },
  );
  assert.equal(unauthorized.status, 401);

  const noDraft = await request(
    h5AdminApi,
    `/api/admin/h5/pages/${encodeURIComponent(pageId)}/publish`,
    database,
    media,
    { method: 'POST' },
  );
  assert.equal(noDraft.status, 400);

  const upload = await request(
    h5AdminApi,
    `/api/admin/h5/pages/${encodeURIComponent(pageId)}/html`,
    database,
    media,
    {
      method: 'PUT',
      body: '<html><body>version one</body></html>',
      headers: { 'content-type': 'text/html; charset=utf-8' },
    },
  );
  assert.equal(upload.status, 200);
  assert.equal((await json(upload)).page.contentStatus, 'pending');

  const firstPublish = await request(
    h5AdminApi,
    `/api/admin/h5/pages/${encodeURIComponent(pageId)}/publish`,
    database,
    media,
    { method: 'POST' },
  );
  assert.equal(firstPublish.status, 200);

  const published = database
    .prepare(
      'SELECT draft_asset_id, published_asset_id FROM h5_page_content WHERE page_id = ?',
    )
    .get(pageId);
  assert.equal(published.draft_asset_id, published.published_asset_id);
  const firstKey = h5PageAssetKey(
    'default',
    pageId,
    published.published_asset_id,
  );
  assert.equal(
    new TextDecoder().decode(media.objects.get(firstKey).bytes),
    '<html><body>version one</body></html>',
  );

  const runtimeQueries = [];
  const publicEnv = { DB: d1(database, runtimeQueries), MEDIA: media };
  const firstGetCount = media.getCount;
  const firstPublic = await h5PublicApp.request(
    '/runtime-page/',
    { method: 'GET' },
    publicEnv,
  );
  assert.equal(firstPublic.status, 200);
  assert.equal(
    await firstPublic.text(),
    '<html><body>version one</body></html>',
  );
  assert.equal(firstPublic.headers.get('cache-control'), 'no-store');
  assert.match(firstPublic.headers.get('content-security-policy'), /sandbox/iu);
  assert.equal(runtimeQueries.length, 1);
  assert.equal(media.getCount - firstGetCount, 1);

  const headPublic = await h5PublicApp.request(
    '/runtime-page/',
    { method: 'HEAD' },
    publicEnv,
  );
  assert.equal(headPublic.status, 200);
  assert.equal(await headPublic.text(), '');
  assert.equal(runtimeQueries.length, 2);

  const canonical = await h5PublicApp.request('/runtime-page', {}, publicEnv);
  assert.equal(canonical.status, 308);
  assert.equal(
    new URL(canonical.headers.get('location')).pathname,
    '/runtime-page/',
  );

  const secondUpload = await request(
    h5AdminApi,
    `/api/admin/h5/pages/${encodeURIComponent(pageId)}/html`,
    database,
    media,
    {
      method: 'PUT',
      body: '<html><body>version two</body></html>',
      headers: { 'content-type': 'text/html' },
    },
  );
  assert.equal((await json(secondUpload)).page.contentStatus, 'updated');
  const oldPublic = await h5PublicApp.request('/runtime-page/', {}, publicEnv);
  assert.equal(await oldPublic.text(), '<html><body>version one</body></html>');

  const secondPublish = await request(
    h5AdminApi,
    `/api/admin/h5/pages/${encodeURIComponent(pageId)}/publish`,
    database,
    media,
    { method: 'POST' },
  );
  assert.equal((await json(secondPublish)).page.contentStatus, 'published');
  const newPublic = await h5PublicApp.request('/runtime-page/', {}, publicEnv);
  assert.equal(await newPublic.text(), '<html><body>version two</body></html>');

  await request(
    h5AdminApi,
    `/api/admin/h5/pages/${encodeURIComponent(pageId)}`,
    database,
    media,
    {
      method: 'PATCH',
      body: JSON.stringify({ isEnabled: false }),
      headers: { 'content-type': 'application/json' },
    },
  );
  assert.equal(
    (await h5PublicApp.request('/runtime-page/', {}, publicEnv)).status,
    404,
  );
  database.close();
});

test('H5 HTML validation, slug changes, duplicate isolation and delete cleanup', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  const media = new FakeR2();
  const create = await request(
    h5AdminApi,
    '/api/admin/h5/pages',
    database,
    media,
    {
      method: 'POST',
      body: JSON.stringify({
        title: 'Validation page',
        slug: 'validation-page',
      }),
      headers: { 'content-type': 'application/json' },
    },
  );
  const pageId = (await json(create)).page.id;
  const badInputs = [
    { body: '', type: 'text/html' },
    { body: 'plain text', type: 'text/plain' },
    {
      body: '<script src="https://cdn.example.com/x.js"></script>',
      type: 'text/html',
    },
    { body: '<script>fbq("track", "PageView")</script>', type: 'text/html' },
  ];
  for (const input of badInputs) {
    const response = await request(
      h5AdminApi,
      `/api/admin/h5/pages/${encodeURIComponent(pageId)}/html`,
      database,
      media,
      {
        method: 'PUT',
        body: input.body,
        headers: { 'content-type': input.type },
      },
    );
    assert.equal(response.status, 400);
  }

  const upload = await request(
    h5AdminApi,
    `/api/admin/h5/pages/${encodeURIComponent(pageId)}/html`,
    database,
    media,
    {
      method: 'PUT',
      body: '<html><body>published</body></html>',
      headers: { 'content-type': 'text/html' },
    },
  );
  assert.equal(upload.status, 200);
  await request(
    h5AdminApi,
    `/api/admin/h5/pages/${encodeURIComponent(pageId)}/publish`,
    database,
    media,
    { method: 'POST' },
  );

  const duplicate = await request(
    h5AdminApi,
    `/api/admin/h5/pages/${encodeURIComponent(pageId)}/duplicate`,
    database,
    media,
    { method: 'POST' },
  );
  assert.equal((await json(duplicate)).page.contentStatus, 'unuploaded');

  const slugUpdate = await request(
    h5AdminApi,
    `/api/admin/h5/pages/${encodeURIComponent(pageId)}`,
    database,
    media,
    {
      method: 'PATCH',
      body: JSON.stringify({ slug: 'renamed-page' }),
      headers: { 'content-type': 'application/json' },
    },
  );
  assert.equal(slugUpdate.status, 200);
  const publicEnv = { DB: d1(database), MEDIA: media };
  assert.equal(
    (await h5PublicApp.request('/validation-page/', {}, publicEnv)).status,
    404,
  );
  assert.equal(
    (await h5PublicApp.request('/renamed-page/', {}, publicEnv)).status,
    200,
  );

  const deleted = await request(
    h5AdminApi,
    `/api/admin/h5/pages/${encodeURIComponent(pageId)}`,
    database,
    media,
    { method: 'DELETE' },
  );
  assert.equal(deleted.status, 200);
  assert.equal(
    database
      .prepare(
        'SELECT COUNT(*) AS count FROM h5_page_content WHERE page_id = ?',
      )
      .get(pageId).count,
    0,
  );
  assert.equal(media.objects.size, 0);
  assert.equal(
    (await h5PublicApp.request('/renamed-page/', {}, publicEnv)).status,
    404,
  );
  database.close();
});
