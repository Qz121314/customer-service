import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

const { h5AdminApi } = await import('../src/worker/h5-admin-api.ts');

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
  return {
    prepare: statement,
    async batch(statements) {
      database.exec('BEGIN');
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
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

function request(api, path, database, options = {}) {
  return api.request(
    path,
    {
      ...options,
      headers: {
        cookie: adminCookie('admin-password'),
        'content-type': 'application/json',
        ...options.headers,
      },
    },
    {
      DB: d1(database),
      ADMIN_PASSWORD: 'admin-password',
    },
  );
}

function json(response) {
  return response.json();
}

test('H5 admin pages support CRUD, stable IDs, duplicate slugs and derived public URLs', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  const createPool = await request(
    h5AdminApi,
    '/api/admin/h5/conversion-pools',
    database,
    {
      method: 'POST',
      body: JSON.stringify({
        name: 'Sales Chat',
        actionType: 'chat',
        ctaLabel: '立即咨询',
        externalUrl: null,
      }),
    },
  );
  assert.equal(createPool.status, 201);
  const pool = (await json(createPool)).pool;

  const createPage = await request(
    h5AdminApi,
    '/api/admin/h5/pages',
    database,
    {
      method: 'POST',
      body: JSON.stringify({
        title: 'Campaign A',
        slug: 'campaign-a',
        conversionPoolId: pool.id,
        isEnabled: true,
      }),
    },
  );
  assert.equal(createPage.status, 201);
  const page = (await json(createPage)).page;
  assert.match(page.id, /^h5:product:/u);
  assert.equal(page.sectionId, 'h5:section:pages');
  assert.equal(page.publicUrl, null);

  const settings = await request(
    h5AdminApi,
    '/api/admin/h5/settings',
    database,
    {
      method: 'PUT',
      body: JSON.stringify({ publicOrigin: ' https://h5.example.com/ ' }),
    },
  );
  assert.equal(settings.status, 200);
  assert.equal(
    (await json(settings)).settings.publicOrigin,
    'https://h5.example.com',
  );

  const update = await request(
    h5AdminApi,
    `/api/admin/h5/pages/${encodeURIComponent(page.id)}`,
    database,
    {
      method: 'PATCH',
      body: JSON.stringify({
        title: 'Campaign A Updated',
        slug: 'campaign-a-updated',
      }),
    },
  );
  assert.equal(update.status, 200);
  const updated = (await json(update)).page;
  assert.equal(updated.id, page.id);
  assert.equal(updated.publicUrl, 'https://h5.example.com/campaign-a-updated/');
  assert.equal(updated.conversionPoolId, pool.id);

  const duplicate = await request(
    h5AdminApi,
    `/api/admin/h5/pages/${encodeURIComponent(page.id)}/duplicate`,
    database,
    {
      method: 'POST',
    },
  );
  assert.equal(duplicate.status, 201);
  const copy = (await json(duplicate)).page;
  assert.notEqual(copy.id, page.id);
  assert.equal(copy.slug, 'campaign-a-updated-copy');
  assert.equal(copy.isEnabled, false);
  assert.equal(copy.conversionPoolId, pool.id);

  const list = await request(h5AdminApi, '/api/admin/h5/pages', database);
  assert.equal(list.status, 200);
  assert.equal((await json(list)).pages.length, 2);
  database.close();
});

test('H5 validation protects slug, origin, pool semantics and page binding', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  const invalidOrigins = [
    'http://h5.example.com',
    'https://h5.example.com/path',
    'https://h5.example.com?x=1',
    'https://h5.example.com/#x',
    'javascript:alert(1)',
    'h5.example.com',
  ];
  for (const publicOrigin of invalidOrigins) {
    const response = await request(
      h5AdminApi,
      '/api/admin/h5/settings',
      database,
      {
        method: 'PUT',
        body: JSON.stringify({ publicOrigin }),
      },
    );
    assert.equal(response.status, 400, publicOrigin);
  }

  for (const slug of ['Landing A', '/a', 'a/b', 'a?b', '']) {
    const response = await request(
      h5AdminApi,
      '/api/admin/h5/pages',
      database,
      {
        method: 'POST',
        body: JSON.stringify({ title: 'Invalid', slug }),
      },
    );
    assert.equal(response.status, 400, slug);
  }

  const externalWithoutUrl = await request(
    h5AdminApi,
    '/api/admin/h5/conversion-pools',
    database,
    {
      method: 'POST',
      body: JSON.stringify({
        name: 'External',
        actionType: 'external',
        ctaLabel: '打开',
      }),
    },
  );
  assert.equal(externalWithoutUrl.status, 400);
  const chatWithUrl = await request(
    h5AdminApi,
    '/api/admin/h5/conversion-pools',
    database,
    {
      method: 'POST',
      body: JSON.stringify({
        name: 'Chat',
        actionType: 'chat',
        ctaLabel: '咨询',
        externalUrl: 'https://example.com',
      }),
    },
  );
  assert.equal(chatWithUrl.status, 400);

  const page = await request(h5AdminApi, '/api/admin/h5/pages', database, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Valid',
      slug: 'valid-page',
      conversionPoolId: 'h5:pool:unknown',
    }),
  });
  assert.equal(page.status, 400);
  database.close();
});

