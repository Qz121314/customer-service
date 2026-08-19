import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync('src/worker/entry.ts', 'utf8');
const core = readFileSync('src/worker/core.ts', 'utf8');

test('runtime does not mount the legacy chat application', () => {
  assert.doesNotMatch(entry, /from ['"]\.\/index['"]/u);
  assert.match(entry, /from ['"]\.\/core['"]/u);
  assert.match(entry, /from ['"]\.\/protocol-boundary['"]/u);
  assert.match(entry, /async fetch\(request: Request, env: Bindings/u);
  assert.match(entry, /const pathname = new URL\(request\.url\)\.pathname;/u);
  assert.match(entry, /isRemovedProtocolPath\(pathname\)/u);
  assert.match(entry, /return removedProtocolResponse\(\)/u);
});

test('protocol namespaces cannot inherit the SPA shell fallback', () => {
  assert.match(entry, /PROTOCOL_NAMESPACE_PREFIXES/u);
  for (const prefix of ['/api', '/client', '/integration', '/management']) {
    assert.ok(entry.includes(`'${prefix}'`), prefix);
  }
  assert.match(entry, /isProtocolNamespacePath\(pathname\)/u);
  assert.match(entry, /!isSpaNavigationRequest\(request\)/u);
  assert.match(entry, /new URL\('\/index\.html', request\.url\)/u);
  assert.match(entry, /return env\.ASSETS\.fetch\(shellRequest\)/u);
});

test('core keeps unknown API paths out of the SPA asset fallback', () => {
  assert.match(core, /coreApp\.get\('\/api\/health'/u);
  assert.match(core, /coreApp\.post\('\/api\/auth\/login'/u);
  assert.match(core, /pathname\.startsWith\('\/api\/'\)/u);
  assert.match(core, /return c\.json\(\{ error: 'NOT_FOUND' \}, 404\)/u);
  assert.match(core, /return c\.env\.ASSETS\.fetch\(c\.req\.raw\)/u);
  assert.doesNotMatch(core, /\/api\/public\/conversations/u);
  assert.doesNotMatch(core, /\/api\/admin\/conversations/u);
});
