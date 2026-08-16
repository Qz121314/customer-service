import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync('src/worker/entry.ts', 'utf8');
const core = readFileSync('src/worker/core.ts', 'utf8');

test('runtime does not mount the legacy chat application', () => {
  assert.doesNotMatch(entry, /from ['"]\.\/index['"]/u);
  assert.match(entry, /from ['"]\.\/core['"]/u);
  assert.match(entry, /app\.all\('\/api\/public\/\*'/u);
});

test('core owns only auth, health and asset fallback API boundaries', () => {
  assert.match(core, /coreApp\.get\('\/api\/health'/u);
  assert.match(core, /coreApp\.post\('\/api\/auth\/login'/u);
  assert.match(core, /coreApp\.all\('\/api\/\*'/u);
  assert.doesNotMatch(core, /\/api\/public\/conversations/u);
  assert.doesNotMatch(core, /\/api\/admin\/conversations/u);
});
