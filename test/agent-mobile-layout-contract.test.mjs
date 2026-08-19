import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('agent route isolates styles and mobile UI has one visual owner', () => {
  const main = source('../src/dashboard/main.tsx');
  const workspace = source('../src/dashboard/agent-workspace.css');
  const mobile = source('../src/dashboard/agent-mobile.css');

  assert.ok(
    main.includes(
      "const isAgentRoute = window.location.pathname.startsWith('/agent')",
    ),
  );
  assert.ok(main.includes("import('./agent-foundation.css')"));
  assert.ok(main.includes("import('./agent-workspace.css')"));
  assert.ok(main.includes("import('./agent-desktop.css')"));
  assert.ok(main.includes("import('./agent-mobile.css')"));
  assert.ok(main.includes("import('./styles.css')"));
  assert.ok(main.includes('if (isAgentRoute)'));

  for (const removed of [
    '../src/dashboard/agent-mobile-inbox.css',
    '../src/dashboard/agent-mobile-thread.css',
    '../src/dashboard/agent-mobile-tech-controls.css',
    '../src/dashboard/agent-composer-status.css',
  ]) {
    assert.equal(existsSync(new URL(removed, import.meta.url)), false, removed);
  }

  assert.equal(workspace.includes('@media (max-width: 760px)'), false);
  assert.equal(workspace.includes('@media (min-width: 761px)'), false);

  for (const contract of [
    '@media (max-width: 760px)',
    '.workspace-sidebar,\n  .thread-head',
    '--mobile-accent: #5b5bd6;',
    '--mobile-surface: #ffffff;',
    '--mobile-line: #e7eaf0;',
    'height: 60px;',
    'grid-template-columns: repeat(4, minmax(0, 1fr));',
    '.inbox-overview .metric + .metric::before',
    '.thread-actions',
    'grid-template-columns: auto auto 38px;',
    '.thread-status-action',
    'grid-template-columns: 38px minmax(0, 1fr) 42px;',
    'env(safe-area-inset-bottom)',
    '@media (display-mode: standalone)',
  ]) {
    assert.ok(mobile.includes(contract), contract);
  }

  assert.equal(mobile.includes('.thread-head select'), false);

  for (const legacyVisualLayer of [
    '--agent-tech-',
    'radial-gradient(',
    'ui-monospace',
    'SFMono-Regular',
  ]) {
    assert.equal(mobile.includes(legacyVisualLayer), false, legacyVisualLayer);
  }

  assert.equal(mobile.includes('quick-repl'), false);
});
