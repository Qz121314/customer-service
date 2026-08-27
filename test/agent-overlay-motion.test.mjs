import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('agent overlays enter on stable compositor-owned geometry', async () => {
  const [main, agentEntry, overlays] = await Promise.all([
    read('../src/dashboard/main.tsx'),
    read('../src/dashboard/agent-entry.tsx'),
    read('../src/dashboard/agent-overlays.css'),
  ]);

  assert.ok(main.includes("import('./agent-entry')"));
  assert.ok(agentEntry.includes("await import('./agent-overlays.css');"));
  assert.ok(
    agentEntry.indexOf("await import('./commercial-polish.css');") >
      agentEntry.indexOf("await import('./agent-desktop-layout.css');"),
  );
  assert.match(overlays, /agent-overlay-backdrop-in/u);
  assert.match(overlays, /agent-overlay-dialog-in/u);
  assert.match(overlays, /agent-overlay-sheet-in/u);
  assert.match(overlays, /agent-overlay-page-in/u);
  assert.match(overlays, /contain:\s*layout paint/u);
  assert.match(overlays, /backdrop-filter:\s*none/u);
  assert.match(overlays, /prefers-reduced-motion:\s*reduce/u);
  assert.match(overlays, /height:\s*min\(660px, 82dvh\)/u);
  assert.match(overlays, /grid-template-rows:\s*auto minmax\(0, 1fr\) auto/u);
});
