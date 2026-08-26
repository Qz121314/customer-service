import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const portal = readFileSync(
  new URL('../src/dashboard/AdminPortal.tsx', import.meta.url),
  'utf8',
);
const editor = readFileSync(
  new URL('../src/dashboard/AgentEditorModal.tsx', import.meta.url),
  'utf8',
);
const api = readFileSync(
  new URL('../src/dashboard/api.ts', import.meta.url),
  'utf8',
);

test('admin edit modal exposes confirmed permanent agent deletion', () => {
  assert.match(portal, /deleteAgent/);
  assert.match(portal, /确定永久删除客服/);
  assert.match(editor, /variant="destructive"/);
  assert.match(editor, /删除客服/);
  assert.match(api, /method: 'DELETE'/);
});
