import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('routing scope validation checks only requested identifiers', () => {
  const admin = source('../src/worker/admin-config-api.ts');
  const migration = source(
    '../migrations/0026_product_catalog_scope_index.sql',
  );

  assert.match(admin, /FROM json_each\(\?1\) requested/u);
  assert.match(admin, /allEnabledSectionsExist/u);
  assert.match(admin, /allEnabledCategoriesExist/u);
  assert.match(admin, /allEnabledProductsExist/u);
  const validationStart = admin.indexOf(
    'async function allEnabledSectionsExist',
  );
  const validationEnd = admin.indexOf(
    'function normalizedIdentifiers',
    validationStart,
  );
  assert.ok(validationStart >= 0 && validationEnd > validationStart);
  const validation = admin.slice(validationStart, validationEnd);
  assert.doesNotMatch(validation, /SELECT DISTINCT section_id/u);
  assert.doesNotMatch(validation, /\.all</u);
  assert.match(migration, /idx_product_catalog_scope_lookup/u);
  assert.match(migration, /site_id, is_enabled, section_id, category_id/u);
});

test('routing scope writes use one bulk insert per scope', () => {
  const admin = source('../src/worker/admin-config-api.ts');
  const start = admin.indexOf('function routingScopeStatements');
  const end = admin.indexOf('async function allEnabledSectionsExist', start);
  assert.ok(start >= 0 && end > start);
  const routing = admin.slice(start, end);

  assert.doesNotMatch(
    routing,
    /scope\.(?:sectionIds|categoryIds|productIds)\.map/u,
  );
  assert.equal((routing.match(/FROM json_each\(/gu) ?? []).length, 3);
  assert.match(routing, /JSON\.stringify\(scope\.sectionIds\)/u);
  assert.match(routing, /JSON\.stringify\(scope\.categoryIds\)/u);
  assert.match(routing, /JSON\.stringify\(scope\.productIds\)/u);
});
