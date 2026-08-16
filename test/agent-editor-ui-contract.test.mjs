import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('agent editor uses the consolidated commercial admin layout', () => {
  const main = source('../src/dashboard/main.tsx');
  const editor = source('../src/dashboard/AgentEditorModal.tsx');
  const layout = source('../src/dashboard/agent-editor.css');

  assert.ok(
    main.indexOf("'./agent-editor.css'") > main.indexOf("'./ui-polish.css'"),
  );
  assert.ok(!main.includes('agent-editor-single-screen.css'));
  assert.ok(!main.includes('agent-editor-precision.css'));

  assert.ok(editor.includes('agent-editor-workspace-card'));
  assert.ok(editor.includes('agent-editor-subsection'));
  assert.ok(editor.includes('agent-editor-footer-actions'));
  assert.ok(editor.includes('agent-editor-kicker'));

  assert.ok(layout.includes('--ae-brand: #ff5a1f;'));
  assert.ok(layout.includes('--ae-page: #f5f6f8;'));
  assert.ok(
    layout.includes(
      'grid-template-columns: minmax(0, 1.18fr) minmax(420px, 0.82fr);',
    ),
  );
  assert.ok(layout.includes('background: var(--ae-dark);'));
  assert.ok(layout.includes('box-shadow: 0 0 0 3px rgb(255 90 31 / 12%);'));
  assert.ok(layout.includes('@media (min-width: 821px)'));
  assert.ok(layout.includes('@media (max-width: 820px)'));
});
