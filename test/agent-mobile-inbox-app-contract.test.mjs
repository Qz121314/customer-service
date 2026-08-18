import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('mobile agent inbox uses a stable app-style shell with telemetry controls', () => {
  const inboxCss = source('../src/dashboard/agent-mobile-inbox.css');
  const techCss = source('../src/dashboard/agent-mobile-tech-controls.css');
  const entry = source('../src/dashboard/main.tsx');
  const techImport = "import './agent-mobile-tech-controls.css';";
  const threadImport = "import './agent-mobile-thread.css';";

  assert.ok(entry.includes(techImport));
  assert.ok(entry.indexOf(techImport) > entry.indexOf(threadImport));

  for (const contract of [
    'height: 60px;',
    'font-variant-numeric: tabular-nums;',
    '.conversation-head-status',
    '.filter.active',
    '.conversation-row.selected',
    'min-height: 76px;',
  ]) {
    assert.ok(inboxCss.includes(contract), contract);
  }

  for (const contract of [
    'grid-template-columns: repeat(2, minmax(0, 1fr));',
    '--agent-tech-panel: #111a2b;',
    'font-family:',
    'ui-monospace',
    '.workspace-shell.is-thread-open .thread-actions',
    'grid-template-columns: 72px 38px;',
    '.workspace-shell.is-thread-open .transfer-menu > summary',
    'background-size: 18px 18px;',
  ]) {
    assert.ok(techCss.includes(contract), contract);
  }
});
