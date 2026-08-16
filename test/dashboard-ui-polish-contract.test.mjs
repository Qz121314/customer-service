import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('dashboard polish removes narrow chat constraints and agent workspace remains the final chat layer', () => {
  const main = source('../src/dashboard/main.tsx');
  const dialogueFlow = source('../src/dashboard/dialogue-flow.css');
  const polish = source('../src/dashboard/ui-polish.css');
  const workspace = source('../src/dashboard/agent-workspace.css');

  assert.ok(!dialogueFlow.includes('dialogue-width.css'));
  assert.ok(!dialogueFlow.includes('max-width: 464px'));
  assert.ok(
    main.indexOf("'./ui-polish.css'") >
      main.indexOf("'./cloud-service-ui.css'"),
  );
  assert.ok(
    main.indexOf("'./agent-workspace.css'") >
      main.indexOf("'./ui-polish.css'"),
  );
  assert.ok(
    polish.includes('grid-template-columns: repeat(4, minmax(0, 1fr));'),
  );
  assert.ok(polish.includes('overflow-y: auto;'));
  assert.ok(polish.includes('max-width: none;'));
  assert.ok(polish.includes('width: min(100%, 980px);'));
  assert.ok(polish.includes('@media (max-width: 760px)'));
  assert.ok(
    workspace.includes('grid-template-columns: auto minmax(0, 1fr) auto;'),
  );
  assert.ok(workspace.includes('height: 100dvh;'));
});

test('dashboard second polish pass keeps dense desktop controls and a 360px fallback', () => {
  const polish = source('../src/dashboard/ui-polish.css');

  assert.ok(polish.includes('min-height: 74px;'));
  assert.ok(polish.includes('width: min(100%, 920px);'));
  assert.ok(polish.includes('max-width: min(64%, 620px);'));
  assert.ok(
    polish.includes('grid-template-columns: repeat(4, minmax(0, 1fr));'),
  );
  assert.ok(polish.includes('@media (max-width: 360px)'));
  assert.ok(polish.includes("content: '↗';"));
  assert.ok(polish.includes('border-radius: 50%;'));
});
