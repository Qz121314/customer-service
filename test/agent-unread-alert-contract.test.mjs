import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

test('agent unread reminders use a dedicated red alert treatment', async () => {
  const [main, css] = await Promise.all([
    readFile(new URL('../src/dashboard/main.tsx', import.meta.url), 'utf8'),
    readFile(
      new URL('../src/dashboard/agent-unread.css', import.meta.url),
      'utf8',
    ),
  ]);

  assert.match(
    main,
    /import\('\.\/agent-mobile\.css'\);[\s\S]*?import\('\.\/agent-unread\.css'\);/u,
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
    /\.workspace-shell \.conversation-row\.unread::before \{[\s\S]*?background: var\(--agent-unread\);/u,
  );
});
