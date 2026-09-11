import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';
import { integrationApi } from '../src/worker/integration-api.ts';

function applyMigrations(database) {
  const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
  for (const name of readdirSync(directory)
    .filter((value) => /^\d+.*\.sql$/u.test(value))
    .sort()) {
    database.exec(readFileSync(`${directory}/${name}`, 'utf8'));
  }
}

function d1(database) {
  const counter = { count: 0 };

  function statement(sql) {
    let bindings = [];
    return {
      bind(...values) {
        bindings = values;
        return this;
      },
      async first(column) {
        counter.count += 1;
        const row = database.prepare(sql).get(...bindings) ?? null;
        if (column === undefined || row === null) return row;
        return row[column] ?? null;
      },
      async all() {
        counter.count += 1;
        return { results: database.prepare(sql).all(...bindings) };
      },
      async run() {
        counter.count += 1;
        const result = database.prepare(sql).run(...bindings);
        return { meta: { changes: Number(result.changes) } };
      },
    };
  }

  return {
    counter,
    prepare: statement,
    async batch(statements) {
      const results = [];
      database.exec('BEGIN');
      try {
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

function product(index) {
  return {
    id: `product-${index}`,
    title: `Product ${index}`,
    href: `https://storefront.example/products/${index}`,
    coverUrl: null,
    sectionId: `section-${index % 8}`,
    sectionName: `Section ${index % 8}`,
    categoryId: `category-${index % 24}`,
    categoryName: `Category ${index % 24}`,
    isEnabled: true,
  };
}

async function syncRequest(db, products) {
  return integrationApi.request(
    '/integration/v1/verify',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer integration-test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ productCatalog: { products } }),
    },
    {
      DB: db,
      INTEGRATION_VERIFY_TOKEN: 'integration-test-token',
    },
  );
}

test('product sync rejects relative detail URLs', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  const response = await syncRequest(d1(database), [
    { ...product(1), href: '/products/1' },
  ]);

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_PRODUCT_CATALOG');
  database.close();
});

function scalar(database, sql, column) {
  return database.prepare(sql).get()[column];
}

test('large product catalogs sync with bounded D1 query count', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  const db = d1(database);

  const firstProducts = Array.from({ length: 1200 }, (_, index) =>
    product(index),
  );
  const firstResponse = await syncRequest(db, firstProducts);
  assert.equal(firstResponse.status, 200);
  assert.equal((await firstResponse.json()).productCatalog.productCount, 1200);
  assert.equal(
    scalar(
      database,
      `SELECT COUNT(*) AS count
       FROM product_catalog
       WHERE site_id = 'default' AND is_enabled = 1`,
      'count',
    ),
    1200,
  );
  assert.equal(db.counter.count, 7);
  assert.ok(db.counter.count < 50);

  db.counter.count = 0;
  const secondResponse = await syncRequest(db, [product(5), product(999)]);
  assert.equal(secondResponse.status, 200);
  assert.equal((await secondResponse.json()).productCatalog.productCount, 2);
  assert.equal(
    scalar(
      database,
      `SELECT COUNT(*) AS count
       FROM product_catalog
       WHERE site_id = 'default' AND is_enabled = 1`,
      'count',
    ),
    2,
  );
  assert.equal(
    scalar(
      database,
      `SELECT is_enabled
       FROM product_catalog
       WHERE site_id = 'default' AND id = 'product-0'`,
      'is_enabled',
    ),
    0,
  );
  assert.equal(db.counter.count, 3);

  database.close();
});
