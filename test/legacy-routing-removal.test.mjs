import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

const migrationsDirectory = fileURLToPath(
  new URL('../migrations/', import.meta.url),
);
const workerDirectory = fileURLToPath(
  new URL('../src/worker/', import.meta.url),
);
const legacyRoutingPattern =
  /support_groups|group_agents|group_routing_rules/u;

function applyMigrations(database) {
  for (const name of readdirSync(migrationsDirectory)
    .filter((value) => /^\d+.*\.sql$/u.test(value))
    .sort()) {
    database.exec(readFileSync(`${migrationsDirectory}/${name}`, 'utf8'));
  }
}

function workerSource(filename) {
  return readFileSync(`${workerDirectory}/${filename}`, 'utf8');
}

test('modern schema removes rollout-only routing tables', () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);

  const rows = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all();
  const tables = new Set(rows.map((row) => row.name));

  for (const removed of [
    'support_groups',
    'group_agents',
    'group_routing_rules',
    'routing_catalog_sections',
    'routing_catalog_categories',
    'agent_products',
  ]) {
    assert.equal(tables.has(removed), false, removed);
  }
  assert.equal(tables.has('product_catalog'), true);
  assert.equal(tables.has('agent_routing_scopes'), true);
  database.close();
});

test('runtime source no longer references legacy routing services', () => {
  const clientApi = workerSource('client-api.ts');
  const integrationApi = workerSource('integration-api.ts');
  const routing = workerSource('routing.ts');
  const waiting = workerSource('waiting-assignment.ts');
  const entry = workerSource('entry.ts');

  for (const source of [clientApi, integrationApi, routing, waiting]) {
    assert.doesNotMatch(source, legacyRoutingPattern);
  }
  assert.doesNotMatch(clientApi, /management\/v1\/groups|MANAGEMENT_TOKEN/u);
  assert.doesNotMatch(integrationApi, /\bgroups\s*:/u);
  assert.doesNotMatch(entry, /MANAGEMENT_TOKEN/u);
});
