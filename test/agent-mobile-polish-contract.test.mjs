import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('agent mobile polish keeps app hierarchy compact and thread controls touch-safe', () => {
  const main = source('../src/dashboard/main.tsx');
  const css = source('../src/dashboard/agent-mobile-polish.css');

  const workspaceImport = main.indexOf("'./agent-workspace.css'");
  const mobilePolishImport = main.indexOf("'./agent-mobile-polish.css'");

  assert.ok(workspaceImport >= 0);
  assert.ok(mobilePolishImport > workspaceImport);
  assert.ok(css.includes('@media (max-width: 760px)'));
  assert.ok(css.includes('.workspace-shell .workspace-brand-lockup'));
  assert.ok(css.includes('grid-template-columns: repeat(4, 36px);'));
  assert.ok(
    css.includes(
      'height: calc(100dvh - 54px - env(safe-area-inset-top));',
    ),
  );
  assert.ok(
    css.includes('.workspace-shell .conversation-row.unread::before'),
  );
  assert.ok(
    css.includes('.workspace-shell .message.visitor > .avatar.tiny'),
  );
  assert.ok(css.includes('max-width: 82%;'));
  assert.ok(css.includes('.workspace-shell .composer-tools'));
  assert.ok(css.includes('font-size: 16px;'));
  assert.ok(css.includes('.workspace-shell .quick-replies-panel::before'));
  assert.ok(css.includes('@media (max-width: 390px)'));
  assert.ok(css.includes('@media (display-mode: standalone)'));
});
