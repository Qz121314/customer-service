import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('mobile agent inbox uses a stable app-style shell', () => {
  const css = source('../src/dashboard/agent-mobile-inbox.css');
  const entry = source('../src/dashboard/main.tsx');

  assert.ok(entry.includes("import './agent-mobile-inbox.css';"));
  assert.ok(
    entry.indexOf("import './agent-mobile-inbox.css';") >
      entry.indexOf("import './agent-avatar.css';"),
  );

  assert.ok(css.includes('height: 60px;'));
  assert.ok(css.includes('grid-template-columns: repeat(4, minmax(0, 1fr));'));
  assert.ok(css.includes('border-radius: 15px;'));
  assert.ok(css.includes('font-variant-numeric: tabular-nums;'));
  assert.ok(css.includes('.conversation-head-status'));
  assert.ok(css.includes('flex-direction: row;'));
  assert.ok(css.includes('.filter.active'));
  assert.ok(css.includes('background: #e9ecf1;'));
  assert.ok(css.includes('.conversation-row.selected'));
  assert.ok(css.includes('min-height: 76px;'));
});
