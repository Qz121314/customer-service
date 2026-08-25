import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('agent overlays enter on stable compositor-owned geometry', async () => {
  const [main, motion, autoReply] = await Promise.all([
    read('../src/dashboard/main.tsx'),
    read('../src/dashboard/agent-overlay-motion.css'),
    read('../src/dashboard/agent-auto-reply.css'),
  ]);

  assert.ok(main.includes("import('./agent-overlay-motion.css')"));
  assert.match(motion, /agent-overlay-backdrop-in/u);
  assert.match(motion, /agent-overlay-dialog-in/u);
  assert.match(motion, /agent-overlay-sheet-in/u);
  assert.match(motion, /agent-overlay-page-in/u);
  assert.match(motion, /contain:\s*layout paint/u);
  assert.match(motion, /backdrop-filter:\s*none/u);
  assert.match(motion, /prefers-reduced-motion:\s*reduce/u);
  assert.match(autoReply, /height:\s*min\(660px, 82dvh\)/u);
  assert.match(autoReply, /grid-template-rows:\s*auto minmax\(0, 1fr\) auto/u);
});
