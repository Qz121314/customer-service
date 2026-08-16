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

test('modern schema removes rollout-only routing tables', () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);

  const tables = new Set(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  );

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
  const clientApi = readFileSync(
    fileURLToPath(new URL('../src/worker/client-api.ts', import.meta.url)),
    'utf8',
  );
  const integrationApi = readFileSync(
    fileURLToPath(new URL('../src/worker/integration-api.ts', import.meta.url)),
    'utf8',
  );
  const routing = readFileSync(
    fileURLToPath(new URL('../src/worker/routing.ts', import.meta.url)),
    'utf8',
  );
  const waiting = readFileSync(
    fileURLToPath(new URL('../src/worker/waiting-assignment.ts', import.meta.url)),
    'utf8',
  );
  const entry = readFileSync(
    fileURLToPath(new URL('../src/worker/entry.ts', import.meta.url)),
    'utf8',
  );

  for (const source of [clientApi, integrationApi, routing, waiting]) {
    assert.doesNotMatch(source, /support_groups|group_agents|group_routing_rules/u);
  }
  assert.doesNotMatch(clientApi, /management\/v1\/groups|MANAGEMENT_TOKEN/u);
  assert.doesNotMatch(integrationApi, /\bgroups\s*:/u);
  assert.doesNotMatch(entry, /MANAGEMENT_TOKEN/u);
});
