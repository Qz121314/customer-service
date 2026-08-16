import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('agent editor uses a desktop single-screen workspace instead of form scrolling', () => {
  const main = source('../src/dashboard/main.tsx');
  const editor = source('../src/dashboard/AgentEditorModal.tsx');
  const layout = source('../src/dashboard/agent-editor-single-screen.css');

  assert.ok(
    main.indexOf("'./agent-editor-single-screen.css'") >
      main.indexOf("'./ui-polish.css'"),
  );
  assert.ok(editor.includes('agent-editor-account-grid'));
  assert.ok(editor.includes('agent-editor-policy-grid'));
  assert.ok(editor.includes('agent-editor-quota-workspace'));
  assert.ok(layout.includes('@media (min-width: 821px)'));
  assert.match(
    layout,
    /\.agent-editor-form\s*\{[\s\S]*?overflow:\s*hidden;/,
  );
  assert.match(
    layout,
    /\.agent-editor-layout\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\);[\s\S]*?overflow:\s*hidden;/,
  );
  assert.ok(
    layout.includes(
      'grid-template-columns: minmax(180px, 0.72fr) repeat(3, minmax(0, 1fr));',
    ),
  );
  assert.ok(
    layout.includes(
      'grid-template-columns: repeat(4, minmax(0, 1fr));',
    ),
  );
  assert.ok(layout.includes('@media (min-width: 821px) and (max-height: 760px)'));
});
