import { readFileSync, writeFileSync } from 'node:fs';

const sourcePath = 'src/worker/admin-config-api.ts';
let source = readFileSync(sourcePath, 'utf8');
const start = source.indexOf('async function normalizeRoutingScope(');
const end = source.indexOf('function normalizedIdentifiers', start);
if (start < 0 || end < 0 || end <= start) {
  throw new Error('Could not locate routing scope helper region.');
}

const replacement = String.raw`async function normalizeRoutingScope(
  db: D1Database,
  raw: unknown,
  legacyProductIds: string[],
): Promise<AgentRoutingScope | null> {
  if (raw === undefined) {
    const productIds = normalizedIdentifiers(legacyProductIds);
    if (!productIds.length) return { type: 'none' };
    return (await allEnabledProductsExist(db, productIds))
      ? { type: 'product', productIds }
      : null;
  }
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;

  if (raw.type === 'none') return { type: 'none' };

  if (raw.type === 'section') {
    const legacySectionId = normalizeIdentifier(raw.sectionId);
    const sectionIds = normalizedIdentifiers([
      ...(Array.isArray(raw.sectionIds) ? raw.sectionIds : []),
      legacySectionId,
    ]);
    if (!sectionIds.length) return null;
    return (await allEnabledSectionsExist(db, sectionIds))
      ? { type: 'section', sectionIds }
      : null;
  }

  if (raw.type === 'category') {
    const sectionId = normalizeIdentifier(raw.sectionId);
    if (!sectionId || !Array.isArray(raw.categoryIds)) return null;
    const categoryIds = normalizedIdentifiers(raw.categoryIds);
    if (!categoryIds.length) return null;
    return (await allEnabledCategoriesExist(db, sectionId, categoryIds))
      ? { type: 'category', sectionId, categoryIds }
      : null;
  }

  if (raw.type === 'product') {
    if (!Array.isArray(raw.productIds)) return null;
    const productIds = normalizedIdentifiers(raw.productIds);
    if (!productIds.length) return { type: 'none' };
    return (await allEnabledProductsExist(db, productIds))
      ? { type: 'product', productIds }
      : null;
  }

  return null;
}

function routingScopeStatements(
  db: D1Database,
  agentId: string,
  scope: AgentRoutingScope,
): D1PreparedStatement[] {
  if (scope.type === 'none') return [];

  if (scope.type === 'section') {
    return [
      db
        .prepare(
          \`INSERT INTO agent_routing_scopes (
             site_id, agent_id, scope_type, section_id,
             category_id, product_id, is_enabled
           )
           SELECT 'default', ?1, 'section', CAST(requested.value AS TEXT),
             '', '', 1
           FROM json_each(?2) requested\`,
        )
        .bind(agentId, JSON.stringify(scope.sectionIds)),
    ];
  }

  if (scope.type === 'category') {
    return [
      db
        .prepare(
          \`INSERT INTO agent_routing_scopes (
             site_id, agent_id, scope_type, section_id,
             category_id, product_id, is_enabled
           )
           SELECT 'default', ?1, 'category', ?2,
             CAST(requested.value AS TEXT), '', 1
           FROM json_each(?3) requested\`,
        )
        .bind(agentId, scope.sectionId, JSON.stringify(scope.categoryIds)),
    ];
  }

  return [
    db
      .prepare(
        \`INSERT INTO agent_routing_scopes (
           site_id, agent_id, scope_type, section_id,
           category_id, product_id, is_enabled
         )
         SELECT 'default', ?1, 'product', '', '',
           CAST(requested.value AS TEXT), 1
         FROM json_each(?2) requested\`,
      )
      .bind(agentId, JSON.stringify(scope.productIds)),
  ];
}

async function allEnabledSectionsExist(
  db: D1Database,
  sectionIds: string[],
): Promise<boolean> {
  return allRequestedScopeValuesExist(
    db,
    \`SELECT COUNT(*) AS count
     FROM json_each(?1) requested
     WHERE EXISTS (
       SELECT 1
       FROM product_catalog product
       WHERE product.site_id = 'default'
         AND product.is_enabled = 1
         AND product.section_id = CAST(requested.value AS TEXT)
       LIMIT 1
     )\`,
    [JSON.stringify(sectionIds)],
    sectionIds.length,
  );
}

async function allEnabledCategoriesExist(
  db: D1Database,
  sectionId: string,
  categoryIds: string[],
): Promise<boolean> {
  return allRequestedScopeValuesExist(
    db,
    \`SELECT COUNT(*) AS count
     FROM json_each(?1) requested
     WHERE EXISTS (
       SELECT 1
       FROM product_catalog product
       WHERE product.site_id = 'default'
         AND product.is_enabled = 1
         AND product.section_id = ?2
         AND product.category_id = CAST(requested.value AS TEXT)
       LIMIT 1
     )\`,
    [JSON.stringify(categoryIds), sectionId],
    categoryIds.length,
  );
}

async function allEnabledProductsExist(
  db: D1Database,
  productIds: string[],
): Promise<boolean> {
  if (!productIds.length) return true;
  return allRequestedScopeValuesExist(
    db,
    \`SELECT COUNT(*) AS count
     FROM json_each(?1) requested
     WHERE EXISTS (
       SELECT 1
       FROM product_catalog product
       WHERE product.site_id = 'default'
         AND product.id = CAST(requested.value AS TEXT)
         AND product.is_enabled = 1
       LIMIT 1
     )\`,
    [JSON.stringify(productIds)],
    productIds.length,
  );
}

async function allRequestedScopeValuesExist(
  db: D1Database,
  sql: string,
  bindings: string[],
  expectedCount: number,
): Promise<boolean> {
  const statement = db.prepare(sql).bind(...bindings);
  const row = await statement.first<{ count: number }>();
  return Number(row?.count ?? 0) === expectedCount;
}

`;

