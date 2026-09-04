import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('mobile agent follows the visual viewport without subtree layout work', () => {
  const main = source('../src/dashboard/main.tsx');
  const agentEntry = source('../src/dashboard/agent-entry.tsx');
  const navigation = source('../src/dashboard/agent-navigation.ts');
  const mobileLayout = source('../src/dashboard/agent-mobile-layout.css');
  const routeLayout = source('../src/dashboard/agent-route.css');

  assert.ok(main.includes("import('./agent-entry')"));

  for (const contract of [
    "window.matchMedia('(max-width: 760px)')",
    'window.visualViewport',
    "viewport?.addEventListener('resize', scheduleGeometry",
    "viewport?.addEventListener('scroll', scheduleGeometry",
    "document.addEventListener('focusin', scheduleGeometry",
    "shell.style.position = 'fixed'",
    'viewport?.offsetTop ?? 0',
    'viewport?.height ?? window.innerHeight',
    'viewportRootObserver.observe(root, { childList: true })',
  ]) {
    assert.ok(agentEntry.includes(contract), contract);
  }

  for (const forbidden of [
    "querySelector<HTMLElement>('.workspace-sidebar')",
    'getBoundingClientRect().height',
    'conversationPane.style.height',
    'threadPane.style.height',
    'subtree: true',
    'historyRootObserver',
    'threadStateObserver',
  ]) {
    assert.equal(
      agentEntry.includes(forbidden),
      false,
      `mobile runtime must avoid per-message layout work: ${forbidden}`,
    );
  }

  assert.ok(navigation.includes("window.addEventListener('popstate'"));

  assert.match(
    mobileLayout,
    /\.workspace-shell\s*{[\s\S]*?display: flex;[\s\S]*?flex-direction: column;/,
    'mobile shell must stack the navigation and active pane',
  );
  assert.match(
    mobileLayout,
    /\.conversation-pane\s*{[\s\S]*?height: auto;[\s\S]*?flex: 1 1 auto;/,
    'mobile inbox must consume the remaining visual viewport',
  );
  assert.match(
    mobileLayout,
    /\.workspace-shell\.is-thread-open \.thread-pane\s*{[\s\S]*?height: auto;[\s\S]*?flex: 1 1 auto;/,
    'mobile thread must consume the remaining visual viewport',
  );

  for (const contract of [
    'grid-template-rows: auto minmax(0, 1fr) auto;',
    "'thread-head'",
    "'thread-messages'",
    "'thread-composer'",
    'grid-area: thread-head;',
    'grid-area: thread-messages;',
    'grid-area: thread-composer;',
  ]) {
    assert.ok(routeLayout.includes(contract), contract);
  }

  assert.ok(
    routeLayout.includes(
      '.workspace-shell.is-thread-open .thread-pane {\n  display: grid;\n}',
    ),
    'mobile thread-open override must preserve the chat grid contract',
  );

  const renderIndex = agentEntry.indexOf(
    "createRoot(document.getElementById('root')!).render(",
  );
  const viewportInstallIndex = agentEntry.lastIndexOf(
    'installAgentVisualViewportSync();',
  );
  assert.ok(renderIndex >= 0, 'app root rendering must exist');
  assert.ok(
    viewportInstallIndex > renderIndex,
    'viewport sync must be installed after the app root starts rendering',
  );
});
