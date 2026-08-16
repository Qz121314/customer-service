import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

test('agent desktop workspace stays compact and preserves readable contrast', async () => {
  const [main, css] = await Promise.all([
    readFile(new URL('../src/dashboard/main.tsx', import.meta.url), 'utf8'),
    readFile(
      new URL('../src/dashboard/agent-desktop-compact.css', import.meta.url),
      'utf8',
    ),
  ]);

  assert.match(main, /import '\.\/agent-desktop-compact\.css';/u);
  assert.match(css, /max-width: 1480px;/u);
  assert.match(css, /height: min\(900px, calc\(100dvh - 28px\)\);/u);
  assert.match(css, /background: #1d2026;/u);
  assert.match(css, /\.workspace-shell \.filter \{/u);
  assert.match(css, /color: #596372;/u);
});