source = `${source.slice(0, start)}${replacement}${source.slice(end)}`;
writeFileSync(sourcePath, source);

writeFileSync(
  'migrations/0026_product_catalog_scope_index.sql',
  `PRAGMA foreign_keys = ON;\n\nCREATE INDEX IF NOT EXISTS idx_product_catalog_scope_lookup\n  ON product_catalog(site_id, is_enabled, section_id, category_id);\n`,
);

writeFileSync(
  'test/routing-scope-d1-cost.test.mjs',
  `import assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\nimport { URL } from 'node:url';\nimport test from 'node:test';\n\nfunction source(path) {\n  return readFileSync(new URL(path, import.meta.url), 'utf8');\n}\n\ntest('routing scope validation checks only requested identifiers', () => {\n  const admin = source('../src/worker/admin-config-api.ts');\n  const migration = source('../migrations/0026_product_catalog_scope_index.sql');\n\n  assert.match(admin, /FROM json_each\\(\\?1\\) requested/u);\n  assert.match(admin, /allEnabledSectionsExist/u);\n  assert.match(admin, /allEnabledCategoriesExist/u);\n  assert.match(admin, /allEnabledProductsExist/u);\n  assert.doesNotMatch(admin, /SELECT DISTINCT section_id[\\s\\S]*?FROM product_catalog/u);\n  assert.doesNotMatch(admin, /SELECT id[\\s\\S]*?FROM product_catalog[\\s\\S]*?all<\\{ id: string \\}>/u);\n  assert.match(migration, /idx_product_catalog_scope_lookup/u);\n  assert.match(migration, /site_id, is_enabled, section_id, category_id/u);\n});\n\ntest('routing scope writes use one bulk insert per scope', () => {\n  const admin = source('../src/worker/admin-config-api.ts');\n  const start = admin.indexOf('function routingScopeStatements');\n  const end = admin.indexOf('async function allEnabledSectionsExist', start);\n  assert.ok(start >= 0 && end > start);\n  const routing = admin.slice(start, end);\n\n  assert.doesNotMatch(routing, /scope\\.(?:sectionIds|categoryIds|productIds)\\.map/u);\n  assert.equal((routing.match(/FROM json_each\\(/gu) ?? []).length, 3);\n  assert.match(routing, /JSON\\.stringify\\(scope\\.sectionIds\\)/u);\n  assert.match(routing, /JSON\\.stringify\\(scope\\.categoryIds\\)/u);\n  assert.match(routing, /JSON\\.stringify\\(scope\\.productIds\\)/u);\n});\n`,
);
