import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';
import { topLevelDeclaration } from './helpers/source-contract.mjs';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('routing scope validation checks only requested identifiers', () => {
  const admin = source('../src/worker/admin-config-api.ts');
  const migration = source(
    '../migrations/0026_product_catalog_scope_index.sql',
  );

  const validations = [
    topLevelDeclaration(admin, 'async function allEnabledSectionsExist('),
    topLevelDeclaration(admin, 'async function allEnabledCategoriesExist('),
    topLevelDeclaration(admin, 'async function allEnabledProductsExist('),
  ];
  const sharedLookup = topLevelDeclaration(
    admin,
    'async function allRequestedScopeValuesExist(',
  );

  for (const validation of validations) {
    assert.match(validation, /FROM json_each\(\?1\) requested/u);
    assert.doesNotMatch(validation, /SELECT DISTINCT section_id/u);
    assert.doesNotMatch(validation, /\.all</u);
  }
  assert.match(sharedLookup, /\.first<\{ count: number \}>\(\)/u);
  assert.doesNotMatch(sharedLookup, /\.all</u);
  assert.match(migration, /idx_product_catalog_scope_lookup/u);
  assert.match(migration, /site_id, is_enabled, section_id, category_id/u);
});

test('routing scope writes use one bulk insert per scope', () => {
  const admin = source('../src/worker/admin-config-api.ts');
  const routing = topLevelDeclaration(
    admin,
    'function routingScopeStatements(',
  );

  assert.doesNotMatch(
    routing,
    /scope\.(?:sectionIds|categoryIds|productIds)\.map/u,
  );
  assert.equal((routing.match(/FROM json_each\(/gu) ?? []).length, 3);
  assert.match(routing, /JSON\.stringify\(scope\.sectionIds\)/u);
  assert.match(routing, /JSON\.stringify\(scope\.categoryIds\)/u);
  assert.match(routing, /JSON\.stringify\(scope\.productIds\)/u);
});
