import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('agent attachment plus is centered geometrically instead of by font metrics', () => {
  const css = source('../src/dashboard/agent-composer-status.css');

  assert.ok(css.includes('.workspace-shell .media-picker::before,'));
  assert.ok(css.includes('.workspace-shell .media-picker::after'));
  assert.ok(css.includes('top: 50%;'));
  assert.ok(css.includes('left: 50%;'));
  assert.ok(css.includes('transform: translate(-50%, -50%);'));
  assert.ok(css.includes('font-size: 0;'));
});