test('conversion pool delete protection and set-based list preserve routing and Site isolation', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  database.exec(`
    INSERT INTO product_catalog (site_id, id, title, section_id, section_name, is_enabled)
    VALUES ('default', 'site:product:one', 'Site One', 'site:section:one', 'One', 1);
    INSERT INTO h5_product_catalog (site_id, id, title, section_id, section_name, slug, is_enabled)
    VALUES ('default', 'h5:product:one', 'H5 One', 'h5:section:pages', 'H5 页面', 'h5-one', 1);
  `);
  const createPool = await request(
    h5AdminApi,
    '/api/admin/h5/conversion-pools',
    database,
    {
      method: 'POST',
      body: JSON.stringify({
        name: 'External',
        actionType: 'external',
        ctaLabel: '了解更多',
        externalUrl: 'https://example.com/offer',
      }),
    },
  );
  const pool = (await json(createPool)).pool;
  const bind = await request(
    h5AdminApi,
    '/api/admin/h5/pages/h5%3Aproduct%3Aone',
    database,
    {
      method: 'PATCH',
      body: JSON.stringify({ conversionPoolId: pool.id }),
    },
  );
  assert.equal(bind.status, 200);

  const deleteInUse = await request(
    h5AdminApi,
    `/api/admin/h5/conversion-pools/${encodeURIComponent(pool.id)}`,
    database,
    { method: 'DELETE' },
  );
  assert.equal(deleteInUse.status, 409);
  assert.equal((await json(deleteInUse)).error, 'CONVERSION_POOL_IN_USE');

  const pools = await request(
    h5AdminApi,
    '/api/admin/h5/conversion-pools',
    database,
  );
  assert.equal(pools.status, 200);
  assert.equal((await json(pools)).pools[0].usedBy, 1);

  const tables = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'h5_conversion_pool_agents%'",
    )
    .all();
  assert.equal(tables.length, 0);
  const poolColumns = database
    .prepare('PRAGMA table_info(h5_conversion_pools)')
    .all()
    .map((row) => row.name);
  assert.deepEqual(poolColumns, [
    'site_id',
    'id',
    'name',
    'is_enabled',
    'action_type',
    'cta_label',
    'external_url',
    'created_at',
    'updated_at',
  ]);
  assert.deepEqual(
    {
      site: database
        .prepare('SELECT COUNT(*) AS count FROM product_catalog')
        .get().count,
      h5: database
        .prepare('SELECT COUNT(*) AS count FROM h5_product_catalog')
        .get().count,
    },
    { site: 1, h5: 1 },
  );
  database.close();
});

test('H5 pages and pools lists use bounded set-based reads', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  const pageQueries = [];
  const poolQueries = [];
  const env = {
    DB: d1(database, pageQueries),
    ADMIN_PASSWORD: 'admin-password',
  };
  const pageResponse = await h5AdminApi.request(
    '/api/admin/h5/pages',
    {
      headers: { cookie: adminCookie('admin-password') },
    },
    env,
  );
  assert.equal(pageResponse.status, 200);
  assert.equal(pageQueries.length, 1);
  const poolResponse = await h5AdminApi.request(
    '/api/admin/h5/conversion-pools',
    {
      headers: { cookie: adminCookie('admin-password') },
    },
    { DB: d1(database, poolQueries), ADMIN_PASSWORD: 'admin-password' },
  );
  assert.equal(poolResponse.status, 200);
  assert.equal(poolQueries.length, 1);
  database.close();
});
