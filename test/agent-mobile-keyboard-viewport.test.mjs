import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('mobile agent follows the visual viewport when the keyboard opens', () => {
  const main = source('../src/dashboard/main.tsx');

  for (const contract of [
    "window.matchMedia('(max-width: 760px)')",
    'window.visualViewport',
    "viewport?.addEventListener('resize', scheduleGeometry",
    "viewport?.addEventListener('scroll', scheduleGeometry",
    "document.addEventListener('focusin', scheduleGeometry",
    "shell.style.position = 'fixed'",
    'viewport?.offsetTop ?? 0',
    'viewport?.height ?? window.innerHeight',
    "querySelector<HTMLElement>('.workspace-sidebar')",
    '?.getBoundingClientRect().height || 52',
    '`calc(100% - ${Math.round(sidebarHeight)}px)`',
    "threadPane.style.height = '100%'",
  ]) {
    assert.ok(main.includes(contract), contract);
  }

  assert.equal(
    main.includes("conversationPane.style.height = 'calc(100% - 60px)'"),
    false,
    'mobile inbox height must not drift from the rendered sidebar height',
  );

  const renderIndex = main.indexOf(
    "createRoot(document.getElementById('root')!).render(",
  );
  const viewportInstallIndex = main.lastIndexOf(
    'installAgentVisualViewportSync();',
  );
  assert.ok(renderIndex >= 0, 'app root rendering must exist');
  assert.ok(
    viewportInstallIndex > renderIndex,
    'viewport sync must be installed after the app root starts rendering',
  );
});
