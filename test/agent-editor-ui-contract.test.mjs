import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('agent editor uses the compact commercial admin layout', () => {
  const main = source('../src/dashboard/main.tsx');
  const editor = source('../src/dashboard/AgentEditorModal.tsx');
  const layout = source('../src/dashboard/agent-editor.css');

  const agentStyles = main.slice(
    main.indexOf('async function loadAgentStyles'),
    main.indexOf('async function loadAdminStyles'),
  );
  const adminStyles = main.slice(
    main.indexOf('async function loadAdminStyles'),
    main.indexOf('async function loadRouteStyles'),
  );

  assert.ok(!agentStyles.includes("'./agent-editor.css'"));
  assert.ok(adminStyles.includes("'./agent-editor.css'"));
  assert.ok(!main.includes('agent-editor-single-screen.css'));
  assert.ok(!main.includes('agent-editor-precision.css'));

  assert.ok(editor.includes('agent-editor-workspace-card'));
  assert.ok(editor.includes('agent-editor-section'));
  assert.ok(editor.includes('agent-editor-footer-actions'));
  assert.ok(editor.includes('agent-editor-kicker'));
  assert.ok(editor.includes('客服头像由客服本人在工作台设置'));
  assert.ok(!editor.includes('AgentAvatarControl'));

  assert.ok(layout.includes('width: min(1180px, calc(100vw - 32px));'));
  assert.ok(layout.includes('grid-template-columns: 390px minmax(0, 1fr);'));
  assert.ok(layout.includes('min-height: 36px;'));
  assert.ok(layout.includes('border-radius: 8px;'));
  assert.ok(layout.includes('box-shadow: 0 0 0 3px rgb(255 90 31 / 10%);'));
  assert.ok(layout.includes('@media (max-width: 1040px)'));
  assert.ok(layout.includes('@media (max-width: 700px)'));
});
