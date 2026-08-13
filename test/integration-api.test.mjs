import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/worker/integration-api.ts', 'utf8');

test('integration verification exposes public browser CORS', () => {
  assert.match(source, /integrationApi\.use\(/u);
  assert.match(source, /\/integration\/v1\/\*/u);
  assert.match(source, /origin:\s*['"]\*['"]/u);
  assert.match(source, /allowHeaders/u);
  assert.match(source, /allowMethods/u);
});
