import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

test('desktop agent thread keeps compact commercial chat styling', async () => {
  const [main, css] = await Promise.all([
    readFile(new URL('../src/dashboard/main.tsx', import.meta.url), 'utf8'),
    readFile(
      new URL(
        '../src/dashboard/agent-desktop-thread-polish.css',
        import.meta.url,
      ),
      'utf8',
    ),
  ]);

  assert.match(main, /import '\.\/agent-desktop-thread-polish\.css';/u);
  assert.match(
    css,
    /\.workspace-shell \.thread-back-button \{\s*display: none;/u,
  );
  assert.match(css, /width: min\(720px, calc\(100% - 40px\)\);/u);
  assert.match(css, /width: min\(100%, 820px\);/u);
  assert.match(css, /max-width: min\(64%, 560px\);/u);
  assert.match(
    css,
    /\.workspace-shell \.message\.visitor > \.avatar\.tiny \{\s*display: none;/u,
  );
});
