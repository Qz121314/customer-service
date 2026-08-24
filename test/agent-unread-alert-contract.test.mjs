import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

test('agent workspace state layer preserves unread alerts and selected priority', async () => {
  const [main, css] = await Promise.all([
    readFile(new URL('../src/dashboard/main.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/dashboard/agent-state.css', import.meta.url), 'utf8'),
  ]);

  assert.match(
    main,
    /import\('\.\/agent-mobile\.css'\);[\s\S]*?import\('\.\/agent-state\.css'\);/u,
  );
  assert.match(css, /--agent-unread: #d92d20;/u);
  assert.match(
    css,
    /\.workspace-shell \.unread-total,[\s\S]*?\.workspace-shell \.unread-badge \{[\s\S]*?background: var\(--agent-unread\);/u,
  );
  assert.match(
    css,
    /\.workspace-shell \.conversation-row\.unread \{[\s\S]*?box-shadow: inset 3px 0 0 var\(--agent-unread\);/u,
  );
  assert.match(
    css,
    /\.workspace-shell \.conversation-row\.selected\.unread,[\s\S]*?background: var\(--agent-selected-soft\);[\s\S]*?box-shadow: inset 3px 0 0 var\(--agent-selected\);/u,
  );
});
