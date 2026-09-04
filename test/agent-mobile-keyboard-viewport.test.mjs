import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function cssRule(styles, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule: ${selector}`);
  return match[1];
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

  const threadPaneRule = cssRule(routeLayout, '.workspace-shell .thread-pane');
  assert.match(
    threadPaneRule,
    /display:\s*grid;/,
    'active chat must use an explicit grid child contract',
  );
  assert.match(
    threadPaneRule,
    /grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto;/,
    'only the message timeline may own the elastic chat row',
  );
  assert.match(
    threadPaneRule,
    /grid-template-areas:\s*'thread-head'\s*'thread-messages'\s*'thread-composer';/,
    'chat rows must be named instead of depending on child order',
  );

  assert.match(
    cssRule(routeLayout, '.workspace-shell .thread-pane > .thread-head'),
    /grid-area:\s*thread-head;/,
  );
  assert.match(
    cssRule(routeLayout, '.workspace-shell .thread-pane > .messages'),
    /grid-area:\s*thread-messages;/,
  );
  assert.match(
    cssRule(routeLayout, '.workspace-shell .thread-pane > .composer'),
    /grid-area:\s*thread-composer;/,
    'composer must never auto-place into the 1fr message row',
  );
  assert.match(
    cssRule(
      routeLayout,
      '.workspace-shell.is-thread-open .thread-pane',
    ),
    /display:\s*grid;/,
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
