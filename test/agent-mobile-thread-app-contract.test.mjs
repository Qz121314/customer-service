import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('mobile agent conversation uses the final app-style thread layer', () => {
  const css = source('../src/dashboard/agent-mobile-thread.css');
  const entry = source('../src/dashboard/main.tsx');
  const threadImport = "import './agent-mobile-thread.css';";
  const inboxImport = "import './agent-mobile-inbox.css';";

  assert.ok(entry.includes(threadImport));
  assert.ok(entry.indexOf(threadImport) > entry.indexOf(inboxImport));

  for (const contract of [
    '.workspace-shell.is-thread-open .thread-head',
    'min-height: 64px;',
    '.workspace-shell.is-thread-open .conversation-context-card',
    'border-radius: 14px;',
    '.workspace-shell.is-thread-open .message > div',
    'max-width: 84%;',
    '.workspace-shell.is-thread-open .composer',
    'grid-template-columns: 38px minmax(0, 1fr) 42px;',
    'font-variant-numeric: tabular-nums;',
  ]) {
    assert.ok(css.includes(contract), contract);
  }
});
