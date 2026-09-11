import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

function applyMigrations(database) {
  const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
  for (const name of readdirSync(directory)
    .filter((value) => /^\d+.*\.sql$/u.test(value))
    .sort()) {
    database.exec(readFileSync(`${directory}/${name}`, 'utf8'));
  }
}

function seedCatalog(database) {
  database
    .prepare(
      `INSERT INTO product_catalog (
         site_id, id, title, section_id, section_name,
         category_id, category_name, is_enabled
       ) VALUES ('default', 'site:product:escort-a', 'Escort A',
         'site:section:escorts', 'ESCORTS', 'site:category:vip', 'VIP', 1)`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO h5_product_catalog (
         site_id, id, title, section_id, section_name,
         category_id, category_name, is_enabled
       ) VALUES ('default', 'h5:product:landing-a', 'Landing A',
         'h5:section:pages', 'H5 页面', 'h5:category:landing', 'Landing', 1)`,
    )
    .run();
}

test('H5 catalog schema uses an independent product namespace and indexes', () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  const columns = database
    .prepare('PRAGMA table_info(h5_product_catalog)')
    .all()
    .map((row) => row.name);
  assert.deepEqual(columns, [
    'site_id',
    'id',
    'title',
    'href',
    'cover_url',
    'section_id',
    'section_name',
    'category_id',
    'category_name',
    'is_enabled',
    'created_at',
    'updated_at',
  ]);
  assert.throws(() =>
    database
      .prepare(
        `INSERT INTO h5_product_catalog (
           site_id, id, title, section_id, section_name
         ) VALUES ('default', 'site:product:wrong', 'Wrong',
           'h5:section:pages', 'H5 页面')`,
      )
      .run(),
  );
  const indexes = database
    .prepare("PRAGMA index_list('h5_product_catalog')")
    .all()
    .map((row) => row.name);
  assert.ok(indexes.includes('idx_h5_product_catalog_admin'));
  assert.ok(indexes.includes('idx_h5_product_catalog_scope_lookup'));
  database.close();
});

test('set-based catalog lookups recognize Site and H5 records with enabled semantics', () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  seedCatalog(database);
  database
    .prepare(
      `INSERT INTO h5_product_catalog (
         site_id, id, title, section_id, section_name,
         category_id, category_name, is_enabled
       ) VALUES ('default', 'h5:product:disabled', 'Disabled',
         'h5:section:pages', 'H5 页面', 'h5:category:landing', 'Landing', 0)`,
    )
    .run();

  const catalog = `
    SELECT site_id, id, section_id, category_id, is_enabled
    FROM product_catalog
    UNION ALL
    SELECT site_id, id, section_id, category_id, is_enabled
    FROM h5_product_catalog`;
  const hasEnabled = (column, value) =>
    database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM (${catalog}) product
         WHERE site_id = 'default' AND is_enabled = 1 AND ${column} = ?`,
      )
      .get(value).count;

  assert.equal(hasEnabled('section_id', 'site:section:escorts'), 1);
  assert.equal(hasEnabled('section_id', 'h5:section:pages'), 1);
  assert.equal(hasEnabled('category_id', 'h5:category:landing'), 1);
  assert.equal(hasEnabled('id', 'h5:product:landing-a'), 1);
  assert.equal(hasEnabled('id', 'h5:product:disabled'), 0);
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM (${catalog}) product
         WHERE site_id = 'default'
           AND is_enabled = 1
           AND section_id = ?
           AND category_id = ?`,
      )
      .get('site:section:escorts', 'h5:category:landing').count,
    0,
  );
  database.close();
});

test('Admin loader and scope validators are both wired to the unified catalog', () => {
  const admin = readFileSync(
    new URL('../src/worker/admin-config-api.ts', import.meta.url),
    'utf8',
  );
  assert.match(admin, /UNION ALL[\s\S]*FROM h5_product_catalog/u);
  assert.match(admin, /sourceType: product\.source_type/u);
  const validations = [
    'allEnabledSectionsExist',
    'allEnabledCategoriesExist',
    'allEnabledProductsExist',
  ];
  for (const name of validations) {
    const start = admin.indexOf(`async function ${name}(`);
    const end = admin.indexOf('\nasync function ', start + 1);
    assert.ok(start >= 0 && end > start, `${name} declaration is present`);
    assert.match(admin.slice(start, end), /h5_product_catalog/u);
    assert.doesNotMatch(admin.slice(start, end), /\.all</u);
  }
});
