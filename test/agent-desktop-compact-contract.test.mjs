import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

test('agent desktop workspace stays compact and preserves inbox geometry', async () => {
  const [main, css, composerCss] = await Promise.all([
    readFile(new URL('../src/dashboard/main.tsx', import.meta.url), 'utf8'),
    readFile(
      new URL('../src/dashboard/agent-desktop.css', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../src/dashboard/agent-desktop-composer.css', import.meta.url),
      'utf8',
    ),
  ]);

  assert.match(main, /import\('\.\/agent-desktop\.css'\)/u);
  assert.match(main, /import\('\.\/agent-desktop-composer\.css'\)/u);
  assert.doesNotMatch(
    main,
    /agent-desktop-compact|agent-desktop-thread-polish/u,
  );
  assert.match(css, /max-width: 1480px;/u);
  assert.match(css, /height: min\(900px, calc\(100dvh - 28px\)\);/u);
  assert.match(css, /background: #1d2026;/u);
  assert.match(
    css,
    /\.workspace-shell \.conversation-head \{[\s\S]*?min-height: 76px;[\s\S]*?padding: 13px 14px;/u,
  );
  assert.match(
    css,
    /\.workspace-shell \.conversation-head h1 \{[\s\S]*?font-size: 19px;/u,
  );
  assert.match(
    css,
    /\.workspace-shell \.inbox-overview \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/u,
  );
  assert.match(
    css,
    /\.workspace-shell \.inbox-tools \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;/u,
  );
  assert.match(
    css,
    /\.workspace-shell \.conversation-row \{[\s\S]*?min-height: 74px;/u,
  );
  assert.match(css, /\.workspace-shell \.filter \{/u);
  assert.match(css, /color: #596372;/u);
  assert.match(composerCss, /@media \(min-width: 761px\)/u);
  assert.match(
    composerCss,
    /\.workspace-shell \.composer > textarea \{[\s\S]*?height: 88px;[\s\S]*?min-height: 88px;[\s\S]*?font-size: 14px;[\s\S]*?line-height: 1\.5;/u,
  );
  assert.match(
    composerCss,
    /\.workspace-shell \.media-picker,[\s\S]*?\.workspace-shell \.quick-replies-trigger \{[\s\S]*?width: 42px;[\s\S]*?height: 42px;[\s\S]*?border-radius: 12px;/u,
  );
  assert.match(
    composerCss,
    /\.workspace-shell \.composer-foot \.primary-button \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;[\s\S]*?border-radius: 12px;/u,
  );
});
