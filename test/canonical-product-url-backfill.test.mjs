import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('0054 backfills only missing or relative conversation product URLs', () => {
  const database = new DatabaseSync(':memory:');
  const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
  const migrations = readdirSync(directory)
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort();
  for (const name of migrations.filter((name) => name < '0054_')) {
    database.exec(readFileSync(`${directory}/${name}`, 'utf8'));
  }

  database.exec(`
    INSERT INTO product_catalog (
      site_id, id, title, href, section_id, section_name, is_enabled
    ) VALUES (
      'default', 'product-1', 'Product',
      'https://site.example/sections/west/products/product-1/', 'west', 'West', 1
    );
    INSERT INTO visitors (id, site_id, token_hash, external_id)
    VALUES ('visitor-1', 'default', 'token-hash-1', 'visitor-1');
    INSERT INTO conversations (id, site_id, visitor_id, status, product_id, product_href)
    VALUES
      ('relative', 'default', 'visitor-1', 'open', 'product-1', '/products/product-1'),
      ('missing', 'default', 'visitor-1', 'open', 'product-1', NULL),
      ('snapshot', 'default', 'visitor-1', 'open', 'product-1', 'https://old.example/product-1');
  `);

  database.exec(
    readFileSync(
      `${directory}/0054_backfill_canonical_product_urls.sql`,
      'utf8',
    ),
  );
  const hrefs = database
    .prepare('SELECT id, product_href FROM conversations ORDER BY id')
    .all()
    .map((row) => [row.id, row.product_href]);

  assert.deepEqual(hrefs, [
    ['missing', 'https://site.example/sections/west/products/product-1/'],
    ['relative', 'https://site.example/sections/west/products/product-1/'],
    ['snapshot', 'https://old.example/product-1'],
  ]);
  database.close();
});
